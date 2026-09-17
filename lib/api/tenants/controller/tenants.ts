import { FastifyReply, FastifyRequest } from 'fastify'
import type {
  ControlHandle,
  DataProvider,
  ImpersonationManagement,
  TenantManagement,
  UserManagement
} from '../../../../types/global.js'
import crypto from 'crypto'
import { httpError } from '../../../util/httpError.js'
import { checkTenantPolicy, demandsEnrolment, mfaAvailable, type PolicyVerdict } from '../../../util/mfaPolicy.js'
import { envInt } from '../../../util/env.js'
import { accessCookieOf, clearAccessCookie, clearRefreshCookie, isCookieMode, setAccessCookie } from '../../../util/credential.js'

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

  // The records in the body and the pagination in the headers, like every other list route
  // of the framework (`/users`, `/token`). This one sent the whole `{ headers, records }`
  // object while its response schema declared an array, so the serializer refused it and the
  // route answered 500 whatever the registry contained.
  const { headers, records } = await managerOf(req).listTenants(control(req), req.data())
  return reply.type('application/json').headers(headers as never).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const tenant = await managerOf(req).getTenant(control(req), id)
  if (!tenant) return reply.status(404).send()
  return reply.send(tenant)
}

/**
 * The container name, derived when the caller did not send one.
 *
 * Prefixed because a container name is a schema name, and an unprefixed one collides with
 * whatever else the database already calls `public`, `information_schema` or the name of a
 * table. The slug is sanitised on the way in, so the derived value is a valid identifier by
 * construction and never triggers the 400 below.
 */
export function locatorFor(slug: string): string {
  return `tenant_${sanitizeSchemaName(String(slug))}`
}

/**
 * Provisioning (T-6.1, docs/API_V5.md §6.1).
 *
 * The order is the task. v4 wrote the registry row first and then tried to build the
 * container; if the build failed, a row was left pointing at a container that does not work,
 * and the next request resolved a tenant into nothing. Here the row is written LAST, so it
 * exists only for a tenant that is finished: container created, schema migrated, administrator
 * seeded and able to log in.
 *
 * If anything fails before that, the container is dropped and no row is written. Dropping is
 * safe precisely because we are before the row: what we remove is a schema created seconds
 * ago that nothing points at and that has never held a customer's data.
 */
/**
 * The two ways a tenant's MFA policy is refused (T-10.19): weaker than the deployment floor, or
 * demanding a second factor this build cannot issue, which would lock that customer's users out at
 * their next login. Shared by creation and update, so the two cannot drift apart.
 */
