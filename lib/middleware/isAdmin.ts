import { FastifyReply, FastifyRequest } from 'fastify'

const log = global.log
module.exports = (req: FastifyRequest, res: FastifyReply, next: any) => {
  try {
    if (!!req.user?.id && req.user.getRoles().includes(roles.admin.code)) {
      log.d && log.trace('isAdmin - user id ' + req.user?.id)
      return next()
    }
    throw new Error('User not valid')
  } catch (err) {
    log.e && log.error(`Upps, something just happened ${err}`)
    res.code(403).send(err)
  }
}
