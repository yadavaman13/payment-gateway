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
const {
  getCanonicalBookingId,
  parseAmountInPaise,
  buildSafeReceipt
} = require("../utils/payment")

const FIXED_CHECKOUT_PROFILE = {
  name: "Itesh prajapati",
  email: "iteshofficial@gmail.com",
  contact: "8200854335"
}

function getRazorpayCredentials() {
  const keyId = (process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_ID_KEY || "").trim()
  const keySecret = (process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_SECRET_KEY || "").trim()

  if (!keyId || !keySecret) {
    throw new Error("Razorpay credentials are not configured")
  }

  return { keyId, keySecret }
}

function getRazorpayClient() {
  const { keyId, keySecret } = getRazorpayCredentials()
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  })
}

function isGuestBookingId(bookingId) {
  return String(bookingId || "").startsWith("guest_")
}

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

async function createOrder(req, res) {
  const requestId = req.requestId
  try {
    const razorpay = getRazorpayClient()
    const { keyId } = getRazorpayCredentials()
    const { amount, bookingId, actualBookingId, mentorId, sessionType, name, description } = req.body || {}
    const paise = parseAmountInPaise(amount)
    let canonicalBookingId = getCanonicalBookingId({ bookingId, actualBookingId })
    const guestFlow = !canonicalBookingId

    if (!canonicalBookingId) {
      canonicalBookingId = `guest_${Date.now()}`
    }

    if (!paise) {
      return sendError(res, 400, "INVALID_AMOUNT", "amount must be a number greater than 0", {
        amount
      })
    }

    const options = {
      amount: paise,
      currency: "INR",
      receipt: buildSafeReceipt(canonicalBookingId),
      notes: {
        booking_id: String(canonicalBookingId),
        mentor_id: mentorId ? String(mentorId) : "",
        session_type: sessionType ? String(sessionType) : "",
        source: "matepeak"
      }
    }

    const order = await razorpay.orders.create(options)

    if (!guestFlow && isBookingSyncConfigured()) {
      await updateBookingPaymentStatus({
        bookingId: String(canonicalBookingId),
        paymentStatus: "pending",
        razorpayOrderId: order.id
      })
    } else {
      logInfo("booking_sync_skipped_missing_config", {
        requestId,
        bookingId: canonicalBookingId,
        orderId: order.id
      })
    }

    logInfo("order_created", {
      requestId,
      bookingId: canonicalBookingId,
      providedBookingId: bookingId || null,
      providedActualBookingId: actualBookingId || null,
      orderId: order.id,
      amountPaise: paise,
      receiptLength: options.receipt.length
    })

    return sendSuccess(res, 200, {
      order,
      publicKey: keyId,
      key_id: keyId,
      order_id: order.id,
      amount: paise,
      product_name: name || "Mentorship Session",
      description: description || "One-on-one call",
      contact: FIXED_CHECKOUT_PROFILE.contact,
      name: FIXED_CHECKOUT_PROFILE.name,
      email: FIXED_CHECKOUT_PROFILE.email,
      guestFlow
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
    const razorpay = getRazorpayClient()
    const { keySecret } = getRazorpayCredentials()
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      bookingId,
      actualBookingId
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
      .createHmac("sha256", keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest("hex")

    const isValid = generatedSignature === razorpay_signature

    let resolvedBookingId = getCanonicalBookingId({ bookingId, actualBookingId })
    if (!resolvedBookingId) {
      const order = await razorpay.orders.fetch(razorpay_order_id)
      resolvedBookingId = order?.notes?.booking_id || null
    }

    if (!resolvedBookingId) {
      return sendError(res, 400, "BOOKING_ID_NOT_FOUND", "Could not resolve bookingId")
    }

    if (!isValid) {
      if (!isGuestBookingId(resolvedBookingId)) {
        await updateBookingPaymentStatus({
          bookingId: resolvedBookingId,
          paymentStatus: "failed",
          razorpayOrderId: razorpay_order_id,
          razorpayPaymentId: razorpay_payment_id
        })
      }

      logInfo("payment_verify_invalid_signature", {
        requestId,
        bookingId: resolvedBookingId,
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id
      })

      return sendError(res, 400, "INVALID_SIGNATURE", "Invalid payment signature")
    }

    if (isGuestBookingId(resolvedBookingId)) {
      return sendSuccess(res, 200, {
        verified: true,
        bookingId: resolvedBookingId,
        guestFlow: true
      })
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
      providedBookingId: bookingId || null,
      providedActualBookingId: actualBookingId || null,
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id
    })

    return sendSuccess(res, 200, {
      verified: true,
      bookingId: resolvedBookingId,
      canonicalBookingId: resolvedBookingId
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
    const razorpay = getRazorpayClient()
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

    let outcome = "ignored_event"
    if (event === "payment.captured" || event === "order.paid") {
      const result = await updateBookingPaymentStatus({
        bookingId: String(bookingId),
        paymentStatus: "paid",
        bookingStatus: "confirmed",
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId
      })
      outcome = result.updated ? "marked_paid" : result.reason
    } else if (event === "payment.failed") {
      const result = await updateBookingPaymentStatus({
        bookingId: String(bookingId),
        paymentStatus: "failed",
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId
      })
      outcome = result.updated ? "marked_failed" : result.reason
    }

    processedWebhookEvents.set(eventId, Date.now())

    logInfo("webhook_processed", {
      requestId,
      eventId,
      event,
      bookingId,
      orderId,
      paymentId,
      outcome
    })

    return sendSuccess(res, 200, { received: true, eventId, event, outcome })
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
