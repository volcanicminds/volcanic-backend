import { FastifyReply, FastifyRequest } from 'fastify'
import type {
  ControlHandle,
  DataProvider,
  ImpersonationManagement,
  TenantManagement,
  UserManagement
} from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'

//
// The tenant registry. Control scope: these routes act on the platform, never inside a
// customer's container (docs/API_V5.md §6).
//
// What v4 did here and v5 does not:
//   - it read the registry through `global.connection.getRepository(...)`, i.e. whatever
//     connection the pool handed over, which is how a poisoned `search_path` could make
//     `GET /tenants` list a table copied inside a tenant's schema (D-01);
//   - it opened a QueryRunner, pointed it at another tenant and released it without a
//     reset, in the impersonation path (D-02);
//   - it decided who was a platform administrator with `req.user?.tenantId === 'system'`,
//     a comparison against a field the entity does not have: dead code guarding a
//     privilege boundary (D-18).
//
// Impersonation is back (T-4.2), and it is a different thing from the v4 one: the record is
// written before the token exists, it expires in half an hour instead of a day, and it can
// be revoked. See `impersonate` at the bottom of this file.
//
const managerOf = (req: FastifyRequest): TenantManagement => req.server['tenantManager']

/** The registry lives in the control plane, and nowhere else. */
const control = (req: FastifyRequest): ControlHandle => req.control as ControlHandle

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  const tm = managerOf(req)
  if (tm?.isImplemented?.() && req.control) return false
  reply.status(503).send(httpError(503, 'Tenant registry is not available in this build', 'TENANCY_NOT_AVAILABLE'))
  return true
}

/**
 * Postgres identifiers cannot be parameterized, so a container name is always interpolated.
 * It is sanitised ONCE, before it is stored, and the stored value is the used value: v4
 * saved the raw name and used the sanitised one, so a registry row could name a schema that
 * did not exist (D-20). A value that changes under sanitisation is rejected, not adjusted.
 */
export function sanitizeSchemaName(schema: string): string {
  return (schema || '').replace(/[^a-z0-9_]/gi, '')
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  return reply.send(await managerOf(req).listTenants(control(req), req.data()))
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const tenant = await managerOf(req).getTenant(control(req), id)
  if (!tenant) return reply.status(404).send()
  return reply.send(tenant)
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const data = req.data()
  const locator = String(data.locator ?? '')
  if (locator && sanitizeSchemaName(locator) !== locator) {
    return reply
      .status(400)
      .send(httpError(400, 'The container name contains characters that are not allowed', 'TENANT_LOCATOR_INVALID'))
  }

  return reply.code(201).send(await managerOf(req).createTenant(control(req), data))
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const tenant = await managerOf(req).updateTenant(control(req), id, req.data())
  if (!tenant) return reply.status(404).send()
  return reply.send(tenant)
}

export async function suspend(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const { reason } = req.data()
  const done = await managerOf(req).suspendTenant(control(req), id, reason)
  if (!done) return reply.status(404).send()
  return reply.send({ id, status: 'suspended' })
}

export async function restore(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const done = await managerOf(req).restoreTenant(control(req), id)
  if (!done) return reply.status(404).send()
  return reply.send({ id, status: 'active' })
}

/**
 * Soft-deletes the REGISTRY ROW. The container and its data survive: destroying them is a
 * separate, two-phase, exported-first operation (T-6.3). The response says so, because a
 * caller that believes the data is gone is a caller that stops looking after it.
 */
export async function remove(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const done = await managerOf(req).softDeleteTenant(control(req), id)
  if (!done) return reply.status(404).send()
  return reply.send({ id, registryRow: 'deleted', data: 'retained', hint: 'container data is destroyed separately' })
}

// ---------------------------------------------------------------------------------------
// Impersonation (T-4.2, docs/AUTHORIZATION_V5.md §6)
//
// Defect D-18 was not that impersonation existed: it was that it left a claim in a token and
// nothing else. No record of who entered whose data or why, twenty-four hours of validity,
// no way to stop a session once issued, and a privilege check comparing `req.user.tenantId`
// against the string 'system' on an entity that had no such field, so the guard never fired.
//
// The order of operations below is the fix, and it is not a detail: the record is written
// FIRST, and the token is minted from it. A token issued before the trail exists is a token
// whose trail can fail to be written.
// ---------------------------------------------------------------------------------------
const HARD_MAX_TTL = 4 * 3600
const DEFAULT_TTL = 1800

