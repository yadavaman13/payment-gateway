const {
  getCanonicalBookingId,
  buildSafeReceipt,
  parseAmountInPaise
} = require("../src/utils/payment")

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function run() {
  const shortId = "b610df01-0f43-4aaf"
  const fullUuid = "b610df01-0f43-4aaf-8c07-5c19d98450f1"

  const canonicalFromActual = getCanonicalBookingId({ bookingId: shortId, actualBookingId: fullUuid })
  const canonicalFromShortOnly = getCanonicalBookingId({ bookingId: shortId })

  assert(canonicalFromActual === fullUuid, "Canonical ID should prefer actualBookingId")
  assert(canonicalFromShortOnly === shortId, "Canonical ID should fallback to bookingId")

  const receipt1 = buildSafeReceipt(canonicalFromActual)
  const receipt2 = buildSafeReceipt(canonicalFromShortOnly)

  assert(receipt1.length <= 40, `Receipt length must be <= 40, got ${receipt1.length}`)
  assert(receipt2.length <= 40, `Receipt length must be <= 40, got ${receipt2.length}`)

  const amountPaise = parseAmountInPaise(1499)
  assert(amountPaise === 149900, "Amount conversion to paise failed")

  console.log("Payment sanity checks passed")
  console.log(JSON.stringify({
    canonicalFromActual,
    canonicalFromShortOnly,
    receipt1,
    receipt1Length: receipt1.length,
    receipt2,
    receipt2Length: receipt2.length,
    amountPaise
  }, null, 2))
}

run()
