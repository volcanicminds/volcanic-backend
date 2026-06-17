import { FastifyReply, FastifyRequest } from 'fastify'

export function check(_req: FastifyRequest, reply: FastifyReply) {
  reply.send({ ok: true })
}
