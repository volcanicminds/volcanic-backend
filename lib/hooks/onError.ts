/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyRequest, FastifyReply } from 'fastify'

export default async (_req: FastifyRequest, reply: FastifyReply, error: any) => {
  if (log.e) log.error(`${error?.message || error}`)
  if (log.t) log.trace(error)

  if (error.statusCode && error.statusCode >= 400) {
    return reply.code(error.statusCode).send(error)
  }

  if (error.message === 'Wrong credentials' || error.message === 'Unauthorized') {
    return reply.code(403).send({
      statusCode: 403,
      error: 'Forbidden',
      message: error.message
    })
  }

  if (error.message.includes('not found')) {
    return reply.code(404).send({
      statusCode: 404,
      error: 'Not Found',
      message: error.message
    })
  }

  return reply.code(500).send({
    statusCode: 500,
    error: 'Internal Server Error',
    message: error.message
  })
}
