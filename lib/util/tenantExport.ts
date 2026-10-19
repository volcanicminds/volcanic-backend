import type { FastifyReply, FastifyRequest } from 'fastify'
import fs from 'fs'
import path from 'path'
import { Transform, pipeline } from 'stream'
import type {
  ControlHandle,
  DataProvider,
  ExportedArtifact,
  GovernanceLogManagement,
  IdentityProviderManagement,
  PackageProfile,
  Tenant,
  TenantHandle,
  TenantLifecycle,
  TenantManagement,
  TenantStrategy
} from '../../types/global.js'
import { envInt } from './env.js'
import { assertGovernanceLog, failureOf, intend, settle, type Unattended } from './governance.js'
import { httpError } from './httpError.js'
import { isTenancyEnabled } from './tenancy.js'
import { describePackages, exportFromPackages, packInPackages } from './tenantLifecycle.js'
import {
  DUMP,
  ENVELOPE,
  PackageInvalidError,
  PackageSignatureError,
  createPackage,
  exportRoot,
  openPackage,
  packageDir,
  packageNames,
  peekPackage,
  removePackage,
  sealPackage,
  sweepPackages,
  tarPackage,
  writeEnvelope,
  type PackageSlot
} from './tenantPackage.js'

//
// The export and the download of a tenant's package, for both planes (docs/API_V5.md §6.3). The
// routes are thin: the control plane names the tenant in its path, the tenant plane takes it from
// the token, and everything below receives an id it does not question.
//
// A package belongs to the tenant its envelope names, and sits in a slot: one per tenant in each
// plane. A new export of a slot replaces the previous one once its own is sealed; two exports of
// one slot at once are refused, under a lock the data layer holds across processes. The tenant
// plane's exports are counted on the governance log, and the cleanup removes a slot's package
// older than TENANT_EXPORT_RETENTION_DAYS. The export of a destruction has no slot: nothing here
// replaces or expires it.
//

//
// What the export asks of the data layer beyond `DataProvider`. Restated here because the core
// may not import `lib/database/ports.ts` (dependency-cruiser). A provider written by a consumer
// may lack any of these, which is why every route still checks before calling.
//
export interface ContainerRef {
  tenantId?: string
  locator: string
}

export interface PackagedDump {
  path: string
  bytes: number
  schemaVersion: string | null
  schema: string | null
  rowCounts: Record<string, number>
}

/** What an export answers: a package is named, never located. */
export interface ExportedPackage {
  package: string
  profile: PackageProfile
  manifestSha256: string
  /** False without PACKAGE_SIGNING_KEY: such a package can be downloaded, never restored. */
  signed: boolean
  bytes: number
  schemaVersion: string | null
  artifacts: { name: string; bytes: number }[]
}

// A type alias and not an interface: it is stored as `Record<string, unknown>` by the
// destruction request, and only an alias is assignable to an index signature.
export type ContainerPreview = {
  locator: string
  sizeBytes: number
  rowCounts: Record<string, number>
  schemaVersion: string | null
  lastExportAt?: string
}

export interface ContainerProvider extends DataProvider {
  readonly strategy: TenantStrategy
  createContainer(tenant: Tenant): Promise<boolean>
  forLocator(locator: string, tenantId: string): Promise<TenantHandle>
  dropContainer(locator: string): Promise<void>
  /** `pack` runs on the scratch copy, after the credentials are emptied and before the rows are counted. */
  exportContainer(
    tenant: Tenant,
    request: { target: string; schemaVersion: string | null; pack?: (handle: TenantHandle) => Promise<void> }
  ): Promise<PackagedDump>
  /** null when a container with that locator is already there, untouched. */
  restoreContainer?(
    locator: string,
    source: { dump: string; schema: string | null; rowCounts: Record<string, number> }
  ): Promise<{ tokenIds: string[]; founderId: string | null } | null>
  inspectContainer(tenant: Tenant): Promise<ContainerPreview>
  /** Runs `fn` under a lock no other process holds, or answers null when one does. */
  withLock?<T>(name: string, fn: () => Promise<T>): Promise<T | null>
}

