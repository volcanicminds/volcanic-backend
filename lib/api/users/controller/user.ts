import { FastifyReply, FastifyRequest } from 'fastify'
import { AuthenticatedUser } from '../../../../types/global'

export async function getRoles(req: FastifyRequest, reply: FastifyReply) {
  const allRoles = Object.keys(roles).map((key) => roles[key])
  return reply.send(allRoles)
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
  if (!req.hasRole(roles.admin)) {
    return reply.status(403).send(Error('Only admins can create users'))
  }

  const { id, ...data } = req.data()

  if (data.roles && data.roles.includes(roles.admin)) {
    if (!config.enable || config.options?.allow_multiple_admin !== true) {
      return reply.status(403).send(Error('Cannot assign admin role to a user'))
    }
  }

  const user = await req.server['userManager'].createUser(data)
  return user ? entity.User.save(user) : reply.status(400).send(Error('User not creatable'))
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(400).send('Missing required id parameter')
  }

  const { id: _id, ...userData } = req.data()
  return await req.server['userManager'].updateUserById(id, userData)
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }
  return await req.server['userManager'].deleteUser(id)
}

export async function getCurrentUser(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  return reply.send(user ? { ...user, roles: req.roles() } : {})
}

export async function updateCurrentUser(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  const id = user?.getId()
  if (!id) {
    return reply.status(403).send('Cannot update current user')
  }

  const { id: _id, ...userData } = req.data()
  return await req.server['userManager'].updateUserById(id, userData)
}

export async function isAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  return reply.send({ isAdmin: user?.getId() && req.hasRole(roles.admin) })
}
