export default async (req, reply) => {
  let extraMessage: string = ''
  if (log.i && req.startedAt) {
    const elapsed: number = new Date().getTime() - req.startedAt.getTime()
    extraMessage = `(${elapsed}ms)`
  }
  if (log.t) {
    const reqSize: string = `req ${req.payloadSize || 0}`
    const replySize: string = reply.payloadSize > 0 ? ` res ${reply.payloadSize}` : ''
    extraMessage += `[${reqSize}${replySize} bytes]`
  }

  const message = () => `${req.method} ${req.url} ${reply.statusCode} ${extraMessage}`.trim()
  reply.statusCode < 300 ? log.info(message()) : reply.statusCode < 400 ? log.warn(message()) : log.error(message())
}
