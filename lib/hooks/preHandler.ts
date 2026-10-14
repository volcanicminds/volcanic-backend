import type { FastifyReply, FastifyRequest } from 'fastify'
import * as tracking from '../util/tracker.js'

//
// Awaited. The baseline of the audit diff has to be read BEFORE the handler changes the row,
// and an un-awaited promise gives no such guarantee: the handler could overwrite the row while
// the read is still in flight, and the diff would compare the new value with itself.
//
export default async (req: FastifyRequest, reply: FastifyReply) => {
  await tracking.initialize(req, reply)
}
