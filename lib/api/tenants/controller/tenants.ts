import { FastifyReply, FastifyRequest } from 'fastify'
import type {
  ChallengeDeliveryManagement,
  ControlHandle,
  DataProvider,
  DestructionManagement,
  IdentityProviderManagement,
  ImpersonationManagement,
  MfaManagement,
  SystemUserManagement,
  ExportedArtifact,
  Tenant,
  TenantHandle,
  TenantLifecycle,
  TenantManagement,
  TenantPlace,
  TenantStrategy,
  UserManagement
} from '../../../../types/global.js'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { httpError } from '../../../util/httpError.js'
import { checkTenantPolicy, demandsEnrolment, mfaAvailable, type PolicyVerdict } from '../../../util/mfaPolicy.js'
import { checkTenantOverride } from '../../../auth/accountCreation.js'
import { absoluteStep, isReplay } from '../../../util/mfaCounter.js'
import { envInt } from '../../../util/env.js'
import { ENROLMENT_METHOD, floorEnrollable, isImplemented } from '../../../auth/validate.js'
import { maskEmail, newCode } from '../../../auth/authenticators/emailOtp.js'
import { accessCookieOf, clearAccessCookie, clearRefreshCookie, isCookieMode, setAccessCookie } from '../../../util/credential.js'
import { assertGovernanceLog, failureOf, fieldNames, governed, intend, settle } from '../../../util/governance.js'
import {
  createInPackages,
  describePackages,
  destroyInPackages,
  exportFromPackages,
  restoreInPackages,
  undoPackages,
  unrestorable
} from '../../../util/tenantLifecycle.js'
import {
  DUMP,
  ENVELOPE,
  PackageInvalidError,
  createPackage,
  openPackage,
  packageDir,
  sealPackage,
  tarPackage,
  writeEnvelope
} from '../../../util/tenantPackage.js'

//
// The tenant registry. Control scope: these routes act on the platform, never inside a
// customer's container (docs/API_V5.md §6).
//
// What these routes never do:
//   - read the registry through `global.connection.getRepository(...)`, i.e. whatever
//     connection the pool hands over: a poisoned `search_path` could make `GET /tenants`
//     list a table copied inside a tenant's schema;
//   - open a QueryRunner, point it at another tenant and release it without a reset;
//   - decide who is a platform administrator with `req.user?.tenantId === 'system'`, a
//     comparison against a field the entity does not have.
//
// Impersonation writes its record before the token exists, expires in half an hour, and can
// be revoked. See `impersonate` at the bottom of this file.
//
const managerOf = (req: FastifyRequest): TenantManagement => req.server['tenantManager']

/** The registry lives in the control plane, and nowhere else. */
const control = (req: FastifyRequest): ControlHandle => req.control as ControlHandle

//
// What these routes ask of the data layer beyond `DataProvider`. Restated here because the core
// may not import `lib/database/ports.ts` (dependency-cruiser). A provider written by a consumer
// may lack any of these, which is why every route still checks before calling.
//
interface ContainerRef {
  tenantId?: string
  locator: string
}

interface PackagedDump {
  path: string
  bytes: number
  schemaVersion: string | null
  schema: string | null
  rowCounts: Record<string, number>
}

/** What an export answers: a package is named, never located. */
interface ExportedPackage {
  package: string
  manifestSha256: string
  bytes: number
  schemaVersion: string | null
  artifacts: { name: string; bytes: number }[]
}

// A type alias and not an interface: it is stored as `Record<string, unknown>` by the
// destruction request, and only an alias is assignable to an index signature.
type ContainerPreview = {
  locator: string
  sizeBytes: number
  rowCounts: Record<string, number>
  schemaVersion: string | null
  lastExportAt?: string
}

interface ContainerProvider extends DataProvider {
  readonly strategy: TenantStrategy
  createContainer(tenant: Tenant): Promise<boolean>
  forLocator(locator: string, tenantId: string): Promise<TenantHandle>
  dropContainer(locator: string): Promise<void>
  exportContainer(tenant: Tenant, request: { target: string; schemaVersion: string | null }): Promise<PackagedDump>
  /** null when a container with that locator is already there, untouched. */
  restoreContainer?(
    locator: string,
    source: { dump: string; schema: string | null; rowCounts: Record<string, number> }
  ): Promise<{ tokenIds: string[]; founderId: string | null } | null>
  inspectContainer(tenant: Tenant): Promise<ContainerPreview>
}

interface MigrationPort {
  apply(container: ContainerRef, target?: string): Promise<string>
  version(container: ContainerRef): Promise<string | null>
  expected?(container: ContainerRef): string | null
}

/** The platform identity the destruction routes act for (`req.systemUser`). */
interface Operator {
  id: string
  externalId?: string | null
  email?: string
  mfaEnabled?: boolean
  mfaLastUsedCounter?: number | null
}

const providerOf = (req: FastifyRequest): ContainerProvider | undefined =>
  (req.server as unknown as Record<string, ContainerProvider | undefined>)['provider']

const migrationsOf = (req: FastifyRequest): MigrationPort | undefined =>
  (req.server as unknown as Record<string, MigrationPort | undefined>)['migrations']

const lifecyclesOf = (req: FastifyRequest): readonly TenantLifecycle[] => req.server.tenantLifecycles ?? []

/**
 * The package of a tenant (lib/util/tenantPackage.ts): the dump, what each package keeps for the
 * tenant outside the container, the manifest over all of them, and the operator's envelope bound
 * to it. A failure anywhere removes the folder: a package missing a part must not sit in the
 * directory looking like a whole one.
 */