const impersonations = (req: FastifyRequest): ImpersonationManagement => req.server['impersonationManager']

/** Half an hour by default, four hours whatever the configuration says. */
export function impersonationTtl(): number {
  const configured = Number(global.config?.options?.impersonation_ttl)
  const ttl = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL
  return Math.min(ttl, HARD_MAX_TTL)
}

export async function impersonate(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const im = impersonations(req)
  if (!im?.isImplemented?.()) {
    return reply.status(503).send(httpError(503, 'Impersonation is not available in this build', 'IMPERSONATION_NOT_AVAILABLE'))
  }

  const actor = req.systemUser
  if (!actor) {
    // The capability already gated the route; this catches the deployment shape where a
    // control route authenticates an application user (no `tenants` block). Impersonation
    // needs a platform identity to attribute the session to, and there is none.
    return reply.status(403).send(httpError(403, 'Impersonation requires a platform identity', 'SCOPE_MISMATCH'))
  }

  const { id } = req.parameters()
  const { userId, reason } = req.data()

  // The reason is what makes the record worth keeping, so it is required and it is checked
  // before anything else happens.
  if (!reason || String(reason).trim().length < 3) {
    return reply.status(400).send(httpError(400, 'A stated reason is required', 'REASON_REQUIRED'))
  }
  if (!userId) {
    return reply.status(400).send(httpError(400, 'userId is required', 'USER_REQUIRED'))
  }

  const tenant = await managerOf(req).getTenant(control(req), id)
  if (!tenant || tenant.status !== 'active') return reply.status(404).send()

  // The target is looked up INSIDE the container, which is the only place it exists. A
  // system user is not a member of the tenant, and this is the step that proves the user
  // being impersonated is real rather than a plausible id.
  const provider = (req.server as unknown as Record<string, DataProvider | undefined>)['provider']
  if (!provider) {
    return reply.status(503).send(httpError(503, 'The data layer is not loaded', 'TENANCY_NOT_AVAILABLE'))
  }

  const container = await provider.tenant(tenant.id, req.dataScope)
  const users = req.server['userManager'] as UserManagement
  const target = await users.retrieveUserById(container, String(userId))
  if (!target) return reply.status(404).send()

  const ttl = impersonationTtl()
  const record = await im.openImpersonation(control(req), {
    systemUserId: actor.id,
    tenantId: tenant.id,
    targetUserId: target.id,
    reason: String(reason).trim(),
    ip: req.ip ?? null,
    userAgent: (req.headers['user-agent'] as string) ?? null,
    expiresAt: new Date(Date.now() + ttl * 1000)
  })

  if (log.w) {
    log.warn(`Impersonation ${record.id}: ${actor.email} acting as ${target.email} in ${tenant.slug}. Reason: ${record.reason}`)
  }

  // A TENANT token, not a control one: inside the container the session is an ordinary user,
  // with that user's roles and nothing more. `imp` is what every later request is checked
  // against, so the session dies with the record and not with the signature.
  const token = await reply.jwtSign({ sub: target.externalId, tid: tenant.id, imp: record.id }, { expiresIn: ttl })

  return reply.send({
    token,
    impersonationId: record.id,
    expiresAt: record.expiresAt,
    tenant: { id: tenant.id, slug: tenant.slug },
    user: { id: target.id, email: target.email }
  })
}

export async function endImpersonation(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const im = impersonations(req)
  if (!im?.isImplemented?.()) {
    return reply.status(503).send(httpError(503, 'Impersonation is not available in this build', 'IMPERSONATION_NOT_AVAILABLE'))
  }

  const { impersonationId } = req.data()
  if (!impersonationId) {
    return reply.status(400).send(httpError(400, 'impersonationId is required', 'IMPERSONATION_REQUIRED'))
  }

  const revoked = await im.revokeImpersonation(control(req), String(impersonationId))
  // 404 whether the record never existed or was already closed: the two answers are the same
  // to a caller and telling them apart would let one probe the register from outside.
  if (!revoked) return reply.status(404).send()

  if (log.i) log.info(`Impersonation ${impersonationId} revoked by ${req.systemUser?.email ?? 'unknown'}`)
  return reply.send({ id: impersonationId, revoked: true })
}
