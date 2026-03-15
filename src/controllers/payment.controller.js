const Razorpay = require("razorpay")
const dotenv = require("dotenv")

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
})

const createOrder = async (req, res) => {
  try {

    const options = {
      amount: 100, 
      currency: "INR",
      receipt: "receipt_" + Date.now()
    }

    const order = await razorpay.orders.create(options)

    res.json({
      success: true,
      order
    })

  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    })
  }
}

module.exports = { createOrder }