import { FastifyReply, FastifyRequest } from 'fastify'

export async function user(req: FastifyRequest, reply: FastifyReply) {
  return req.user || {}
}

export async function isAdmin(req: FastifyRequest, reply: FastifyReply) {
  return { isAdmin: (req.user?.roles || []).includes('admin') || false }
}