function refusePolicy(req: FastifyRequest, reply: FastifyReply, verdict: PolicyVerdict) {
  if (!verdict.ok) return reply.status(400).send(httpError(400, verdict.message, verdict.code))
  if (verdict.policy && demandsEnrolment(verdict.policy) && !mfaAvailable(req.server['mfaManager'])) {
    return reply
      .status(503)
      .send(httpError(503, 'This build has no MFA manager: that policy would lock this tenant out', 'MFA_NOT_AVAILABLE'))
  }
  return null
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const data = req.data()
  const declared = String(data.locator ?? '')

  // A tenant may only tighten the deployment's MFA policy (T-10.19). A weaker one is refused here
  // rather than stored and ignored at read time: a value an operator can read back is a value they
  // believe applies.
  const policy = checkTenantPolicy((data.config as Record<string, unknown> | undefined)?.mfa_policy)
  const policyRefusal = refusePolicy(req, reply, policy)
  if (policyRefusal) return policyRefusal

  // Sanitised once, before it is stored, and a value that CHANGES under sanitisation is
  // refused rather than adjusted: v4 saved the raw name and used the sanitised one, so a
  // registry row could name a schema that does not exist (defect D-20).
  if (declared && sanitizeSchemaName(declared) !== declared) {
    return reply
      .status(400)
      .send(httpError(400, 'The container name contains characters that are not allowed', 'TENANT_LOCATOR_INVALID'))
  }

  const locator = declared || locatorFor(data.slug)
  const admin = data.admin ?? {}

  const existing = await managerOf(req).getTenantBySlug(control(req), String(data.slug))
  if (existing) {
    return reply.status(409).send(httpError(409, 'A tenant with that slug already exists', 'TENANT_EXISTS'))
  }

  const provider = (req.server as unknown as Record<string, DataProvider & Record<string, any>>)['provider']
  const migrations = (req.server as unknown as Record<string, any>)['migrations']
  if (!provider?.createContainer || !migrations?.apply) {
    return reply.status(503).send(httpError(503, 'The data layer cannot provision containers', 'TENANCY_NOT_AVAILABLE'))
  }

  // The tenant has no identity yet: the registry assigns it when the row is written, which
  // is last. Until then the container is addressed by its locator, which is the only thing
  // that has to be true for the schema to be built and migrated.
  const slug = String(data.slug)
  const draft = { id: locator, locator, slug }
  let built = false

  try {
    await provider.createContainer({ ...data, ...draft } as never)
    built = true

    // The schema comes from the migrations, never from entity metadata: a container built by
    // synchronising a schema has no version, and a container with no version cannot be
    // migrated later (T-5.1). A truthy `tenantId` is what selects the tenant set.
    const schemaVersion = await migrations.apply({ tenantId: draft.id, locator })

    const container = await provider.forLocator(locator, draft.id)
    const users = req.server['userManager'] as UserManagement
    await users.createUser(container as never, {
      email: admin.email,
      username: admin.email,
      password: admin.password,
      roles: [global.roles?.admin?.code || 'admin'],
      // TRUE by default on this route, and that is defect D-08: v4 seeded the administrator
      // unconfirmed, login refused unconfirmed users, and no API could confirm one. A tenant
      // whose administrator cannot log in is not provisioned, it is broken.
      confirmed: admin.adminConfirmed !== false,
      // The sovereign of ITS container, written into the row (T-4.3). Each tenant has its
      // own founder and inherits nobody else's.
      isFounder: true
    })

    const created = await managerOf(req).createTenant(control(req), { ...data, locator, schemaVersion })

    if (log.i) log.info(`Tenant ${created.slug} provisioned in ${locator} at ${schemaVersion}`)
    return reply.code(201).send(created)
  } catch (error) {
    if (built) {
      try {
        await provider.dropContainer(locator)
      } catch (cleanup) {
        // Said out loud: a container left behind by a failed provisioning is an orphan
        // nothing points at, and the operator has to know it is there.
        if (log.e) log.error(`Tenant ${slug}: could not remove the container ${locator} after a failed creation: ${(cleanup as Error)?.message}`)
      }
    }
    if (log.e) log.error(`Tenant ${slug}: provisioning failed, no registry row was written: ${(error as Error)?.message}`)
    throw error
  }
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const patch = req.data()

  // Same rule as on creation: the policy of a tenant may tighten the deployment's, never loosen it.
  const policy = checkTenantPolicy((patch.config as Record<string, unknown> | undefined)?.mfa_policy)
  const policyRefusal = refusePolicy(req, reply, policy)
  if (policyRefusal) return policyRefusal

  const tenant = await managerOf(req).updateTenant(control(req), id, patch)
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

/**
 * Takes a customer's data out (T-6.2, docs/API_V5.md §6).
 *
 * The version is read from the CONTAINER, not from the registry row, and read before the dump
 * starts: the row says what the last migration run believed, the container says what it
 * actually has, and an export is a file that will outlive both.
 *
 * The caller chooses nothing about where it lands. The directory is configuration and the file
 * name is generated, because this route is reachable over HTTP and a destination taken from a
 * request is a path traversal with extra steps.
 */
export async function exportContainer(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const tenant = await managerOf(req).getTenant(control(req), id)
  if (!tenant) return reply.status(404).send()

  const provider = (req.server as unknown as Record<string, any>)['provider']
  const migrations = (req.server as unknown as Record<string, any>)['migrations']
  if (!provider?.exportContainer) {
    return reply.status(503).send(httpError(503, 'This data layer cannot export a container', 'EXPORT_NOT_AVAILABLE'))
  }

  const schemaVersion = migrations?.version
    ? await migrations.version({ tenantId: tenant.id, locator: tenant.locator })
    : (tenant.schemaVersion ?? null)

  const result = await provider.exportContainer(tenant, {
    directory: global.config?.options?.export_directory,
    schemaVersion
  })

  if (log.i) log.info(`Tenant ${tenant.slug}: exported ${result.bytes} bytes at ${schemaVersion ?? 'no migration'}`)
  return reply.send({ tenant: { id: tenant.id, slug: tenant.slug }, ...result })
}

// ---------------------------------------------------------------------------------------
// Destruction, in two phases (T-6.3, docs/API_V5.md §6.2)
//
// This is the one operation the framework cannot undo, so it is the one place where every
// step is a deliberate obstacle rather than a convenience:
//
//   - phase 1 REPORTS what will be destroyed, exactly: the container, its size, the rows per
//     table. An operator who is about to lose a customer's data should see it counted;
//   - the token it returns is shown once and stored only as a hash, lasts ten minutes and is
//     good for a single use;
//   - phase 2 takes the token, the slug TYPED AGAIN, and a second factor, all three IN THE
//     BODY. A token in the URL lands in proxy access logs, browser history and tracing
//     systems, which is a copy of the permission nobody meant to make;
//   - the export runs FIRST and must produce a real file. No export, no destruction;
//   - the event is written BEFORE the data goes, because afterwards there may be nothing left
//     to write with;
//   - calling it twice is not an error. The second answer is `alreadyDestroyed`.
//
// What it cannot promise, and the README says so: **the data is still in your backups** until
// those backups expire.
// ---------------------------------------------------------------------------------------
// Ten minutes by default, and read from the environment: documented since v5 and consulted by
// nobody until T-9.4. Bounded on both sides — a window of one second makes the two-phase
// destruction unusable, and one of a day makes the "one-time, short-lived" part a fiction.
const DESTRUCTION_TTL_SECONDS = envInt('DESTRUCTION_TOKEN_TTL', 600, { min: 30, max: 3600 })

const destructions = (req: FastifyRequest): any => req.server['destructionManager']

export async function destructionRequest(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const dm = destructions(req)
  const provider = (req.server as unknown as Record<string, any>)['provider']
  if (!dm?.isImplemented?.() || !provider?.inspectContainer) {
    return reply.status(503).send(httpError(503, 'Destruction is not available in this build', 'DESTRUCTION_NOT_AVAILABLE'))
  }

  const actor = req.systemUser
  if (!actor) {
    return reply.status(403).send(httpError(403, 'Destroying data requires a platform identity', 'SCOPE_MISMATCH'))
  }

  const { id } = req.parameters()
  const tenant = await managerOf(req).getTenant(control(req), id)
  if (!tenant) return reply.status(404).send()

  const preview = await provider.inspectContainer(tenant)
  // Shown once. What the row keeps is its hash, so a leaked control plane leaks nothing that
  // can destroy anything.
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + DESTRUCTION_TTL_SECONDS * 1000)

  const record = await dm.openRequest(control(req), {
    tenantId: tenant.id,
    systemUserId: actor.id,
    token,
    preview,
    expiresAt
  })

  if (log.w) log.warn(`Destruction requested for ${tenant.slug} by ${actor.email}: ${JSON.stringify(preview.rowCounts)}`)

  return reply.send({
    requestId: record.id,
    token,
    expiresAt,
    preview: { ...preview, lastExportAt: null },
    warning: 'Destroying a container does not remove it from backups taken before now.'
  })
}

