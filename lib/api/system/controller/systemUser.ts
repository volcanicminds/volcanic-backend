import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, SystemUserManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import * as regExp from '../../../util/regexp.js'
import { isSystemRoleCode } from '../../../loader/roles.js'
import { present } from './systemAuth.js'

//
// Platform identities, managed from the control scope (T-4.1).
//
// Every call takes `req.control`, and the compiler enforces it: `SystemUserManagement` only
// accepts a ControlHandle, so there is no spelling of these operations that reaches a
// customer's container.
//
const manager = (req: FastifyRequest): SystemUserManagement => req.server['systemUserManager']
const control = (req: FastifyRequest): ControlHandle => req.control as ControlHandle

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (manager(req)?.isImplemented?.() && req.control) return false
  reply.status(503).send(httpError(503, 'Platform identities are not available in this build', 'SYSTEM_USERS_NOT_AVAILABLE'))
  return true
}

/**
 * A platform identity carries control roles and nothing else.
 *
 * The check is here as well as at boot because this is the runtime door: the router refuses
 * a ROUTE that mixes the scopes, and this refuses a ROW that would. Granting `admin` to a
 * system user would create an identity whose role code means one thing in the catalogue it
 * is stored in and another in the one it is read from.
 */
function invalidRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return []
  return roles.filter((r) => !isSystemRoleCode(r) || !(global.systemRoles || {})[String(r)]).map(String)
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const { headers, records } = await manager(req).findQuery(control(req), req.data())
  return reply.type('application/json').headers(headers as never).send(records.map(present))
}

export async function count(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  return reply.send(await manager(req).countQuery(control(req), req.data()))
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const { id } = req.parameters()
  const user = await manager(req).retrieveSystemUserById(control(req), id)
  if (!user) return reply.status(404).send()
  return reply.send(present(user))
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const data = req.data()
  if (!data.email || !regExp.email.test(String(data.email))) {
    return reply.status(400).send(httpError(400, 'Email not valid'))
  }
  if (!data.password || !regExp.password.test(String(data.password))) {
    return reply.status(400).send(httpError(400, 'Password not valid'))
  }

  const unknown = invalidRoles(data.roles)
  if (unknown.length) {
    return reply.status(400).send(httpError(400, `Not control roles: ${unknown.join(', ')}`, 'ROLE_NOT_IN_SCOPE'))
  }

  const existing = await manager(req).retrieveSystemUserByEmail(control(req), String(data.email))
  if (existing) {
    // The platform's own user list is not public, and this route is behind a capability, so
    // an explicit conflict is safe here in a way it would not be on a public registration.
    return reply.status(409).send(httpError(409, 'A platform administrator with that email already exists'))
  }

  const created = await manager(req).createSystemUser(control(req), data)
  return reply.code(201).send(present(created))
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const data = req.data()

  const unknown = invalidRoles(data.roles)
  if (unknown.length) {
    return reply.status(400).send(httpError(400, `Not control roles: ${unknown.join(', ')}`, 'ROLE_NOT_IN_SCOPE'))
  }

  const updated = await manager(req).updateSystemUserById(control(req), id, data)
  if (!updated) return reply.status(404).send()
  return reply.send(present(updated))
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  // The last door out is not one to close by accident: an instance with no administrator
  // can still be recovered, one that deleted the account it is signed in with cannot.
  if (req.systemUser?.id === id) {
    return reply.status(409).send(httpError(409, 'A platform administrator cannot delete itself', 'SELF_DELETE'))
  }

  const done = await manager(req).deleteSystemUser(control(req), id)
  if (!done) return reply.status(404).send()
  return reply.send({ ok: true })
}

export async function block(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const { reason } = req.data()
  if (req.systemUser?.id === id) {
    return reply.status(409).send(httpError(409, 'A platform administrator cannot block itself', 'SELF_BLOCK'))
  }

  await manager(req).blockSystemUserById(control(req), id, String(reason ?? ''))
  return reply.send(present(await manager(req).retrieveSystemUserById(control(req), id)))
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  await manager(req).unblockSystemUserById(control(req), id)
  return reply.send(present(await manager(req).retrieveSystemUserById(control(req), id)))
}
