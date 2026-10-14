import type { FastifyReply, FastifyRequest } from 'fastify'
import sizeof from 'object-sizeof'
import * as tracking from '../util/tracker.js'

//
// Awaited, and before the payload leaves. A tracking call fired and forgotten could not reach
// the response even in principle: the answer would already be on its way. Awaiting here is what
// makes strict mode possible at all: a throw becomes the
// 500 the caller deserves instead of a log line nobody reads.
//
export default async (req: FastifyRequest, reply: FastifyReply, payload: unknown) => {
  if (log.t) {
    req.payloadSize = sizeof(req.body) + sizeof(req.params) + sizeof(req.query)
    reply.payloadSize = sizeof(payload)
  }

  await tracking.track(req, reply, payload)
  return payload
}
