module.exports = async (req, reply) => {
  let payloadSizesMessage: string = ''
  if (log.t) {
    const reqSize: string = `req: ${req.payloadSize}`
    const replySize: string = reply.payloadSize ? ` reply: ${reply.payloadSize}` : ''
    payloadSizesMessage = ` [${reqSize}${replySize} bytes]`
  }

  const elapsed: number = new Date().getTime() - (req.start?.getTime() || 0)
  const message: string = `${req.method} ${req.url} ${reply.statusCode} (${elapsed}ms)${payloadSizesMessage}`
  reply.statusCode < 300 ? log.info(message) : reply.statusCode < 400 ? log.warn(message) : log.error(message)
}