export async function destroyData(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const dm = destructions(req)
  const provider = (req.server as unknown as Record<string, any>)['provider']
  if (!dm?.isImplemented?.() || !provider?.dropContainer || !provider?.exportContainer) {
    return reply.status(503).send(httpError(503, 'Destruction is not available in this build', 'DESTRUCTION_NOT_AVAILABLE'))
  }

  const actor = req.systemUser
  if (!actor) {
    return reply.status(403).send(httpError(403, 'Destroying data requires a platform identity', 'SCOPE_MISMATCH'))
  }

  const { id } = req.parameters()
  const { token, slug, otp } = req.data()

  const tenant = await managerOf(req).getTenant(control(req), id)
  // Idempotent: a tenant whose registry row is gone has already been through this, and the
  // second caller is told so instead of being handed an error to interpret.
  if (!tenant) return reply.send({ id, alreadyDestroyed: true })

  if (!token || !slug || !otp) {
    return reply.status(400).send(httpError(400, 'token, slug and otp are all required, in the body', 'DESTRUCTION_TOKEN_INVALID'))
  }

  const request = await dm.findLiveRequest(control(req), tenant.id, String(token))
  if (!request) {
    return reply.status(403).send(httpError(403, 'That destruction token is not usable', 'DESTRUCTION_TOKEN_INVALID'))
  }
  if (request.systemUserId !== actor.id) {
    // The permission belongs to the operator who asked for it. Handing the token to someone
    // else is how a two-person control becomes one person with two windows open.
    return reply.status(403).send(httpError(403, 'That destruction token belongs to another operator', 'DESTRUCTION_TOKEN_INVALID'))
  }
  if (String(slug) !== tenant.slug) {
    return reply.status(400).send(httpError(400, 'The slug does not match the tenant', 'DESTRUCTION_SLUG_MISMATCH'))
  }

  const factor = await verifySecondFactor(req, actor, String(otp))
  if (!factor.ok) return reply.status(403).send(httpError(403, factor.message, 'DESTRUCTION_OTP_INVALID'))

  // The export happens first, and a failure stops everything. Decision 2 of
  // EVO_PUNTI_APERTI: no export, no destruction.
  let exported: any
  try {
    const migrations = (req.server as unknown as Record<string, any>)['migrations']
    const schemaVersion = migrations?.version
      ? await migrations.version({ tenantId: tenant.id, locator: tenant.locator })
      : (tenant.schemaVersion ?? null)

    exported = await provider.exportContainer(tenant, {
      directory: global.config?.options?.export_directory,
      schemaVersion
    })
  } catch (error) {
    if (log.e) log.error(`Destruction of ${tenant.slug} stopped: the export failed: ${(error as Error)?.message}`)
    return reply
      .status(409)
      .send(httpError(409, `The export had to succeed first, and it did not: ${(error as Error)?.message}`, 'DESTRUCTION_EXPORT_FAILED'))
  }

  if (!exported?.path || !exported?.bytes) {
    return reply.status(409).send(httpError(409, 'The export produced no file', 'DESTRUCTION_EXPORT_FAILED'))
  }

  // Written BEFORE the data goes: afterwards there may be nothing left to write with.
  await dm.consumeRequest(control(req), request.id, exported.path)
  if (log.w) {
    log.warn(`Destroying ${tenant.slug} (${tenant.locator}) for ${actor.email}, exported to ${exported.path}`)
  }

  await provider.dropContainer(tenant.locator)
  await managerOf(req).softDeleteTenant(control(req), tenant.id)

  return reply.send({
    id: tenant.id,
    slug: tenant.slug,
    destroyed: true,
    exportRef: exported.path,
    warning: 'The data remains in any backup taken before now, until that backup expires.'
  })
}

