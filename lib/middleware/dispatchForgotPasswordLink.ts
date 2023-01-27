import { FastifyReply, FastifyRequest } from 'fastify'

export async function preSerialization(req: FastifyRequest, res: FastifyReply, payload) {
  return payload
}
