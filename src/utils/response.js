function sendSuccess(res, statusCode, data) {
  return res.status(statusCode).json({
    success: true,
    ...data
  })
}

function sendError(res, statusCode, code, message, details) {
  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details: details || null
    }
  })
}

module.exports = {
  sendSuccess,
  sendError
}
