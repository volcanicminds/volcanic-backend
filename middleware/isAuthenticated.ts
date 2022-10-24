import { FastifyReply, FastifyRequest } from 'fastify'

const log = global.log
module.exports = async (req: FastifyRequest, res: FastifyReply, next: any) => {
  try {
    // TODO: do something and then you can throw an exception or call next()..
    log.d && log.debug('isAuthenticated?')
    return next()
  } catch (err) {
    log.e && log.error(`Upps, something just happened ${err}`)
    res.send(err)
  }
}
