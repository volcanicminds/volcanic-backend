import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, IdentityProvider, IdentityProviderManagement, TenantManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import { PROVIDER_KEY, providerShapeProblems } from '../../../auth/providers.js'

//
// A tenant's own identity providers, written by the platform (T-12.26, F38).
//
// The operator with `tenants` writes them, as the operator writes the tenant's MFA policy: a
// customer does not configure how its users are let in from inside the container those users can
// reach. The shape is checked here and nowhere later, with no network call: an issuer that does not
// answer is a problem of the login that uses it, not of the row that names it.
//
const registry = (req: FastifyRequest): TenantManagement => req.server['tenantManager']
const providers = (req: FastifyRequest): IdentityProviderManagement => req.server['identityProviderManager']
const control = (req: FastifyRequest): ControlHandle => req.control as ControlHandle

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (registry(req)?.isImplemented?.() && providers(req)?.isImplemented?.() && req.control) return false
  reply.status(503).send(httpError(503, 'Identity providers are not available in this build', 'IDENTITY_PROVIDERS_NOT_AVAILABLE'))
  return true
}

/** The registry row the path names, or null once a 404 has been sent. */
async function tenantOf(req: FastifyRequest, reply: FastifyReply): Promise<string | null> {
  const { id } = req.params as { id: string }
  const tenant = await registry(req).getTenant(control(req), String(id))
  if (!tenant) {
    reply.status(404).send(httpError(404, 'Tenant not found', 'NOT_FOUND'))
    return null
  }
  return tenant.id
}

function invalid(reply: FastifyReply, problems: string[]) {
  return reply.status(400).send(httpError(400, `The provider is not valid: ${problems.join('; ')}`, 'IDP_CONFIG_INVALID'))
}

const shown = (provider: IdentityProvider, hasClientSecret?: boolean) =>
  hasClientSecret === undefined ? provider : { ...provider, hasClientSecret }

export async function list(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const tenantId = await tenantOf(req, reply)
  if (!tenantId) return
  return reply.send(await providers(req).list(control(req), tenantId))
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const tenantId = await tenantOf(req, reply)
  if (!tenantId) return
  const { key } = req.params as { key: string }
  const found = await providers(req).get(control(req), tenantId, String(key))
  if (!found) return reply.status(404).send(httpError(404, 'Identity provider not found', 'NOT_FOUND'))
  // `get` is the one method that decrypts the secret; it goes no further than this line.
  const { clientSecret, ...provider } = found
  return reply.send(shown(provider, Boolean(clientSecret)))
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const tenantId = await tenantOf(req, reply)
  if (!tenantId) return
  const body = req.body as { key: string; type: 'oidc'; status?: 'active' | 'disabled'; config: Record<string, unknown>; clientSecret?: string | null }

  const problems = PROVIDER_KEY.test(body.key) ? [] : ["key must be lowercase letters, digits, '-' or '_', starting with a letter or a digit"]
  problems.push(...providerShapeProblems(body.config, { plane: 'tenant' }))
  if (problems.length) return invalid(reply, problems)

  if (await providers(req).get(control(req), tenantId, body.key)) {
    return reply.status(409).send(httpError(409, `This tenant already has a provider '${body.key}'`, 'IDP_KEY_TAKEN'))
  }
  const created = await providers(req).create(control(req), {
    tenantId,
    key: body.key,
    type: body.type,
    status: body.status,
    config: body.config as never,
    clientSecret: body.clientSecret ?? null
  })
  if (log.i) log.info(`Identity provider '${body.key}' added to tenant ${tenantId}`)
  return reply.status(201).send(shown(created, Boolean(body.clientSecret)))
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const tenantId = await tenantOf(req, reply)
  if (!tenantId) return
  const { key } = req.params as { key: string }
  const body = (req.body ?? {}) as { status?: 'active' | 'disabled'; config?: Record<string, unknown>; clientSecret?: string | null }

  // `config` is replaced whole, so it is validated whole: a patch merged into the stored settings
  // could only be judged after the merge, and the merge is exactly what hides a missing field.
  if (body.config !== undefined) {
    const problems = providerShapeProblems(body.config, { plane: 'tenant' })
    if (problems.length) return invalid(reply, problems)
  }
  const updated = await providers(req).update(control(req), tenantId, String(key), {
    status: body.status,
    config: body.config as never,
    clientSecret: body.clientSecret
  })
  if (!updated) return reply.status(404).send(httpError(404, 'Identity provider not found', 'NOT_FOUND'))
  return reply.send(updated)
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const tenantId = await tenantOf(req, reply)
  if (!tenantId) return
  const { key } = req.params as { key: string }
  const removed = await providers(req).remove(control(req), tenantId, String(key))
  if (!removed) return reply.status(404).send(httpError(404, 'Identity provider not found', 'NOT_FOUND'))
  if (log.i) log.info(`Identity provider '${key}' removed from tenant ${tenantId}`)
  return reply.send({ ok: true })
}
