const crypto = require("crypto")
const Razorpay = require("razorpay")
const {
  getBookingPaymentState,
  updateBookingPaymentStatus,
  isBookingSyncConfigured,
  BookingSyncError
} = require("../services/booking.service")
const { sendError, sendSuccess } = require("../utils/response")
const { logInfo, logError } = require("../utils/logger")

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
})

const processedWebhookEvents = new Map()
const EVENT_TTL_MS = 60 * 60 * 1000

function cleanupWebhookEventCache() {
  const now = Date.now()
  for (const [eventId, timestamp] of processedWebhookEvents.entries()) {
    if (now - timestamp > EVENT_TTL_MS) {
      processedWebhookEvents.delete(eventId)
    }
  }
}

function getBookingIdFromWebhook(payload) {
  const paymentEntity = payload?.payload?.payment?.entity
  const orderEntity = payload?.payload?.order?.entity

  return (
    paymentEntity?.notes?.booking_id ||
    orderEntity?.notes?.booking_id ||
    null
  )
}

function parseAmountInPaise(amountInRupees) {
  const amount = Number(amountInRupees)
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  return Math.round(amount * 100)
}

async function createOrder(req, res) {
  const requestId = req.requestId
  try {
    const { amount, bookingId, mentorId, sessionType } = req.body || {}
    const paise = parseAmountInPaise(amount)

    if (!paise) {
      return sendError(res, 400, "INVALID_AMOUNT", "amount must be a number greater than 0")
    }

    if (!bookingId) {
      return sendError(res, 400, "MISSING_BOOKING_ID", "bookingId is required")
    }

    const options = {
      amount: paise,
      currency: "INR",
      receipt: `booking_${String(bookingId).slice(0, 30)}_${Date.now()}`,
      notes: {
        booking_id: String(bookingId),
        mentor_id: mentorId ? String(mentorId) : "",
        session_type: sessionType ? String(sessionType) : "",
        source: "matepeak"
      }
    }

    const order = await razorpay.orders.create(options)

    if (isBookingSyncConfigured()) {
      await updateBookingPaymentStatus({
        bookingId: String(bookingId),
        paymentStatus: "pending",
        razorpayOrderId: order.id
      })
    } else {
      logInfo("booking_sync_skipped_missing_config", {
        requestId,
        bookingId,
        orderId: order.id
      })
    }

    logInfo("order_created", {
      requestId,
      bookingId,
      orderId: order.id,
      amountPaise: paise
    })

    return sendSuccess(res, 200, {
      order,
      publicKey: process.env.RAZORPAY_KEY_ID
    })
  } catch (error) {
    if (error instanceof BookingSyncError) {
      const statusCode = error.code === "BOOKING_NOT_FOUND" ? 400 : error.statusCode
      return sendError(res, statusCode, error.code, error.message)
    }

    logError("create_order_failed", {
      requestId,
      error: error.message
    })
    return sendError(res, 500, "CREATE_ORDER_FAILED", "Could not create payment order")
  }
}

async function verifyPayment(req, res) {
  const requestId = req.requestId
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId
    } = req.body || {}

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return sendError(
        res,
        400,
        "MISSING_PAYMENT_FIELDS",
        "razorpay_order_id, razorpay_payment_id and razorpay_signature are required"
      )
    }

    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex")

    const isValid = generatedSignature === razorpay_signature

    let resolvedBookingId = bookingId ? String(bookingId) : null
    if (!resolvedBookingId) {
      const order = await razorpay.orders.fetch(razorpay_order_id)
      resolvedBookingId = order?.notes?.booking_id || null
    }

    if (!resolvedBookingId) {
      return sendError(res, 400, "BOOKING_ID_NOT_FOUND", "Could not resolve bookingId")
    }

    if (!isValid) {
      await updateBookingPaymentStatus({
        bookingId: resolvedBookingId,
        paymentStatus: "failed",
        razorpayOrderId: razorpay_order_id,
        razorpayPaymentId: razorpay_payment_id
      })

      logInfo("payment_verify_invalid_signature", {
        requestId,
        bookingId: resolvedBookingId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      })

      return sendError(res, 400, "INVALID_SIGNATURE", "Invalid payment signature")
    }

    const currentState = await getBookingPaymentState(resolvedBookingId)
    if (
      currentState.payment_status === "paid" &&
      currentState.razorpay_payment_id === razorpay_payment_id
    ) {
      logInfo("payment_verify_idempotent", {
        requestId,
        bookingId: resolvedBookingId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      })
      return sendSuccess(res, 200, {
        verified: true,
        bookingId: resolvedBookingId,
        idempotent: true
      })
    }

    await updateBookingPaymentStatus({
      bookingId: resolvedBookingId,
      paymentStatus: "paid",
      bookingStatus: "confirmed",
      razorpayOrderId: razorpay_order_id,
      razorpayPaymentId: razorpay_payment_id
    })

    logInfo("payment_verified", {
      requestId,
      bookingId: resolvedBookingId,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    })

    return sendSuccess(res, 200, {
      verified: true,
      bookingId: resolvedBookingId
    })
  } catch (error) {
    if (error instanceof BookingSyncError) {
      return sendError(res, error.statusCode, error.code, error.message)
    }

    logError("payment_verify_failed", {
      requestId,
      error: error.message
    })
    return sendError(res, 500, "VERIFY_FAILED", "Could not verify payment")
  }
}

