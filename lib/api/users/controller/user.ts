import { FastifyReply, FastifyRequest } from 'fastify'
import { AuthenticatedUser } from '../../../../types/global'

export async function user(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  reply.send(user ? { ...user, roles: req.roles() } : {})
}

export async function isAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  reply.send({ isAdmin: user?.getId() && req.hasRole(roles.admin) })
}
