import { FastifyReply, FastifyRequest } from 'fastify'

export function check(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ ok: true })
}