export interface MigrationPort {
  apply(container: ContainerRef, target?: string): Promise<string>
  version(container: ContainerRef): Promise<string | null>
  expected?(container: ContainerRef): string | null
}

export const providerOf = (req: FastifyRequest): ContainerProvider | undefined =>
  (req.server as unknown as Record<string, ContainerProvider | undefined>)['provider']

export const migrationsOf = (req: FastifyRequest): MigrationPort | undefined =>
  (req.server as unknown as Record<string, MigrationPort | undefined>)['migrations']

export const lifecyclesOf = (req: FastifyRequest): readonly TenantLifecycle[] => req.server.tenantLifecycles ?? []

const control = (req: FastifyRequest): ControlHandle => req.control as ControlHandle

/** Exports of the tenant plane allowed per tenant in a window of seconds, failed ones included. */
export const exportQuota = (): { max: number; windowSeconds: number } => ({
  max: envInt('TENANT_EXPORT_MAX', 3, { max: 100 }),
  windowSeconds: envInt('TENANT_EXPORT_WINDOW', 3600)
})

/** Per address on the export and download routes of both planes: ten times the quota, a minute. */
export const exportRateLimit = () => ({ max: 10 * exportQuota().max, timeWindow: 60_000 })

/**
 * The cleanup of old packages: on with TENANT_EXPORT_RETENTION_DAYS above zero and the scheduler
 * on, where there are tenants. `off` says why not, for the warning at the start.
 */
export function exportRetention(): { days: number; off: string | null } {
  const days = envInt('TENANT_EXPORT_RETENTION_DAYS', 0)
  if (!isTenancyEnabled()) return { days, off: 'this deployment has no tenants' }
  if (days <= 0) return { days, off: 'TENANT_EXPORT_RETENTION_DAYS is not set' }
  if (!global.config?.options?.scheduler) return { days, off: 'the scheduler is off' }
  return { days, off: null }
}

/**
 * The warning at the start where there are tenants and the cleanup is off. A warning and not a
 * refusal: a package left on the server is a cost the project may accept. True when it warned.
 */
export function warnExportCleanupOff(): boolean {
  const { off } = exportRetention()
  if (!isTenancyEnabled() || !off) return false
  if (log.w) {
    log.warn(
      `Export cleanup is off (${off}): a tenant's package stays on the server until the next export of its slot ` +
        'replaces it. Set TENANT_EXPORT_RETENTION_DAYS and `scheduler: true` (docs/CONFIGURATION_V5.md).'
    )
  }
  return true
}

/** A destroyed tenant keeps its row as the record of the destruction, and no change reaches it. */
export function refuseDestroyed(reply: FastifyReply, tenant: Tenant | null) {
  if (tenant?.status !== 'destroyed') return null
  return reply
    .status(409)
    .send(httpError(409, 'This tenant was destroyed: its row is the record of that, and nothing brings it back', 'TENANT_DESTROYED'))
}

/** The lock of a slot: an export takes it for its whole run, the cleanup for each removal. */
const slotLock = (tenantId: string, slot: PackageSlot) => `export:${tenantId}:${slot}`

/**
 * The package of a tenant (lib/util/tenantPackage.ts): the dump, what each package keeps for the
 * tenant outside the container, the manifest over all of them, and the operator's envelope bound
 * to it. The profile is chosen here and only here: the packages' `pack` writes the dump for it,
 * and the envelope is written on the server for both, since the download reads it. A failure
 * anywhere removes the folder: a package missing a part must not sit in the directory looking like
 * a whole one. Without a slot the package is nobody's to replace: a destruction's.
 */
