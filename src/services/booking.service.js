const { createClient } = require("@supabase/supabase-js")

let supabaseAdmin

class BookingSyncError extends Error {
  constructor(code, message, statusCode) {
    super(message)
    this.name = "BookingSyncError"
    this.code = code
    this.statusCode = statusCode || 500
  }
}

function isBookingSyncConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

function getSupabaseAdminClient() {
  if (supabaseAdmin) {
    return supabaseAdmin
  }

  const url = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !serviceRoleKey) {
    throw new BookingSyncError(
      "BOOKING_SYNC_CONFIG_MISSING",
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
      500
    )
  }

  supabaseAdmin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false }
  })

  return supabaseAdmin
}

async function getBookingPaymentState(bookingId) {
  const client = getSupabaseAdminClient()
  const { data, error } = await client
    .from("bookings")
    .select("id, payment_status, status, razorpay_order_id, razorpay_payment_id")
    .eq("id", bookingId)
    .single()

  if (error) {
    if (error.code === "PGRST116") {
      throw new BookingSyncError("BOOKING_NOT_FOUND", "Booking not found", 404)
    }
    throw new BookingSyncError("BOOKING_READ_FAILED", `Failed to read booking: ${error.message}`, 500)
  }

  return data
}

async function updateBookingPaymentStatus({
  bookingId,
  paymentStatus,
  bookingStatus,
  razorpayOrderId,
  razorpayPaymentId
}) {
  const client = getSupabaseAdminClient()
  const currentState = await getBookingPaymentState(bookingId)

  if (paymentStatus === "paid" && currentState.payment_status === "paid") {
    return { updated: false, reason: "already_paid", currentState }
  }

  if (paymentStatus === "failed" && currentState.payment_status === "paid") {
    return { updated: false, reason: "skip_failed_after_paid", currentState }
  }

  const updateData = {
    payment_status: paymentStatus
  }

  if (bookingStatus) {
    updateData.status = bookingStatus
  }

  if (razorpayOrderId) {
    updateData.razorpay_order_id = razorpayOrderId
  }

  if (razorpayPaymentId) {
    updateData.razorpay_payment_id = razorpayPaymentId
  }

  const { data, error } = await client
    .from("bookings")
    .update(updateData)
    .eq("id", bookingId)
    .select("id, payment_status, status, razorpay_order_id, razorpay_payment_id")
    .single()

  if (error) {
    throw new BookingSyncError(
      "BOOKING_UPDATE_FAILED",
      `Failed to update booking payment status: ${error.message}`,
      500
    )
  }

  return { updated: true, booking: data }
}

module.exports = {
  updateBookingPaymentStatus,
  getBookingPaymentState,
  isBookingSyncConfigured,
  BookingSyncError
}
