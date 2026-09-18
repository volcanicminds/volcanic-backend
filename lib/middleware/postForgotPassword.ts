import { FastifyReply, FastifyRequest } from 'fastify'

export async function preSerialization(_req: FastifyRequest, _res: FastifyReply, payload: unknown) {
  return payload
}
