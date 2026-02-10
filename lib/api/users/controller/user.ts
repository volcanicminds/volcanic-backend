import { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthenticatedUser } from '../../../../types/global.js'
import { MfaPolicy } from '../../../config/constants.js'

export async function getRoles(_req: FastifyRequest, reply: FastifyReply) {
  const allRoles = Object.keys(roles).map((key) => roles[key])
  return reply.send(allRoles)
}

export async function count(req: FastifyRequest, _reply: FastifyReply) {
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

  const { id: _id, ...data } = req.data()

  if (data.roles && data.roles.includes(roles.admin)) {
    if (config.options?.allow_multiple_admin !== true) {
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
  const mfaPolicy = global.config.options?.mfa_policy || MfaPolicy.OPTIONAL

  return reply.send(
    user
      ? {
          ...user,
          roles: req.roles(),
          securityPolicy: {
            mfaPolicy
          }
        }
      : {}
  )
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

export async function block(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply.status(403).send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to block a user' })
  }

  const { id: userId } = req.parameters()
  const { reason } = req.data()

  let user = await req.server['userManager'].blockUserById(userId, reason, req.runner)
  user = await req.server['userManager'].resetExternalId(user.getId(), req.runner)
  return { ok: !!user.getId() }
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply
      .status(403)
      .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to unblock a user' })
  }

  const { id: userId } = req.parameters()
  const user = await req.server['userManager'].unblockUserById(userId, req.runner)
  return { ok: !!user.getId() }
}

export async function resetMfaByAdmin(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()

  if (!req.hasRole(roles.admin)) {
    return reply.status(403).send(new Error('Only admins can reset MFA'))
  }

  if (!id) {
    return reply.status(400).send(new Error('Missing user id'))
  }

  try {
    await req.server['userManager'].disableMfa(id, req.runner)
    return { ok: true }
  } catch (error) {
    req.log.error(error)
    return reply.status(500).send(new Error('Failed to reset MFA'))
  }
}

export async function resetPasswordByAdmin(req: FastifyRequest, reply: FastifyReply) {
  // Check if feature is enabled via config
  if (config.options?.allow_admin_change_password_users !== true) {
    return reply.status(404).send()
  }

  if (!req.hasRole(roles.admin)) {
    return reply.status(403).send(new Error('Only admins can reset user passwords'))
  }

  const { id } = req.parameters()
  if (!id) {
    return reply.status(400).send(new Error('Missing user id'))
  }

  const { password } = req.data()
  if (!password) {
    return reply.status(400).send(new Error('Missing password in request body'))
  }

  try {
    const user = await req.server['userManager'].retrieveUserById(id)
    if (!user) {
      return reply.status(404).send(new Error('User not found'))
    }

    await req.server['userManager'].resetPassword(user, password)
    return { ok: true }
  } catch (error) {
    req.log.error(error)
    return reply.status(500).send(new Error('Failed to reset password'))
  }
}