export async function exportTenant(
  req: FastifyRequest,
  provider: ContainerProvider,
  tenant: Tenant,
  schemaVersion: string | null,
  profile: PackageProfile,
  slot: PackageSlot | null
): Promise<ExportedPackage & { dir: string }> {
  const { name, dir } = createPackage(tenant, schemaVersion)
  try {
    const lifecycles = lifecyclesOf(req)
    const packed: { unpack?: Set<string> } = {}
    const pack = async (handle: TenantHandle) => void (packed.unpack = await packInPackages(lifecycles, tenant, handle, profile))
    const dump = await provider.exportContainer(tenant, { target: path.join(dir, DUMP), schemaVersion, pack })
    // A data layer written by a project may not know the hook: its dump would hand out what the
    // application meant to empty.
    if (!packed.unpack && lifecycles.some((l) => l.pack)) throw new Error('The data layer exported the container without running pack')
    const artifacts: ExportedArtifact[] = await exportFromPackages(lifecycles, tenant, dump.path)
    const described = await describePackages(lifecycles, tenant)
    const sealed = await sealPackage(dir, {
      createdAt: new Date().toISOString(),
      tenant: { name: tenant.name, slug: tenant.slug },
      profile,
      schemaVersion,
      strategy: provider.strategy,
      engine: tenant.engine,
      dump: { file: DUMP, schema: dump.schema, rowCounts: dump.rowCounts },
      packages: lifecycles.map((l) => {
        const artifact = artifacts.find((a) => a.name === l.name)
        return {
          name: l.name,
          file: artifact ? path.basename(artifact.path) : null,
          unpack: packed.unpack?.has(l.name) ?? false,
          description: described.get(l.name) ?? null
        }
      })
    })
    const idps: IdentityProviderManagement | undefined = req.server['identityProviderManager']
    const { signed } = writeEnvelope(dir, {
      manifestSha256: sealed.sha256,
      tenant,
      ...(slot ? { slot } : {}),
      identityProviders: idps?.isImplemented?.() ? await idps.list(control(req), tenant.id) : []
    })
    if (!signed && log.w) log.warn(`Tenant ${tenant.slug}: package ${name} is not signed, and no instance will restore it (PACKAGE_SIGNING_KEY)`)
    return {
      package: name,
      dir,
      profile,
      manifestSha256: sealed.sha256,
      signed,
      bytes: sealed.bytes,
      schemaVersion,
      artifacts: artifacts.map((a) => ({ name: a.name, bytes: a.bytes }))
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw error
  }
}

/** The packages of a tenant's slot, read from their envelopes; a folder still being written has none yet. */
function slotPackages(tenantId: string, slot: PackageSlot): { name: string; manifestSha256: string; createdAt: string }[] {
  const found: { name: string; manifestSha256: string; createdAt: string }[] = []
  for (const name of packageNames()) {
    const peeked = peekPackage(path.join(exportRoot(), name))
    if (peeked?.envelope.tenant?.id !== tenantId || peeked.envelope.slot !== slot) continue
    found.push({ name, manifestSha256: String(peeked.envelope.manifestSha256), createdAt: String(peeked.manifest.createdAt) })
  }
  return found
}

/**
 * Seconds until the tenant may export again from its own plane, or 0. The exports counted are the
 * intents of the tenant plane in the window, failed ones included: the work was done either way.
 */
async function quotaWait(req: FastifyRequest, tenantId: string): Promise<number> {
  const { max, windowSeconds } = exportQuota()
  const { manager, ctx } = assertGovernanceLog(req)
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const { records } = await manager.findQuery(ctx, {
    action: 'tenant.exported',
    outcome: 'intent',
    actorPlane: 'tenant',
    tenantId,
    'occurredAt:ge': since,
    _sort: '-occurredAt',
    _pageSize: String(max)
  })
  if (records.length < max) return 0
  // The newest `max` are in the window: the oldest of them leaving it frees one export.
  const frees = new Date(records[max - 1].occurredAt).getTime() + windowSeconds * 1000
  return Math.max(1, Math.ceil((frees - Date.now()) / 1000))
}

/**
 * Exports a tenant into a slot and answers for the route. The intent is written before the dump,
 * and without it the dump does not start; the success names what it replaced.
 *
 * The caller chooses nothing about where it lands. The directory is configuration and the package
 * name is generated, because these routes are reachable over HTTP and a destination taken from a
 * request is a path traversal with extra steps. The answer names the package and its manifest's
 * hash, never a path of this machine: the file is reached through the download.
 */
export async function exportPackage(
  req: FastifyRequest,
  reply: FastifyReply,
  request: { tenantId: string; profile: PackageProfile; slot: PackageSlot }
) {
  const tenants: TenantManagement = req.server['tenantManager']
  const tenant = await tenants.getTenant(control(req), request.tenantId)
  if (!tenant) return reply.status(404).send()
  const destroyed = refuseDestroyed(reply, tenant)
  if (destroyed) return destroyed

  const provider = providerOf(req)
  if (!provider?.exportContainer || !provider.withLock) {
    return reply.status(503).send(httpError(503, 'This data layer cannot export a container', 'EXPORT_NOT_AVAILABLE'))
  }

  const { slot, profile } = request
  const done = await provider.withLock(slotLock(tenant.id, slot), async () => {
    // Counted under the lock: two requests of one tenant cannot both read the count below the quota.
    if (slot === 'tenant') {
      const wait = await quotaWait(req, tenant.id)
      if (wait > 0) {
        return reply
          .status(429)
          .header('retry-after', String(wait))
          .send(httpError(429, `This tenant used its exports for now: try again in ${wait} seconds`, 'EXPORT_QUOTA_EXCEEDED'))
      }
    }
    return await exportInSlot(req, reply, provider, tenant, profile, slot)
  })
  if (done === null) {
    return reply.status(409).send(httpError(409, 'Another export of this tenant is running in the same plane', 'EXPORT_IN_PROGRESS'))
  }
  return done
}

/**
 * The version is read from the CONTAINER, not from the registry row, and read before the dump
 * starts: the row says what the last migration run believed, the container says what it actually
 * has, and an export is a file that will outlive both.
 */
async function exportInSlot(
  req: FastifyRequest,
  reply: FastifyReply,
  provider: ContainerProvider,
  tenant: Tenant,
  profile: PackageProfile,
  slot: PackageSlot
) {
  const migrations = migrationsOf(req)
  const schemaVersion = migrations?.version
    ? await migrations.version({ tenantId: tenant.id, locator: tenant.locator })
    : (tenant.schemaVersion ?? null)

  // A dump is a copy of a customer's data leaving the database, and no transaction reaches it: the
  // intent is written first, and without it the dump does not start.
  const exported = { action: 'tenant.exported', tenantId: tenant.id } as const
  const intent = await intend(req, { ...exported, detail: { schemaVersion, profile, slot } })
  let result: ExportedPackage & { dir: string }
  try {
    result = await exportTenant(req, provider, tenant, schemaVersion, profile, slot)
  } catch (error) {
    await settle(req, intent, 'failure', { ...exported, detail: { slot, reason: failureOf(error) } })
    throw error
  }

  // Only now, with the new one sealed: a failed export leaves the previous package where it was.
  sweepPackages()
  const replaced = slotPackages(tenant.id, slot)
    .filter((previous) => previous.name !== result.package)
    .map((previous) => ({ package: previous.name, manifestSha256: previous.manifestSha256, removed: removePackage(previous.name) }))

  const { dir, ...packaged } = result
  // The log is the operator's, so it keeps where the package is next to what it is.
  await settle(req, intent, 'success', { ...exported, detail: { path: dir, slot, ...packaged, replaced } })

  if (log.i) log.info(`Tenant ${tenant.slug}: exported a ${profile} package of ${result.bytes} bytes at ${schemaVersion ?? 'no migration'}`)
  return reply.send({ tenant: { id: tenant.id, slug: tenant.slug }, ...packaged })
}

/** A package's refusal as an answer; any other error goes on. */
export function refusePackage(reply: FastifyReply, error: unknown) {
  if (error instanceof PackageInvalidError || error instanceof PackageSignatureError) {
    return reply.status(422).send(httpError(422, error.message, error.code))
  }
  throw error
}

/**
 * The package as one tar file (docs/API_V5.md §6.3), in the profile its manifest names and in no
 * other: the dump was written for that profile. A `client` package leaves the envelope out, and is
 * what goes to a customer; an `operator` package is whole, for a restore elsewhere. Checked before
 * it is sent, as an import checks it: a package that no longer matches its manifest is not handed
 * to anyone as if it did.
 *
 * Whose it is comes first, from the envelope: a package of another tenant answers as an unknown
 * name, before anything about it is checked. `operator: false` does the same for that profile.
 * The intent is written before the first byte, and without it nothing is sent; the outcome when
 * the stream ends, with the bytes that left.
 */
export async function sendPackage(
  req: FastifyRequest,
  reply: FastifyReply,
  request: { tenantId: string; name: unknown; operator: boolean }
) {
  const dir = packageDir(request.name)
  if (!dir || peekPackage(dir)?.envelope.tenant?.id !== request.tenantId) return reply.status(404).send()
  const name = String(request.name)

  let opened: Awaited<ReturnType<typeof openPackage>>
  try {
    opened = await openPackage(dir)
  } catch (error) {
    return refusePackage(reply, error)
  }
  const { profile } = opened.manifest
  if (profile === 'operator' && !request.operator) return reply.status(404).send()

  const downloaded = { action: 'tenant.downloaded', tenantId: request.tenantId } as const
  const detail = { package: name, manifestSha256: opened.sha256, profile }
  let intent: string
  try {
    intent = await intend(req, { ...downloaded, detail })
  } catch (error) {
    if (log.e) log.error(`Download of ${name} refused: its intent was not written (${(error as Error)?.message})`)
    return reply
      .status(503)
      .send(httpError(503, 'The download could not be recorded, and nothing leaves without it', 'GOVERNANCE_LOG_NOT_AVAILABLE'))
  }

  let bytes = 0
  let settled = false
  const close = (outcome: 'success' | 'failure') => {
    if (settled) return
    settled = true
    void settle(req, intent, outcome, { ...downloaded, detail: { ...detail, bytes } })
  }
  // `close` follows `finish` on a whole response, and comes alone on one cut short.
  reply.raw.once('finish', () => close('success'))
  reply.raw.once('close', () => close('failure'))

  const counted = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      bytes += chunk.length
      done(null, chunk)
    }
  })
  const tar = tarPackage(dir, name, (relative) => profile === 'operator' || relative !== ENVELOPE)
  pipeline(tar, counted, () => {})

  const file = profile === 'operator' ? `${name}.operator.tar` : `${name}.tar`
  return reply.type('application/x-tar').header('content-disposition', `attachment; filename="${file}"`).send(counted)
}

