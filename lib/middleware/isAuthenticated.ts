import { FastifyReply, FastifyRequest } from 'fastify'

const log = global.log
module.exports = (req: FastifyRequest, res: FastifyReply, next: any) => {
  try {
    // TODO: do something and then you can throw an exception or call next()..
    if (!!req.user?.id) {
      log.d && log.trace('isAuthenticated - user id ' + req.user?.id)
      return next()
    }
    throw new Error('User not authenticated')
  } catch (err) {
    log.e && log.error(`Upps, something just happened ${err}`)
    res.code(403).send(err)
  }
}
