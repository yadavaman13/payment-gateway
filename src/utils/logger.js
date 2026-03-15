function logInfo(message, context) {
  console.log(JSON.stringify({
    level: "info",
    message,
    timestamp: new Date().toISOString(),
    ...context
  }))
}

function logError(message, context) {
  console.error(JSON.stringify({
    level: "error",
    message,
    timestamp: new Date().toISOString(),
    ...context
  }))
}

module.exports = {
  logInfo,
  logError
}
