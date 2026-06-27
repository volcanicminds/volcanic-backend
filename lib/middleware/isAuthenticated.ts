/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyReply, FastifyRequest } from 'fastify'
import { httpError } from '../util/httpError.js'

export function preHandler(req: FastifyRequest, res: FastifyReply, done: any) {
  try {
    if (req.user?.getId()) {
      return done()
    }

    throw new Error('Unauthorized')
  } catch (err) {
    if (log.e) log.error(`Upps, something just happened ${err}`)
    // Send a structured body (not a raw Error): `reply.code(x).send(new Error())`
    // loses the status in Fastify's async error path and collapses to 500/403.
    return res.code(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED')) // must be authorized first
  }
}
