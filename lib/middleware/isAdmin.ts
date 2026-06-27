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
    // Structured body so the 403 status is preserved (see isAuthenticated note).
    res.code(403).send({ statusCode: 403, error: 'Forbidden', message: 'User without this privilege' })
  }
}
