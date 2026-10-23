import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, SystemUserManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import * as regExp from '../../../util/regexp.js'
import { isSystemRoleCode } from '../../../loader/roles.js'
import { includesRole } from '../../../util/authz.js'
import { present } from './systemAuth.js'
import { controlPolicy } from '../../../util/mfaPolicy.js'
import { recordControlAccess } from '../../../util/accessLog.js'
import { fieldNames, governed } from '../../../util/governance.js'

//
// Platform identities, managed from the control scope.
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

const SUPERUSER = 'system:admin'

/**
 * The apex of the control plane, as `admin` is a tenant's: only a superuser grants `system:admin`,
 * and only a superuser changes, removes, blocks, unblocks or resets one. Whoever else holds
 * `system-users` manages the other operators, and could otherwise make itself sovereign through an
 * account of its own. A token never carries `system:admin`, so it is never the superuser here.
 */
const isSuperuser = (req: FastifyRequest) => includesRole(req.roles?.() ?? [], SUPERUSER)

const apexRefused = (reply: FastifyReply, message: string) => reply.status(403).send(httpError(403, message, 'SUPERUSER_ONLY'))

async function actsOnSuperuser(req: FastifyRequest, id: unknown): Promise<boolean> {
  if (isSuperuser(req)) return false
  const target = await manager(req).retrieveSystemUserById(control(req), String(id))
  return includesRole(target?.roles, SUPERUSER)
}

/**
 * Whether the subject is the last superuser who can sign in. Only a role change can take the plane
 * to none: a superuser cannot delete or block itself, and nobody else may act on one. A blocked
 * superuser does not count, since only a superuser could unblock it. `roles` is an array column,
 * so the filter is `arrayContains`: `in` compares the whole array and Postgres refuses it.
 */
async function isLastSuperuser(req: FastifyRequest, id: unknown): Promise<boolean> {
  const target = await manager(req).retrieveSystemUserById(control(req), String(id))
  if (!includesRole(target?.roles, SUPERUSER) || target?.blocked) return false
  return Number(await manager(req).countQuery(control(req), { 'roles:arrayContains': SUPERUSER, blocked: 'false' })) <= 1
}

/**
 * The way back for an operator who lost the device.
 *
 * It belongs to whoever holds `system-users`, never to the person concerned: on a plane where
 * `MANDATORY` is the setting to recommend, a second factor its owner can remove alone is a second
 * factor the policy cannot hold. The same reason the tenant scope gives this to an admin only.
 */
export async function resetMfa(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  if (!id) return reply.status(400).send(httpError(400, 'Missing user id'))

  const target = await manager(req).retrieveSystemUserById(control(req), String(id))
  if (!target) return reply.status(404).send()
  if (!isSuperuser(req) && includesRole(target.roles, SUPERUSER)) return apexRefused(reply, "Only a superuser resets a superuser's second factor")

  await governed(
    req,
    (tx) => manager(req).disableMfa(tx, target.id),
    () => ({ action: 'system_user.mfa_reset', targetId: target.id })
  )
  await recordControlAccess(req, { event: 'mfa.disabled', outcome: 'success', subjectId: target.externalId ?? null, methods: ['totp'] })
  if (log.i) log.info(`System MFA reset for ${target.email}, policy ${controlPolicy()}`)
  return { ok: true }
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
  if (!isSuperuser(req) && includesRole(data.roles, SUPERUSER)) return apexRefused(reply, 'Only a superuser grants system:admin')

  const existing = await manager(req).retrieveSystemUserByEmail(control(req), String(data.email))
  if (existing) {
    // The platform's own user list is not public, and this route is behind a capability, so
    // an explicit conflict is safe here in a way it would not be on a public registration.
    return reply.status(409).send(httpError(409, 'A platform administrator with that email already exists'))
  }

  const created = await governed(
    req,
    (tx) => manager(req).createSystemUser(tx, data),
    (row) => ({ action: 'system_user.created', targetId: row.id, detail: { roles: row.roles ?? [] } })
  )
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
  if (!isSuperuser(req) && includesRole(data.roles, SUPERUSER)) return apexRefused(reply, 'Only a superuser grants system:admin')
  if (await actsOnSuperuser(req, id)) return apexRefused(reply, 'Only a superuser changes a superuser')
  if (Array.isArray(data.roles) && !includesRole(data.roles, SUPERUSER) && (await isLastSuperuser(req, id))) {
    return reply.status(409).send(httpError(409, 'The last superuser cannot give system:admin away', 'LAST_SUPERUSER'))
  }

  // The roles are kept as they became: a grant is the change an auditor looks for first.
  const updated = await governed(
    req,
    (tx) => manager(req).updateSystemUserById(tx, id, data),
    (row) =>
      row && {
        action: 'system_user.updated',
        targetId: row.id,
        detail: { requested: fieldNames(data), ...(Array.isArray(data.roles) ? { roles: row.roles } : {}) }
      }
  )
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
  if (await actsOnSuperuser(req, id)) return apexRefused(reply, 'Only a superuser removes a superuser')

  const done = await governed(
    req,
    (tx) => manager(req).deleteSystemUser(tx, id),
    (changed) => (changed ? { action: 'system_user.deleted', targetId: id } : null)
  )
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
  if (await actsOnSuperuser(req, id)) return apexRefused(reply, 'Only a superuser blocks a superuser')

  // The manager answers true whether or not the row exists: the event is written only for one that does.
  await governed(
    req,
    async (tx) =>
      (await manager(req).retrieveSystemUserById(tx, id)) && (await manager(req).blockSystemUserById(tx, id, String(reason ?? ''))),
    (changed) => (changed ? { action: 'system_user.blocked', targetId: id, detail: reason ? { reason: String(reason) } : null } : null)
  )
  return reply.send(present(await manager(req).retrieveSystemUserById(control(req), id)))
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  if (await actsOnSuperuser(req, id)) return apexRefused(reply, 'Only a superuser unblocks a superuser')
  await governed(
    req,
    async (tx) => (await manager(req).retrieveSystemUserById(tx, id)) && (await manager(req).unblockSystemUserById(tx, id)),
    (changed) => (changed ? { action: 'system_user.unblocked', targetId: id } : null)
  )
  return reply.send(present(await manager(req).retrieveSystemUserById(control(req), id)))
}
