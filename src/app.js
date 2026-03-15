const crypto = require("crypto")
const express = require("express")
const app = express()
const path = require("path")

app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "../views"))

app.use((req, res, next) => {
    req.requestId = crypto.randomUUID()
    res.setHeader("X-Request-Id", req.requestId)
    next()
})

// Keep webhook route on raw payload for signature verification.
app.use("/api/payment/webhook", express.raw({ type: "application/json" }))
app.use(express.json())

app.get("/", (req, res) => {
    res.render("index", {
        razorpayKey: process.env.RAZORPAY_KEY_ID,
        matepeakAppUrl: process.env.MATEPEAK_APP_URL || ""
    })
})

const paymentRoutes = require("./routes/payment.route")

app.use("/api/payment", paymentRoutes)

module.exports = app