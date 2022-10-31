import { FastifyReply, FastifyRequest } from 'fastify'

export async function user(req: FastifyRequest, reply: FastifyReply) {
  reply.send(req.user || {})
}

export async function isAdmin(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ isAdmin: (req.user?.roles || []).includes('admin') || false })
}

export async function demo(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ demo: true })
}
