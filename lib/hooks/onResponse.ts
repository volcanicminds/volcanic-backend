//
// Response log, and nothing else.
//
// The request's QueryRunner is released in ONE place, `lib/loader/tenant.ts`, never here:
// Fastify runs its onResponse hooks BEFORE the `finish` listener, and two owners of one release
// is how a connection goes back to the pool before its reset runs. No session state is kept to
// undo anyway. Logging a response is this file's whole job.
//
import type { FastifyReply, FastifyRequest } from 'fastify'
import { withoutQuery } from '../util/logger.js'

export default async (req: FastifyRequest, reply: FastifyReply) => {
  let extraMessage = ''
  if (log.i && req.startedAt) {
    const elapsed: number = new Date().getTime() - req.startedAt.getTime()
    extraMessage = `(${elapsed}ms)`
  }
  if (log.t) {
    const reqSize = `req ${req.payloadSize || 0}`
    const replySize = (reply.payloadSize ?? 0) > 0 ? ` res ${reply.payloadSize}` : ''
    extraMessage += `[${reqSize}${replySize} bytes]`
  }

  const message = () => `${req.method} ${withoutQuery(req.url)} ${reply.statusCode} ${extraMessage}`.trim()
  if (reply.statusCode < 300) {
    log.info(message())
  } else if (reply.statusCode < 400) {
    log.warn(message())
  } else {
    log.error(message())
  }
}
