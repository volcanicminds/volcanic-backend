export default async (req, reply) => {
  let extraMessage = ''
  if (log.i && req.startedAt) {
    const elapsed: number = new Date().getTime() - req.startedAt.getTime()
    extraMessage = `(${elapsed}ms)`
  }
  if (log.t) {
    const reqSize = `req ${req.payloadSize || 0}`
    const replySize = reply.payloadSize > 0 ? ` res ${reply.payloadSize}` : ''
    extraMessage += `[${reqSize}${replySize} bytes]`
  }

  const message = () => `${req.method} ${req.url} ${reply.statusCode} ${extraMessage}`.trim()
  if (reply.statusCode < 300) {
    log.info(message())
  } else if (reply.statusCode < 400) {
    log.warn(message())
  } else {
    log.error(message())
  }
}
