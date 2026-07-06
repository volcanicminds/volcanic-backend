/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyRequest, FastifyReply } from 'fastify'

export default async (_req: FastifyRequest, reply: FastifyReply, error: any) => {
  // Normalize the message up-front: `error` may be a string, or an object without
  // a `message` — reading `.includes` on an undefined message would crash the
  // error handler itself (and mask the real error as an unhandled 500).
  const message = typeof error?.message === 'string' ? error.message : String(error?.message ?? error ?? '')

  if (log.e) log.error(message || `${error}`)
  if (log.t) log.trace(error)

  if (error?.statusCode && error.statusCode >= 400) {
    return reply.code(error.statusCode).send(error)
  }

  if (message === 'Wrong credentials' || message === 'Unauthorized') {
    return reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message
    })
  }

  if (message.includes('not found')) {
    return reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message
    })
  }

  return reply.code(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message
  })
}
