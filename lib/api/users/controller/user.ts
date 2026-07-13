import { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthenticatedUser } from '../../../../types/global.js'
import { MfaPolicy } from '../../../config/constants.js'
import { includesRole, isFounderEmail } from '../../../util/authz.js'

const forbidden = (reply: FastifyReply, message: string) =>
  reply.status(403).send({ statusCode: 403, error: 'Forbidden', message })

// The admin role is a restricted apex (default single, see allow_multiple_admin). This
// guards against dropping to zero admins, which would lock the instance out.
async function isLastAdmin(req: FastifyRequest): Promise<boolean> {
  const total = await req.server['userManager'].countQuery({ 'roles:in': roles.admin.code }, req.runner)
  return Number(total) <= 1
}

export async function getRoles(_req: FastifyRequest, reply: FastifyReply) {
  const allRoles = Object.keys(roles).map((key) => roles[key])
  return reply.send(allRoles)
}

export async function count(req: FastifyRequest, _reply: FastifyReply) {
  return req.server['userManager'].countQuery(req.data(), req.runner)
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  const { headers, records } = await req.server['userManager'].findQuery(req.data(), req.runner)
  return reply.type('application/json').headers(headers).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const user = id ? await req.server['userManager'].retrieveUserById(id, req.runner) : null
  return user || reply.status(404).send()
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const { id: _id, ...data } = req.data()

  // Rule A: assigning the admin role requires an admin caller AND allow_multiple_admin.
  // The `users` capability alone can manage users but never mint an admin.
  if (
    includesRole(data.roles, roles.admin.code) &&
    (!req.hasRole(roles.admin) || config.options?.allow_multiple_admin !== true)
  ) {
    return forbidden(reply, 'Cannot assign the admin role')
  }

  // Pass req.runner so creation lands in the resolved tenant schema (multi-tenant);
  // createUser already persists and returns the saved entity, so do NOT re-save via
  // entity.User.save() — that active-record call always targets the global/public
  // connection and would both double-write and break tenant isolation.
  const user = await req.server['userManager'].createUser(data, req.runner)
  if (!user) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'User not creatable' })
  }

  // Opt-in (allow_admin_create_confirmed_users): admin-created users are activated
  // immediately (confirmed, no pending confirmation token) so they can log in right
  // away. An explicit confirmed:false in the payload keeps the standard flow.
  // Self-registration (POST /auth/register) is unaffected: createUser always starts
  // users unconfirmed.
  if (config.options?.allow_admin_create_confirmed_users === true && data.confirmed !== false) {
    return await req.server['userManager'].userConfirmation(user, req.runner)
  }

  return user
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(400).send('Missing required id parameter')
  }

  const { id: _id, ...userData } = req.data()

  const target = await req.server['userManager'].retrieveUserById(id, req.runner)
  const targetIsAdmin = includesRole(target?.roles, roles.admin.code)
  const changingRoles = Object.prototype.hasOwnProperty.call(userData, 'roles')

  // Sovereign founder: cannot be demoted or have its email changed via the API
  // (transfer happens via env + redeploy).
  if (isFounderEmail(target?.email)) {
    if (changingRoles && !includesRole(userData.roles, roles.admin.code)) {
      return forbidden(reply, 'Cannot demote the sovereign admin')
    }
    if (
      typeof userData.email === 'string' &&
      userData.email.trim().toLowerCase() !== (target.email || '').trim().toLowerCase()
    ) {
      return forbidden(reply, 'Cannot change the sovereign admin email')
    }
  }

  // Rule B: only an admin may modify an admin subject.
  if (targetIsAdmin && !req.hasRole(roles.admin)) {
    return forbidden(reply, 'Cannot modify an admin user')
  }
  // Rule A: assigning the admin role requires an admin caller AND allow_multiple_admin.
  if (
    changingRoles &&
    includesRole(userData.roles, roles.admin.code) &&
    (!req.hasRole(roles.admin) || config.options?.allow_multiple_admin !== true)
  ) {
    return forbidden(reply, 'Cannot assign the admin role')
  }
  // Never drop to zero admins: refuse demoting the last admin.
  if (targetIsAdmin && changingRoles && !includesRole(userData.roles, roles.admin.code) && (await isLastAdmin(req))) {
    return forbidden(reply, 'Cannot demote the last admin')
  }

  return await req.server['userManager'].updateUserById(id, userData, req.runner)
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  const target = await req.server['userManager'].retrieveUserById(id, req.runner)
  const targetIsAdmin = includesRole(target?.roles, roles.admin.code)

  // Sovereign founder: cannot be deleted.
  if (isFounderEmail(target?.email)) {
    return forbidden(reply, 'Cannot delete the sovereign admin')
  }
  // Rule B: only an admin may delete an admin subject.
  if (targetIsAdmin && !req.hasRole(roles.admin)) {
    return forbidden(reply, 'Cannot delete an admin user')
  }
  // Never drop to zero admins.
  if (targetIsAdmin && (await isLastAdmin(req))) {
    return forbidden(reply, 'Cannot delete the last admin')
  }

  return await req.server['userManager'].deleteUser(id, req.runner)
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