async function handleWebhook(req, res) {
  const requestId = req.requestId
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET
    const signature = req.headers["x-razorpay-signature"]
    const eventId = req.headers["x-razorpay-event-id"] || crypto.randomUUID()

    if (!webhookSecret) {
      return sendError(res, 500, "WEBHOOK_SECRET_MISSING", "Webhook secret not configured")
    }

    if (!signature) {
      return sendError(res, 400, "MISSING_WEBHOOK_SIGNATURE", "Webhook signature missing")
    }

    cleanupWebhookEventCache()
    if (processedWebhookEvents.has(eventId)) {
      logInfo("webhook_duplicate", { requestId, eventId })
      return sendSuccess(res, 200, { received: true, duplicate: true })
    }

    const rawBody = Buffer.isBuffer(req.body)
      ? req.body
      : Buffer.from(JSON.stringify(req.body || {}))

    const digest = crypto
      .createHmac("sha256", webhookSecret)
      .update(rawBody)
      .digest("hex")

    if (digest !== signature) {
      logInfo("webhook_invalid_signature", { requestId, eventId })
      return sendError(res, 400, "INVALID_WEBHOOK_SIGNATURE", "Invalid webhook signature")
    }

    const payload = JSON.parse(rawBody.toString("utf8"))
    const event = payload?.event
    const paymentEntity = payload?.payload?.payment?.entity || {}
    const orderEntity = payload?.payload?.order?.entity || {}

    let bookingId = getBookingIdFromWebhook(payload)
    const orderId = paymentEntity.order_id || orderEntity.id || null
    const paymentId = paymentEntity.id || null

    if (!bookingId && orderId) {
      const order = await razorpay.orders.fetch(orderId)
      bookingId = order?.notes?.booking_id || null
    }

    if (!bookingId) {
      logError("webhook_booking_not_found", {
        requestId,
        eventId,
        event
      })
      processedWebhookEvents.set(eventId, Date.now())
      return sendSuccess(res, 200, { received: true, skipped: "booking_not_found" })
    }

    if (event === "payment.captured" || event === "order.paid") {
      await updateBookingPaymentStatus({
        bookingId: String(bookingId),
        paymentStatus: "paid",
        bookingStatus: "confirmed",
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId
      })
    } else if (event === "payment.failed") {
      await updateBookingPaymentStatus({
        bookingId: String(bookingId),
        paymentStatus: "failed",
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId
      })
    }

    processedWebhookEvents.set(eventId, Date.now())

    logInfo("webhook_processed", {
      requestId,
      eventId,
      event,
      bookingId,
      orderId,
      paymentId
    })

    return sendSuccess(res, 200, { received: true, eventId, event })
  } catch (error) {
    if (error instanceof BookingSyncError) {
      return sendError(res, error.statusCode, error.code, error.message)
    }

    logError("webhook_processing_failed", {
      requestId,
      error: error.message
    })
    return sendError(res, 500, "WEBHOOK_FAILED", "Could not process webhook")
  }
}

module.exports = {
  createOrder,
  verifyPayment,
  handleWebhook
}
