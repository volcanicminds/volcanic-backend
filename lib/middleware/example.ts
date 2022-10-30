import { FastifyReply, FastifyRequest } from 'fastify'

const log = global.log
module.exports = (req: FastifyRequest, res: FastifyReply, next: any) => {
  try {
    // TODO: do something and then you can throw an exception or call next()..
    return next()
  } catch (err) {
    log.e && log.error(`Upps, something just happened ${err}`)
    res.code(403).send(err)
  }
}
