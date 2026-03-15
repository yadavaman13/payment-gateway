const express = require("express")
const app = express()
const path = require("path")

app.set("view engine", "ejs")
app.set("views", path.join(__dirname, "../views"))

app.use(express.json())

app.get("/", (req, res) => {
    res.render("index", {
        razorpayKey: process.env.RAZORPAY_KEY_ID
    })
})

const paymentRoutes = require("./routes/payment.route")

app.use("/api/payment", paymentRoutes)

module.exports = app