/**
 * The operator's second factor.
 *
 * TOTP only, and this is a deliberate narrowing of docs/API_V5.md §6.2, which also allowed a
 * one-time code emailed to an operator without MFA. The framework has no email pipeline of its
 * own, and inventing one on the path of its only irreversible operation would mean the second
 * factor is as strong as an SMTP configuration nobody reviewed. An operator who may destroy a
 * customer's data enrols in MFA first; the refusal says exactly that.
 */
async function verifySecondFactor(req: FastifyRequest, actor: any, otp: string): Promise<{ ok: boolean; message: string }> {
  const mfa = req.server['mfaManager'] as any
  const systemUsers = req.server['systemUserManager'] as any

  if (!actor.mfaEnabled) {
    return {
      ok: false,
      message: 'Destroying a container needs a second factor: enrol this operator in MFA (POST /system/auth/mfa/setup) first'
    }
  }
  if (!mfa?.verify) return { ok: false, message: 'No MFA manager is available to verify the second factor' }

  const secret = await systemUsers.retrieveMfaSecret(req.control, actor.id)
  if (!secret) return { ok: false, message: 'This operator has MFA enabled but no secret on file' }

  const counter = await mfa.verify(otp, secret)
  if (counter == null) return { ok: false, message: 'The code is not valid' }
  // The step is spent: the same code cannot destroy a second container.
  if (actor.mfaLastUsedCounter != null && Number(counter) <= Number(actor.mfaLastUsedCounter)) {
    return { ok: false, message: 'That code has already been used' }
  }
  await systemUsers.recordMfaCounter(req.control, actor.id, Number(counter))
  return { ok: true, message: '' }
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
  // `userId` accepts the row's id OR its email address. An operator impersonating "the
  // administrator of globex" has the address; the id of a row inside a customer's container
  // is not something they can look up, and asking them to would mean reading that container
  // first, which is the thing impersonation exists to make accountable.
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
  const target =
    (await users.retrieveUserById(container, String(userId))) ??
    (await users.retrieveUserByEmail(container, String(userId)))
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

  // In cookie mode the session goes where every tenant session goes, the tenant cookie, and
  // the body carries `null`: an impersonation is the most valuable token this API mints, and
  // a copy readable by the page is exactly what the cookie exists to prevent. The operator's
  // own session is in the control cookie and survives, so the session that can end this one
  // is never the one it replaced. A tenant refresh cookie left in this browser is dropped: an
  // impersonation is not renewable, and nothing left behind may make it look as if it were.
  const cookie = isCookieMode()
  if (cookie) {
    setAccessCookie(reply, 'tenant', token)
    clearRefreshCookie(reply, 'tenant')
  }

  return reply.send({
    token: cookie ? null : token,
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

  // The record is what kills the session; the cookie goes too, but only when it holds THIS
  // impersonation, so ending one never drops a tenant session opened after it.
  const held = accessCookieOf(req, 'tenant')
  if (held) {
    let claims: { imp?: string } | null = null
    try {
      claims = req.server.jwt.verify(held, { ignoreExpiration: true }) as { imp?: string }
    } catch {
      claims = null
    }
    if (claims?.imp === String(impersonationId)) clearAccessCookie(reply, 'tenant')
  }

  return reply.send({ id: impersonationId, revoked: true })
}
