import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, TenantManagement } from '../../../../types/global.js'
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
// Impersonation is not reimplemented here on purpose. It needs the system-role model and a
// persisted, revocable record, which is T-4.1 and T-4.2; a version of it that leaves no
// trace is worse than not having it. The route comes back with them.
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
