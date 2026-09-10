/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyRequest, FastifyReply } from 'fastify'
import yn from '../util/yn.js'

/**
 * Error hook.
 *
 * The message of the exception is written to the log, always, and reaches the client only
 * when `HIDE_ERROR_DETAILS` allows it (defect D-23). Until v5 this hook echoed
 * `error.message` on a 500 whatever that variable said, while the error handler of
 * `index.ts` honoured it: the same deployment therefore hid the internals on one path and
 * published them on the other, and which path a request took was not something the operator
 * chose. The default follows `NODE_ENV`, so a production build hides by default.
 *
 * The 4xx branches hide the message too when the flag is on, exactly like the error handler:
 * a rule that the operator turns on must not have exceptions the operator cannot see. Route
 * handlers that answer with `reply.status(4xx).send({...})` do not pass through here, so the
 * validation messages a client legitimately needs are unaffected.
 */
export default async (_req: FastifyRequest, reply: FastifyReply, error: any) => {
  // Normalize the message up-front: `error` may be a string, or an object without
  // a `message` — reading `.includes` on an undefined message would crash the
  // error handler itself (and mask the real error as an unhandled 500).
  const message = typeof error?.message === 'string' ? error.message : String(error?.message ?? error ?? '')

  if (log.e) log.error(message || `${error}`)
  if (log.t) log.trace(error)

  const hide = yn(process.env.HIDE_ERROR_DETAILS, process.env.NODE_ENV === 'production')

  const send = (statusCode: number, errorType: string, code?: string) =>
    reply.code(statusCode).send({
      statusCode,
      error: errorType,
      ...(code ? { code } : {}),
      ...(!hide && message ? { message } : {})
    })

  if (error?.statusCode && error.statusCode >= 400) {
    const errorType = error.error || error.code || error.name || 'Error'
    return send(error.statusCode, errorType, typeof error.code === 'string' ? error.code : undefined)
  }

  if (message === 'Wrong credentials' || message === 'Unauthorized') {
    return send(403, 'Forbidden')
  }

  if (message.includes('not found')) {
    return send(404, 'Not Found')
  }

  return send(500, 'Internal Server Error')
}
