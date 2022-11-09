import sizeof from 'object-sizeof'

module.exports = async (req, reply, payload) => {
  if (log.t) {
    req.payloadSize = sizeof(req.data()) + sizeof(req.pars()) + sizeof(req.query)
    reply.payloadSize = sizeof(payload)
  }
}
