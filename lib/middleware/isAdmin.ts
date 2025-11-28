/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyReply, FastifyRequest } from 'fastify'

export function preHandler(req: FastifyRequest, res: FastifyReply, done: any) {
  try {
    if (req.user && req.user.getId() && req.hasRole(roles.admin)) {
      return done()
    }

    throw new Error('User without this privilege')
  } catch (err) {
    if (log.e) log.error(`Upps, something just happened ${err}`)
    res.code(403).send(new Error('User without this privilege'))
  }
}
