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

export async function count(req: FastifyRequest, reply: FastifyReply) {
  return req.server['userManager'].countQuery(req.data())
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  const { headers, records } = await req.server['userManager'].findQuery(req.data())
  return reply.type('application/json').headers(headers).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const user = id ? await req.server['userManager'].retrieveUserById(id) : null
  return user || reply.status(404).send()
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const { id, ...data } = req.data()
  const user = await req.server['userManager'].createUser(data)
  return user ? entity.User.save(user) : reply.status(400).send(Error('User not creatable'))
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id, ...userData } = req.parameters()
  if (!id) {
    return reply.status(400).send('Missing required id parameter')
  }

  return await req.server['userManager'].updateUserById(id, userData)
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }
  return await req.server['userManager'].deleteUser(id)
}