/**
 * The cleanup: removes every slot's package created more than `days` ago, each under its slot's
 * lock, so it never removes what an export is replacing. A slot whose export is running is left
 * for the next run. Each removal writes its intent first and its outcome after.
 */
export async function expirePackages(
  deps: { governance: GovernanceLogManagement | undefined; ctx: ControlHandle; provider: ContainerProvider | undefined },
  days: number,
  signal?: AbortSignal
): Promise<{ removed: number; kept: number }> {
  const writer: Unattended = { governance: deps.governance, ctx: deps.ctx }
  assertGovernanceLog(writer)
  if (!deps.provider?.withLock) throw new Error('This data layer holds no lock: the cleanup does not run without one')

  sweepPackages()
  const before = Date.now() - days * 86_400_000
  let removed = 0
  let kept = 0
  for (const name of packageNames()) {
    if (signal?.aborted) break
    const peeked = peekPackage(path.join(exportRoot(), name))
    const slot = peeked?.envelope.slot
    const tenantId = peeked?.envelope.tenant?.id
    const createdAt = Date.parse(String(peeked?.manifest.createdAt))
    if (!slot || !tenantId || !(createdAt < before)) continue

    const done = await deps.provider.withLock(slotLock(tenantId, slot), async () => {
      // Looked at again under the lock: an export may have replaced it in the meantime.
      if (!packageDir(name)) return true
      const expired = { action: 'tenant.export_expired', tenantId } as const
      const detail = { package: name, manifestSha256: peeked!.envelope.manifestSha256, slot, createdAt: peeked!.manifest.createdAt }
      const intent = await intend(writer, { ...expired, detail })
      const gone = removePackage(name)
      await settle(writer, intent, gone ? 'success' : 'failure', { ...expired, detail })
      return gone
    })
    if (done) removed++
    else kept++
  }
  if (log.i && (removed || kept)) log.info(`Export cleanup: ${removed} package(s) older than ${days} days removed, ${kept} left for the next run`)
  return { removed, kept }
}