async function exportTenant(
  req: FastifyRequest,
  provider: ContainerProvider,
  tenant: Tenant,
  schemaVersion: string | null
): Promise<ExportedPackage & { dir: string }> {
  const { name, dir } = createPackage(tenant, schemaVersion)
  try {
    const dump = await provider.exportContainer(tenant, { target: path.join(dir, DUMP), schemaVersion })
    const lifecycles = lifecyclesOf(req)
    const artifacts: ExportedArtifact[] = await exportFromPackages(lifecycles, tenant, dump.path)
    const described = await describePackages(lifecycles, tenant)
    const sealed = await sealPackage(dir, {
      createdAt: new Date().toISOString(),
      tenant: { name: tenant.name, slug: tenant.slug },
      schemaVersion,
      strategy: provider.strategy,
      engine: tenant.engine,
      dump: { file: DUMP, schema: dump.schema, rowCounts: dump.rowCounts },
      packages: lifecycles.map((l) => {
        const artifact = artifacts.find((a) => a.name === l.name)
        return { name: l.name, file: artifact ? path.basename(artifact.path) : null, description: described.get(l.name) ?? null }
      })
    })
    const idps: IdentityProviderManagement | undefined = req.server['identityProviderManager']
    writeEnvelope(dir, {
      manifestSha256: sealed.sha256,
      tenant,
      identityProviders: isImplemented(idps) ? await idps!.list(control(req), tenant.id) : []
    })
    return {
      package: name,
      dir,
      manifestSha256: sealed.sha256,
      bytes: sealed.bytes,
      schemaVersion,
      artifacts: artifacts.map((a) => ({ name: a.name, bytes: a.bytes }))
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

/** A package's refusal as an answer; any other error goes on. */
function refusePackage(reply: FastifyReply, error: unknown) {
  if (error instanceof PackageInvalidError) return reply.status(422).send(httpError(422, error.message, error.code))
  throw error
}

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  const tm = managerOf(req)
  if (tm?.isImplemented?.() && req.control) return false
  reply.status(503).send(httpError(503, 'Tenant registry is not available in this build', 'TENANCY_NOT_AVAILABLE'))
  return true
}

/**
 * Postgres identifiers cannot be parameterized, so a container name is always interpolated.
 * It is sanitised ONCE, before it is stored, and the stored value is the used value: saving
 * the raw name and using the sanitised one would let a registry row name a schema that does
 * not exist. A value that changes under sanitisation is rejected, not adjusted.
 */
export function sanitizeSchemaName(schema: string): string {
  return (schema || '').replace(/[^a-z0-9_]/gi, '')
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  // The records in the body and the pagination in the headers, like every other list route
  // of the framework (`/users`, `/token`). The response schema declares an array: sending the
  // whole `{ headers, records }` object makes the serializer refuse it, and the route answers
  // 500 whatever the registry contains.
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
 * Provisioning (docs/API_V5.md §6.1).
 *
 * The order is the task. A registry row written first, before a build that fails, is left
 * pointing at a container that does not work, and the next request resolves a tenant into
 * nothing. Here the row is written LAST, so it exists only for a tenant that is finished:
 * container created, schema migrated, administrator seeded and able to log in.
 *
 * If anything fails before that, the container is dropped and no row is written. Dropping is
 * safe precisely because we are before the row: what we remove is a schema created seconds
 * ago that nothing points at and that has never held a customer's data.
 */
/**
 * The ways a tenant's MFA policy is refused: weaker than the deployment floor, or
 * demanding a second factor this build cannot issue or cannot enrol anyone in, which would lock that
 * customer's users out at their next login. Shared by creation and update, so the two cannot drift.
 */
/**
 * The set of account creation modes of this tenant alone, which replaces the global one.
 * Refused when it is written, as the MFA policy is; stored in the order of the modes, so what an
 * operator reads back is what applies.
 */
function refuseAccountCreation(reply: FastifyReply, config: unknown) {
  if (!config || typeof config !== 'object') return null
  const bag = config as Record<string, unknown>
  const verdict = checkTenantOverride(bag.account_creation)
  if (!verdict.ok) return reply.status(400).send(httpError(400, `account_creation is not valid: ${verdict.message}`, 'ACCOUNT_CREATION_INVALID'))
  if (verdict.value) bag.account_creation = verdict.value
  return null
}

function refusePolicy(req: FastifyRequest, reply: FastifyReply, verdict: PolicyVerdict) {
  if (!verdict.ok) return reply.status(400).send(httpError(400, verdict.message, verdict.code))
  if (verdict.policy && demandsEnrolment(verdict.policy) && !mfaAvailable(req.server['mfaManager'])) {
    return reply
      .status(503)
      .send(httpError(503, 'This build has no MFA manager: that policy would lock this tenant out', 'MFA_NOT_AVAILABLE'))
  }
  // The floor puts a second step in every login of that tenant, and a step needs the flow store.
  if (verdict.policy && demandsEnrolment(verdict.policy) && !isImplemented(req.server['authFlowManager'])) {
    return reply
      .status(503)
      .send(httpError(503, 'This build keeps no authentication flows: that policy would lock this tenant out', 'AUTH_FLOW_NOT_AVAILABLE'))
  }
  if (verdict.policy && !floorEnrollable(verdict.policy, req.server.authRegistry, 'tenant')) {
    return reply
      .status(503)
      .send(
        httpError(
          503,
          `This build has no '${ENROLMENT_METHOD}' authenticator on the tenant plane: a user with no factor could not enrol, and that policy would lock them out`,
          'MFA_POLICY_UNSUPPORTED'
        )
      )
  }
  return null
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const data = req.data()
  const declared = String(data.locator ?? '')

  // A tenant may only tighten the deployment's MFA policy. A weaker one is refused here
  // rather than stored and ignored at read time: a value an operator can read back is a value they
  // believe applies.
  const policy = checkTenantPolicy((data.config as Record<string, unknown> | undefined)?.mfa_policy)
  const policyRefusal = refusePolicy(req, reply, policy)
  if (policyRefusal) return policyRefusal
  const creationRefusal = refuseAccountCreation(reply, data.config)
  if (creationRefusal) return creationRefusal

  // Sanitised once, before it is stored, and a value that CHANGES under sanitisation is
  // refused rather than adjusted: saving the raw name and using the sanitised one would let a
  // registry row name a schema that does not exist.
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
  // Before a container is built: the row that records the creation is written last, and a build
  // with no log to record it in would be undone anyway.
  assertGovernanceLog(req)

  const provider = providerOf(req)
  const migrations = migrationsOf(req)
  if (!provider?.createContainer || !migrations?.apply) {
    return reply.status(503).send(httpError(503, 'The data layer cannot provision containers', 'TENANCY_NOT_AVAILABLE'))
  }
  // The deployment decides how containers are kept; a row that declared another strategy would
  // describe a container that does not exist in that shape.
  const strategy = provider.strategy
  if (data.strategy !== undefined && data.strategy !== strategy) {
    return reply
      .status(400)
      .send(httpError(400, `This deployment keeps tenants with the '${strategy}' strategy`, 'TENANT_STRATEGY_MISMATCH'))
  }

  // The tenant has no identity yet: the registry assigns it when the row is written, which
  // is last. Until then the container is addressed by its locator, which is the only thing
  // that has to be true for the schema to be built and migrated.
  const slug = String(data.slug)
  const draft = { id: locator, locator, slug }
  const place: TenantPlace = { slug, locator, strategy }
  const started: TenantLifecycle[] = []
  let built = false

  try {
    // A container already there may be another tenant's: a slug check does not exclude it, since
    // two slugs can sanitise to one locator. Refused before anything is built, so the undo below
    // never drops what this request did not create.
    if (!(await provider.createContainer({ ...data, ...draft } as never))) {
      return reply.status(409).send(httpError(409, 'The container for this tenant already exists', 'TENANT_LOCATOR_TAKEN'))
    }
    built = true

    // The schema comes from the migrations, never from entity metadata: a container built by
    // synchronising a schema has no version, and a container with no version cannot be
    // migrated later. A truthy `tenantId` is what selects the tenant set.
    const schemaVersion = await migrations.apply({ tenantId: draft.id, locator })

    const container = await provider.forLocator(locator, draft.id)
    const users = req.server['userManager'] as UserManagement
    await users.createUser(container as never, {
      email: admin.email,
      username: admin.email,
      password: admin.password,
      roles: [global.roles?.admin?.code || 'admin'],
      // TRUE by default on this route: login refuses unconfirmed users, and a tenant whose
      // administrator cannot log in is not provisioned, it is broken.
      confirmed: admin.adminConfirmed !== false,
      // The sovereign of ITS container, written into the row. Each tenant has its
      // own founder and inherits nobody else's.
      isFounder: true
    })

    // The packages build their part last before the row, on a container that is already whole.
    await createInPackages(lifecyclesOf(req), place, container, started)

    const created = await governed(
      req,
      (tx) => managerOf(req).createTenant(tx, { ...data, strategy, locator, schemaVersion }),
      (row) => ({ action: 'tenant.created', tenantId: row.id, detail: { schemaVersion } })
    )

    if (log.i) log.info(`Tenant ${created.slug} provisioned in ${locator} at ${schemaVersion}`)
    return reply.code(201).send(created)
  } catch (error) {
    // Before the container: a package may keep its part outside it, where the drop does not reach.
    for (const failure of await undoPackages(started, place)) {
      if (log.e) log.error(`Tenant ${slug}: left behind after a failed creation: ${failure}`)
    }
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
  const creationRefusal = refuseAccountCreation(reply, patch.config)
  if (creationRefusal) return creationRefusal

  const tenant = await governed(
    req,
    (tx) => managerOf(req).updateTenant(tx, id, patch),
    (row) => row && { action: 'tenant.updated', tenantId: row.id, detail: { requested: fieldNames(patch) } }
  )
  if (!tenant) return await refuseUnchanged(req, reply, id)
  return reply.send(tenant)
}

/** A destroyed tenant keeps its row as the record of the destruction, and no change reaches it. */
function refuseDestroyed(reply: FastifyReply, tenant: Tenant | null) {
  if (tenant?.status !== 'destroyed') return null
  return reply
    .status(409)
    .send(httpError(409, 'This tenant was destroyed: its row is the record of that, and nothing brings it back', 'TENANT_DESTROYED'))
}

/** The manager changed nothing: either no such tenant, or one it refused to touch because it was destroyed. */
async function refuseUnchanged(req: FastifyRequest, reply: FastifyReply, id: string) {
  return refuseDestroyed(reply, await managerOf(req).getTenant(control(req), id)) ?? reply.status(404).send()
}

export async function suspend(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const { reason } = req.data()
  // The registry row has no column for the reason: this log is where it is kept.
  const done = await governed(
    req,
    (tx) => managerOf(req).suspendTenant(tx, id, reason),
    (changed) => (changed ? { action: 'tenant.suspended', tenantId: id, detail: reason ? { reason: String(reason) } : null } : null)
  )
  if (!done) return await refuseUnchanged(req, reply, id)
  return reply.send({ id, status: 'suspended' })
}

export async function restore(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const done = await governed(
    req,
    (tx) => managerOf(req).restoreTenant(tx, id),
    (changed) => (changed ? { action: 'tenant.restored', tenantId: id } : null)
  )
  if (!done) return await refuseUnchanged(req, reply, id)
  return reply.send({ id, status: 'active' })
}

/**
 * Soft-deletes the REGISTRY ROW. The container and its data survive: destroying them is a
 * separate, two-phase, exported-first operation. The response says so, because a
 * caller that believes the data is gone is a caller that stops looking after it.
 */
export async function remove(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const done = await governed(
    req,
    (tx) => managerOf(req).softDeleteTenant(tx, id),
    (changed) => (changed ? { action: 'tenant.deleted', tenantId: id } : null)
  )
  if (!done) return await refuseUnchanged(req, reply, id)
  return reply.send({ id, registryRow: 'deleted', data: 'retained', hint: 'container data is destroyed separately' })
}

/**
 * Takes a customer's data out (docs/API_V5.md §6).
 *
 * The version is read from the CONTAINER, not from the registry row, and read before the dump
 * starts: the row says what the last migration run believed, the container says what it
 * actually has, and an export is a file that will outlive both.
 *
 * The caller chooses nothing about where it lands. The directory is configuration and the package
 * name is generated, because this route is reachable over HTTP and a destination taken from a
 * request is a path traversal with extra steps. The answer names the package and its manifest's
 * hash, never a path of this machine: the file is reached through the download.
 */
export async function exportContainer(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const tenant = await managerOf(req).getTenant(control(req), id)
  if (!tenant) return reply.status(404).send()
  const destroyed = refuseDestroyed(reply, tenant)
  if (destroyed) return destroyed

  const provider = providerOf(req)
  const migrations = migrationsOf(req)
  if (!provider?.exportContainer) {
    return reply.status(503).send(httpError(503, 'This data layer cannot export a container', 'EXPORT_NOT_AVAILABLE'))
  }

  const schemaVersion = migrations?.version
    ? await migrations.version({ tenantId: tenant.id, locator: tenant.locator })
    : (tenant.schemaVersion ?? null)

  // A dump is a copy of a customer's data leaving the database, and no transaction reaches it: the
  // intent is written first, and without it the dump does not start.
  const exported = { action: 'tenant.exported', tenantId: tenant.id } as const
  const intent = await intend(req, { ...exported, detail: { schemaVersion } })
  let result: ExportedPackage & { dir: string }
  try {
    result = await exportTenant(req, provider, tenant, schemaVersion)
  } catch (error) {
    await settle(req, intent, 'failure', { ...exported, detail: { reason: failureOf(error) } })
    throw error
  }
  const { dir, ...packaged } = result
  // The log is the operator's, so it keeps where the package is next to what it is.
  await settle(req, intent, 'success', { ...exported, detail: { path: dir, ...packaged } })

  if (log.i) log.info(`Tenant ${tenant.slug}: exported ${result.bytes} bytes at ${schemaVersion ?? 'no migration'}`)
  return reply.send({ tenant: { id: tenant.id, slug: tenant.slug }, ...packaged })
}

/**
 * The package as one tar file (docs/API_V5.md §6.3). The `client` profile leaves the envelope out,
 * and is what goes to a customer; the `operator` profile is the whole package, for a restore
 * elsewhere. Checked before it is sent, as an import checks it: a package that no longer matches
 * its manifest is not handed to anyone as if it did.
 */
export async function downloadPackage(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id, package: name } = req.parameters()
  const profile = req.data().profile === 'operator' ? 'operator' : 'client'
  const dir = packageDir(name)
  if (!dir) return reply.status(404).send()

  let opened: Awaited<ReturnType<typeof openPackage>>
  try {
    opened = await openPackage(dir)
  } catch (error) {
    return refusePackage(reply, error)
  }
  // A package of another tenant is not this tenant's, whatever its name says.
  if (opened.envelope.tenant?.id !== id) return reply.status(404).send()

  const file = profile === 'operator' ? `${name}.operator.tar` : `${name}.tar`
  return reply
    .type('application/x-tar')
    .header('content-disposition', `attachment; filename="${file}"`)
    .send(tarPackage(dir, name, (relative) => profile === 'operator' || relative !== ENVELOPE))
}

/**
 * Creates a tenant from a package (docs/API_V5.md §6.4), always as a new row with a new id.
 *
 * The order is the creation's, with the dump in place of the empty container: everything is
 * checked before a container exists, the row is written last, and a failure before it drops the
 * container and undoes the packages. After it no session and no login flow of the package is
 * left, every password is a placeholder except the founder's, which the request sets, and every
 * integration token has a new `external_id`. The identity providers come back disabled and
 * without a secret, which an operator enters again.
 *
 * The dump's SQL runs with the data layer's role. A package is checked against its manifest and
 * its envelope, and a dump carrying a `psql` meta-command is refused, but a hash proves only that
 * nothing changed since it was sealed: restore only a package that stayed in the operator's custody.
 */
export async function importTenant(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const data = req.data()
  const provider = providerOf(req)
  const migrations = migrationsOf(req)
  if (!provider?.restoreContainer || !migrations?.apply) {
    return reply.status(503).send(httpError(503, 'This data layer cannot restore a container', 'RESTORE_NOT_AVAILABLE'))
  }

  const dir = packageDir(data.package)
  if (!dir) return reply.status(404).send(httpError(404, 'No package with that name in the export directory', 'RESTORE_PACKAGE_INVALID'))
  let opened: Awaited<ReturnType<typeof openPackage>>
  try {
    opened = await openPackage(dir)
  } catch (error) {
    return refusePackage(reply, error)
  }
  const { manifest, envelope } = opened

  const strategy = provider.strategy
  if (manifest.strategy !== strategy) {
    return reply
      .status(409)
      .send(httpError(409, `The package was made under '${manifest.strategy}', this deployment keeps '${strategy}'`, 'RESTORE_STRATEGY_MISMATCH'))
  }
  // The runner does not refuse a container that applied a migration it does not have: the check
  // is here, before the dump is loaded.
  const expected = migrations.expected?.({ tenantId: 'restore', locator: 'restore' }) ?? null
  if (manifest.schemaVersion && (!expected || manifest.schemaVersion > expected)) {
    return reply
      .status(409)
      .send(httpError(409, `The package is at ${manifest.schemaVersion}, newer than this build (${expected ?? 'none'})`, 'RESTORE_SCHEMA_AHEAD'))
  }
  const lifecycles = lifecyclesOf(req)
  const parts = manifest.packages.filter((p) => p.file)
  const missing = unrestorable(lifecycles, parts.map((p) => p.name))
  if (missing.length) {
    return reply
      .status(409)
      .send(httpError(409, `This build cannot restore what the package holds for: ${missing.join(', ')}`, 'RESTORE_PACKAGE_UNAVAILABLE'))
  }

  // The configuration is checked as on a creation: the policies of this deployment may be stricter
  // than those of the one that made the package.
  const config = { ...((envelope.tenant?.config as Record<string, unknown> | undefined) ?? {}) }
  const policyRefusal = refusePolicy(req, reply, checkTenantPolicy(config.mfa_policy))
  if (policyRefusal) return policyRefusal
  const creationRefusal = refuseAccountCreation(reply, config)
  if (creationRefusal) return creationRefusal

  const slug = String(data.slug ?? envelope.tenant?.slug ?? '')
  const name = String(data.name ?? envelope.tenant?.name ?? slug)
  if (!/^[a-z0-9_-]+$/.test(slug)) {
    return reply.status(422).send(httpError(422, 'The package names no usable slug: send one', 'RESTORE_PACKAGE_INVALID'))
  }
  const declared = String(data.locator ?? '')
  if (declared && sanitizeSchemaName(declared) !== declared) {
    return reply
      .status(400)
      .send(httpError(400, 'The container name contains characters that are not allowed', 'TENANT_LOCATOR_INVALID'))
  }
  const locator = declared || locatorFor(slug)
  if (await managerOf(req).getTenantBySlug(control(req), slug)) {
    return reply.status(409).send(httpError(409, 'A tenant with that slug already exists', 'TENANT_EXISTS'))
  }
  assertGovernanceLog(req)

  const place: TenantPlace = { slug, locator, strategy }
  const started: TenantLifecycle[] = []
  let built = false

  try {
    const restored = await provider.restoreContainer(locator, {
      dump: path.join(dir, manifest.dump.file),
      schema: manifest.dump.schema,
      rowCounts: manifest.dump.rowCounts
    })
    if (!restored) {
      return reply.status(409).send(httpError(409, 'The container for this tenant already exists', 'TENANT_LOCATOR_TAKEN'))
    }
    built = true
    if (!restored.founderId) {
      throw Object.assign(new Error('The package has no founder whose password the restore could set'), {
        statusCode: 422,
        error: 'Unprocessable Entity',
        code: 'RESTORE_FOUNDER_MISSING'
      })
    }

    const schemaVersion = await migrations.apply({ tenantId: locator, locator })
    const container = await provider.forLocator(locator, locator)
    const tokens = req.server['tokenManager'] as { resetExternalId?(ctx: unknown, id: string): Promise<string> } | undefined
    if (restored.tokenIds.length && !tokens?.resetExternalId) {
      throw Object.assign(new Error('This build cannot renew the integration tokens of the package'), {
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'RESTORE_NOT_AVAILABLE'
      })
    }
    for (const id of restored.tokenIds) await tokens!.resetExternalId!(container, id)
    const users = req.server['userManager'] as UserManagement
    await users.resetPassword(container as never, { id: restored.founderId }, String(data.founderPassword))

    await restoreInPackages(lifecycles, place, container, new Map(parts.map((p) => [p.name, path.join(dir, p.file!)])), started)

    const idps: IdentityProviderManagement | undefined = req.server['identityProviderManager']
    const providers = isImplemented(idps) ? envelope.identityProviders ?? [] : []
    const created = await governed(
      req,
      async (tx) => {
        const row = await managerOf(req).createTenant(tx, { name, slug, strategy, engine: manifest.engine, locator, config, schemaVersion })
        for (const idp of providers) {
          await idps!.create(tx, { tenantId: row.id, key: idp.key, type: idp.type, status: 'disabled', config: idp.config })
        }
        return row
      },
      (row) => ({
        action: 'tenant.imported',
        tenantId: row.id,
        detail: {
          sourceTenantId: envelope.tenant?.id ?? null,
          package: String(data.package),
          manifestSha256: opened.sha256,
          schemaVersion,
          tokens: restored.tokenIds.length,
          identityProviders: providers.length
        }
      })
    )

    if (log.i) log.info(`Tenant ${created.slug} restored in ${locator} at ${schemaVersion} from ${String(data.package)}`)
    return reply.code(201).send(created)
  } catch (error) {
    for (const failure of await undoPackages(started, place)) {
      if (log.e) log.error(`Tenant ${slug}: left behind after a failed restore: ${failure}`)
    }
    if (built) {
      try {
        await provider.dropContainer(locator)
      } catch (cleanup) {
        if (log.e) log.error(`Tenant ${slug}: could not remove the container ${locator} after a failed restore: ${(cleanup as Error)?.message}`)
      }
    }
    if (log.e) log.error(`Tenant ${slug}: restore failed, no registry row was written: ${(error as Error)?.message}`)
    throw error
  }
}

/**
 * Records that the tenant went elsewhere (docs/API_V5.md §6.5): the row turns `moved`, with the
 * destination, and the event names the package it went with. The container stays until a
 * destruction removes it; a `moved` tenant serves nothing, and `restore` makes it active again.
 */
export async function move(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const { id } = req.parameters()
  const { destination, package: name } = req.data()
  const tenant = await managerOf(req).getTenant(control(req), id)
  if (!tenant) return reply.status(404).send()
  const destroyed = refuseDestroyed(reply, tenant)
  if (destroyed) return destroyed

  const dir = packageDir(name)
  if (!dir) return reply.status(404).send(httpError(404, 'No package with that name in the export directory', 'RESTORE_PACKAGE_INVALID'))
  let opened: Awaited<ReturnType<typeof openPackage>>
  try {
    opened = await openPackage(dir)
  } catch (error) {
    return refusePackage(reply, error)
  }
  if (opened.envelope.tenant?.id !== tenant.id) {
    return reply.status(409).send(httpError(409, 'That package was not exported from this tenant', 'TENANT_PACKAGE_MISMATCH'))
  }

  const done = await governed(
    req,
    (tx) => managerOf(req).markTenantMoved(tx, tenant.id, String(destination)),
    (changed) =>
      changed
        ? { action: 'tenant.moved', tenantId: tenant.id, detail: { destination: String(destination), package: name, manifestSha256: opened.sha256 } }
        : null
  )
  if (!done) return await refuseUnchanged(req, reply, id)
  return reply.send({ id: tenant.id, status: 'moved', movedTo: String(destination) })
}

// ---------------------------------------------------------------------------------------
// Destruction, in two phases (docs/API_V5.md §6.2)
//
// This is the one operation the framework cannot undo, so it is the one place where every
// step is a deliberate obstacle rather than a convenience:
//
//   - the first phase REPORTS what will be destroyed, exactly: the container, its size, the rows per
//     table. An operator who is about to lose a customer's data should see it counted;
//   - the token it returns is shown once and stored only as a hash, lasts ten minutes and is
//     good for a single use;
//   - the second phase takes the token, the slug TYPED AGAIN, and a second factor, all three IN
//     THE BODY. The factor is the operator's TOTP, or, without MFA, a code the first phase emails
//     to the address on file through `challengeDeliveryManager`. A token in the URL lands in proxy
//     access logs, browser history and tracing systems, which is a copy of the permission nobody
//     meant to make;
//   - the export runs FIRST and must produce a real file. No export, no destruction;
//   - the event is written BEFORE the data goes, because afterwards there may be nothing left
//     to write with;
//   - calling it twice is not an error. The second answer is `alreadyDestroyed`.
//
// What it cannot promise, and llms.txt §2.13 says so: **the data is still in your backups** until
// those backups expire.
// ---------------------------------------------------------------------------------------
// Ten minutes by default, and read from the environment. Bounded on both sides: a window of one
// second makes the two-phase
// destruction unusable, and one of a day makes the "one-time, short-lived" part a fiction.
const DESTRUCTION_TTL_SECONDS = envInt('DESTRUCTION_TOKEN_TTL', 600, { min: 30, max: 3600 })

const destructions = (req: FastifyRequest): DestructionManagement | undefined => req.server['destructionManager']

export async function destructionRequest(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const dm = destructions(req)
  const provider = providerOf(req)
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
  const destroyed = refuseDestroyed(reply, tenant)
  if (destroyed) return destroyed

  // Refused here, before a token exists: a permission the second phase could never accept is worse
  // than no permission, because it looks like one.
  const delivery: ChallengeDeliveryManagement | undefined = req.server['challengeDeliveryManager']
  const byEmail = !actor.mfaEnabled
  if (byEmail && (!isImplemented(delivery) || !actor.email)) {
    return reply
      .status(503)
      .send(
        httpError(
          503,
          'This operator has no second factor the platform can reach: enrol in MFA (POST /system/auth/mfa/setup), or wire a challengeDeliveryManager for emailed codes',
          'DESTRUCTION_FACTOR_NOT_AVAILABLE'
        )
      )
  }

  const preview = await provider.inspectContainer(tenant)
  // Shown once. What the row keeps is its hash, so a leaked control plane leaks nothing that
  // can destroy anything.
  const token = crypto.randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + DESTRUCTION_TTL_SECONDS * 1000)
  const code = byEmail ? newCode('verify') : undefined

  const record = await governed(
    req,
    (tx) => dm.openRequest(tx, { tenantId: tenant.id, systemUserId: actor.id, token, code, preview, expiresAt }),
    (opened) => ({
      action: 'tenant.destruction_requested',
      tenantId: tenant.id,
      detail: { requestId: opened.id, factor: code ? 'email-otp' : 'totp', expiresAt: expiresAt.toISOString() }
    })
  )

  if (code) {
    try {
      // Awaited, unlike the login's: the operator is authenticated, so the latency tells nobody
      // anything, and a code that did not leave must not be waited for.
      await delivery!.deliver({
        channel: 'email',
        to: actor.email!,
        code,
        purpose: 'destruction',
        expiresAt,
        plane: 'control',
        tenantId: tenant.id,
        subjectId: actor.externalId ?? actor.id
      })
    } catch (error) {
      if (log.w) log.warn(`Destruction code for ${tenant.slug} not delivered to ${actor.email} (${(error as Error)?.message})`)
      return reply.status(503).send(httpError(503, 'The code could not be sent: ask again, or enrol in MFA', 'DESTRUCTION_FACTOR_NOT_AVAILABLE'))
    }
  }

  if (log.w) log.warn(`Destruction requested for ${tenant.slug} by ${actor.email}: ${JSON.stringify(preview.rowCounts)}`)

  return reply.send({
    requestId: record.id,
    token,
    expiresAt,
    factor: code ? { method: 'email-otp', destination: maskEmail(actor.email!) } : { method: 'totp' },
    preview: { ...preview, lastExportAt: null },
    warning: 'Destroying a container does not remove it from backups taken before now.'
  })
}

export async function destroyData(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return

  const dm = destructions(req)
  const provider = providerOf(req)
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
  // Idempotent: a tenant marked destroyed, or whose registry row is gone, has already been
  // through this, and the second caller is told so instead of being handed an error to interpret.
  if (!tenant || tenant.status === 'destroyed') return reply.send({ id, alreadyDestroyed: true })

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

  const factor: { ok: boolean; message: string; remaining?: number } = request.codeHash
    ? await verifyEmailedCode(req, dm, request.id, String(token), String(otp))
    : await verifySecondFactor(req, actor, String(otp))
  if (!factor.ok) {
    // `remaining` travels as data, like a login's: the console words it, the message is for logs.
    const refusal = httpError(403, factor.message, 'DESTRUCTION_OTP_INVALID')
    return reply.status(403).send(factor.remaining === undefined ? refusal : { ...refusal, remaining: factor.remaining })
  }

  // The intent comes before anything the destruction does, the export included, and without it
  // nothing starts. Every way out below closes it; the success rides the transaction that marks the row.
  const destroyed = { action: 'tenant.destroyed', tenantId: tenant.id } as const
  const intent = await intend(req, { ...destroyed, detail: { requestId: request.id } })
  const stopped = (reason: string) => settle(req, intent, 'failure', { ...destroyed, detail: { requestId: request.id, reason } })

  // The export happens first, and a failure stops everything: no export, no destruction.
  let exported: (ExportedPackage & { dir: string }) | undefined
  try {
    const migrations = migrationsOf(req)
    const schemaVersion = migrations?.version
      ? await migrations.version({ tenantId: tenant.id, locator: tenant.locator })
      : (tenant.schemaVersion ?? null)

    exported = await exportTenant(req, provider, tenant, schemaVersion)
  } catch (error) {
    if (log.e) log.error(`Destruction of ${tenant.slug} stopped: the export failed: ${(error as Error)?.message}`)
    await stopped('DESTRUCTION_EXPORT_FAILED')
    return reply
      .status(409)
      .send(httpError(409, `The export had to succeed first, and it did not: ${(error as Error)?.message}`, 'DESTRUCTION_EXPORT_FAILED'))
  }

  if (!exported?.package || !exported?.bytes) {
    if (exported?.dir) fs.rmSync(exported.dir, { recursive: true, force: true })
    await stopped('DESTRUCTION_EXPORT_FAILED')
    return reply.status(409).send(httpError(409, 'The export produced no file', 'DESTRUCTION_EXPORT_FAILED'))
  }

  // Written BEFORE the data goes: afterwards there may be nothing left to write with. A request
  // spent in the meantime by a concurrent call with the same token is that call's destruction.
  if (!(await dm.consumeRequest(control(req), request.id, exported.package))) {
    await stopped('DESTRUCTION_TOKEN_INVALID')
    return reply.status(403).send(httpError(403, 'That destruction token is not usable', 'DESTRUCTION_TOKEN_INVALID'))
  }
  if (log.w) {
    log.warn(`Destroying ${tenant.slug} (${tenant.locator}) for ${actor.email}, exported to ${exported.dir}`)
  }

  // The tenant's own identity providers live in the control plane, so dropping the container
  // does not reach them, and each one carries a client secret of the customer's. They go
  // before the container: a failure here leaves a tenant that can still be destroyed with a
  // new request, while a failure after the drop would leave the secrets behind a spent token.
  const exportRef = exported.package
  let removedProviders = 0
  let dropped = false
  try {
    const idps: IdentityProviderManagement | undefined = req.server['identityProviderManager']
    if (isImplemented(idps)) {
      removedProviders = await idps!.removeAll(control(req), tenant.id)
      if (removedProviders && log.w) log.warn(`Destroying ${tenant.slug}: removed ${removedProviders} identity provider(s)`)
    }

    // What the packages keep outside the container goes before it, for the same reason.
    const lifecycles = lifecyclesOf(req)
    await destroyInPackages(lifecycles, tenant)

    await provider.dropContainer(tenant.locator)
    dropped = true
    const artifacts = exported.artifacts.map((a) => a.name)
    const packages = lifecycles.filter((l) => l.destroy).map((l) => l.name)
    await governed(
      req,
      (tx) => managerOf(req).markTenantDestroyed(tx, tenant.id),
      () => ({
        ...destroyed,
        detail: {
          requestId: request.id,
          exportRef,
          manifestSha256: exported.manifestSha256,
          artifacts,
          packages,
          identityProviders: removedProviders
        }
      }),
      { intentId: intent }
    )
  } catch (error) {
    // Said with how far it went: a failure after the drop is data that is gone behind a row that
    // still says otherwise.
    await settle(req, intent, 'failure', {
      ...destroyed,
      detail: { requestId: request.id, reason: failureOf(error), containerDropped: dropped }
    })
    throw error
  }

  return reply.send({
    id: tenant.id,
    slug: tenant.slug,
    destroyed: true,
    exportRef: exported.package,
    manifestSha256: exported.manifestSha256,
    artifacts: exported.artifacts.map((a) => a.name),
    warning: 'The data remains in any backup taken before now, until that backup expires.'
  })
}

/** The code the first phase emailed, with the login's attempts: past the last one, only a new request helps. */
async function verifyEmailedCode(
  req: FastifyRequest,
  dm: DestructionManagement,
  requestId: string,
  token: string,
  code: string
): Promise<{ ok: boolean; message: string; remaining?: number }> {
  const { ok, remaining } = await dm.checkCode(control(req), requestId, {
    token,
    code,
    maxAttempts: global.authFlows.limits.otpMaxAttempts
  })
  if (ok) return { ok: true, message: '' }
  return {
    ok: false,
    remaining,
    message: remaining > 0 ? `The code is not valid: ${remaining} attempt(s) left` : 'No attempts left: request the destruction again'
  }
}

/** The operator's TOTP, the factor the first phase settles on whenever the operator has MFA. */
async function verifySecondFactor(req: FastifyRequest, actor: Operator, otp: string): Promise<{ ok: boolean; message: string }> {
  const mfa: MfaManagement | undefined = req.server['mfaManager']
  const systemUsers: SystemUserManagement = req.server['systemUserManager']

  if (!actor.mfaEnabled) {
    return {
      ok: false,
      // MFA disabled between the two phases: the request was opened for a TOTP nobody can type now.
      message: 'This operator no longer has MFA: request the destruction again'
    }
  }
  if (!mfa?.verify) return { ok: false, message: 'No MFA manager is available to verify the second factor' }

  const secret = await systemUsers.retrieveMfaSecret(control(req), actor.id)
  if (!secret) return { ok: false, message: 'This operator has MFA enabled but no secret on file' }

  // A verifier answers with a DELTA, and comparing it against the stored STEP reads every valid
  // code as already spent: an operator with a second factor could never destroy anything, with a
  // message saying the opposite of what is happening.
  const { valid, counter } = absoluteStep(await mfa.verify(otp, secret))
  if (!valid) return { ok: false, message: 'The code is not valid' }
  // The step is spent: the same code cannot destroy a second container.
  if (isReplay(counter, actor.mfaLastUsedCounter)) {
    return { ok: false, message: 'That code has already been used' }
  }
  if (counter !== null) await systemUsers.recordMfaCounter(control(req), actor.id, counter)
  return { ok: true, message: '' }
}

// ---------------------------------------------------------------------------------------
// Impersonation (docs/AUTHORIZATION_V5.md §6)
//
// A claim in a token and nothing else is not enough: it leaves no record of who entered whose
// data or why, and no way to stop a session once issued.
//
// The order of operations below is not a detail: the record is written
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

  const container = await provider.tenant(tenant, req.dataScope)
  const users = req.server['userManager'] as UserManagement
  const target =
    (await users.retrieveUserById(container, String(userId))) ??
    (await users.retrieveUserByEmail(container, String(userId)))
  if (!target) return reply.status(404).send()

  const ttl = impersonationTtl()
  const record = await governed(
    req,
    (tx) =>
      im.openImpersonation(tx, {
        systemUserId: actor.id,
        tenantId: tenant.id,
        targetUserId: target.id,
        reason: String(reason).trim(),
        ip: req.ip ?? null,
        userAgent: (req.headers['user-agent'] as string) ?? null,
        expiresAt: new Date(Date.now() + ttl * 1000)
      }),
    (opened) => ({
      action: 'impersonation.started',
      tenantId: tenant.id,
      targetId: target.id,
      detail: { impersonationId: opened.id, reason: opened.reason, expiresAt: new Date(opened.expiresAt).toISOString() }
    })
  )

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

  const revoked = await governed(
    req,
    async (tx) => {
      // Read for the tenant and the user it names; an expired one reads as nothing and is still revoked.
      const live = await im.getImpersonation(tx, String(impersonationId))
      return (await im.revokeImpersonation(tx, String(impersonationId))) ? { live } : null
    },
    (closed) =>
      closed && {
        action: 'impersonation.ended',
        tenantId: closed.live?.tenantId ?? null,
        targetId: closed.live?.targetUserId ?? null,
        detail: { impersonationId: String(impersonationId) }
      }
  )
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
