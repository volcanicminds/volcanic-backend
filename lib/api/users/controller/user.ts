import { FastifyReply, FastifyRequest } from 'fastify'
import { AuthenticatedUser } from '../../../../types/global'

export function currentUser(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  reply.send(user ? { ...user, roles: req.roles() } : {})
}

export function isAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  reply.send({ isAdmin: user?.getId() && req.hasRole(roles.admin) })
}
