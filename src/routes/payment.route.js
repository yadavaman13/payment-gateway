const express = require("express")
const router = express.Router()

const {
	createOrder,
	verifyPayment,
	handleWebhook
} = require("../controllers/payment.controller")

router.post("/create-order", createOrder)
router.post("/verify", verifyPayment)
router.post("/webhook", handleWebhook)

module.exports = router