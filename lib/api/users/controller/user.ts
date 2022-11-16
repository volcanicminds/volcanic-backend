import { FastifyReply, FastifyRequest } from 'fastify'

export async function user(req: FastifyRequest, reply: FastifyReply) {
  reply.send(req.user ? { ...req.user, roles: req.user.getRoles() } : {})
}

export async function isAdmin(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ isAdmin: req.user && req.user.id && req.user.hasRole(roles.admin) })
}