// Fields a user is allowed to change on themselves. Everything else (roles,
// blocked, confirmed, password, externalId, mfa*, ...) is off-limits: spreading the
// raw body here would let a normal user mass-assign roles:['admin'] and escalate.
const SELF_EDITABLE_FIELDS = ['username', 'firstName', 'lastName']

export async function updateCurrentUser(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  const id = user?.getId()
  if (!id) {
    return reply.status(403).send('Cannot update current user')
  }

  const incoming = req.data() || {}
  const userData: any = {}
  for (const f of SELF_EDITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(incoming, f)) userData[f] = incoming[f]
  }
  return await req.server['userManager'].updateUserById(id, userData, req.runner)
}

export async function isAdmin(req: FastifyRequest, reply: FastifyReply) {
  const user: AuthenticatedUser | undefined = req.user
  return reply.send({ isAdmin: user?.getId() && req.hasRole(roles.admin) })
}

export async function block(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  const { id: userId } = req.parameters()
  const { reason } = req.data()

  const target = await req.server['userManager'].retrieveUserById(userId, req.runner)
  const targetIsAdmin = includesRole(target?.roles, roles.admin.code)
  // Sovereign founder: cannot be blocked.
  if (isFounderEmail(target?.email)) {
    return forbidden(reply, 'Cannot block the sovereign admin')
  }
  // Rule B: only an admin may block an admin subject.
  if (targetIsAdmin && !req.hasRole(roles.admin)) {
    return forbidden(reply, 'Cannot block an admin user')
  }
  // Never drop to zero admins (blocking the last admin locks the instance out).
  if (targetIsAdmin && (await isLastAdmin(req))) {
    return forbidden(reply, 'Cannot block the last admin')
  }

  let user = await req.server['userManager'].blockUserById(userId, reason, req.runner)
  user = await req.server['userManager'].resetExternalId(user.getId(), req.runner)
  return { ok: !!user.getId() }
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  const { id: userId } = req.parameters()

  const target = await req.server['userManager'].retrieveUserById(userId, req.runner)
  // Rule B: only an admin may unblock an admin subject.
  if (includesRole(target?.roles, roles.admin.code) && !req.hasRole(roles.admin)) {
    return forbidden(reply, 'Cannot unblock an admin user')
  }

  const user = await req.server['userManager'].unblockUserById(userId, req.runner)
  return { ok: !!user.getId() }
}

export async function resetMfaByAdmin(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()

  if (!req.hasRole(roles.admin)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only admins can reset MFA' })
  }

  if (!id) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing user id' })
  }

  const mfaTarget = await req.server['userManager'].retrieveUserById(id, req.runner)
  if (isFounderEmail(mfaTarget?.email) && !isFounderEmail(req.user?.email)) {
    return forbidden(reply, 'Cannot reset the sovereign admin MFA')
  }

  try {
    await req.server['userManager'].disableMfa(id, req.runner)
    return { ok: true }
  } catch (error) {
    req.log.error(error)
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to reset MFA' })
  }
}

export async function resetPasswordByAdmin(req: FastifyRequest, reply: FastifyReply) {
  // Check if feature is enabled via config
  if (config.options?.allow_admin_change_password_users !== true) {
    return reply.status(404).send()
  }

  if (!req.hasRole(roles.admin)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only admins can reset user passwords' })
  }

  const { id } = req.parameters()
  if (!id) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing user id' })
  }

  const { password } = req.data()
  if (!password) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Missing password in request body' })
  }

  try {
    const user = await req.server['userManager'].retrieveUserById(id, req.runner)
    if (!user) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })
    }

    if (isFounderEmail(user.email) && !isFounderEmail(req.user?.email)) {
      return forbidden(reply, 'Cannot reset the sovereign admin password')
    }

    await req.server['userManager'].resetPassword(user, password, req.runner)
    return { ok: true }
  } catch (error) {
    req.log.error(error)
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Failed to reset password' })
  }
}
