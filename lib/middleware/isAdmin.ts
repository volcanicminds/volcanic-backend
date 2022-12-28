import { FastifyReply, FastifyRequest } from 'fastify'

export function preHandler(req: FastifyRequest, res: FastifyReply, done: any) {
  try {
    if (req.user && req.user.id && req.hasRole(roles.admin)) {
      return done()
    }

    throw new Error('User without this privilege')
  } catch (err) {
    log.e && log.error(`Upps, something just happened ${err}`)
    res.code(403).send(err)
  }
}
