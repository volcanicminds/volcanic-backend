/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyReply, FastifyRequest } from 'fastify'
import { httpError } from '../util/httpError.js'

//
// "Is there someone behind this request", asked of all three identities.
//
// A platform administrator authenticates on the control plane and lands in `req.systemUser`,
// deliberately not in `req.user`: they are not a tenant user. Checking `req.user` alone would
// answer 401 to a perfectly valid system token on every control route.
//
export function preHandler(req: FastifyRequest, res: FastifyReply, done: any) {
  try {
    if (req.user?.id || req.systemUser?.id || req.token?.id) {
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
