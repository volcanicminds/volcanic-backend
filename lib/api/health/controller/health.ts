import { FastifyReply, FastifyRequest } from 'fastify'

export async function check(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ ok: true })
}
