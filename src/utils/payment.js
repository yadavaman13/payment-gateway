const crypto = require("crypto")

function getCanonicalBookingId({ bookingId, actualBookingId }) {
  const actual = actualBookingId ? String(actualBookingId).trim() : ""
  const fallback = bookingId ? String(bookingId).trim() : ""
  return actual || fallback || null
}

function parseAmountInPaise(amountInRupees) {
  const amount = Number(amountInRupees)
  if (!Number.isFinite(amount) || amount <= 0) {
    return null
  }

  return Math.round(amount * 100)
}

function buildSafeReceipt(canonicalBookingId) {
  const bookingId = String(canonicalBookingId || "")
  const hash = crypto.createHash("sha256").update(bookingId).digest("hex").slice(0, 12)
  const timestampSuffix = Date.now().toString(36).slice(-6).padStart(6, "0")
  const receipt = `booking_${hash}_${timestampSuffix}`

  if (receipt.length <= 40) {
    return receipt
  }

  // Defensive fallback in case format changes in future.
  return receipt.slice(0, 40)
}

module.exports = {
  getCanonicalBookingId,
  parseAmountInPaise,
  buildSafeReceipt
}
