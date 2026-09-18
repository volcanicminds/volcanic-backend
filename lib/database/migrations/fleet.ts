import type { Tenant } from '../../../types/global.js'
import type { ContainerRef, MigrationRunner } from '../ports.js'

//
// The fleet migrator (T-5.3).
//
// This is the highest-risk code in the rewrite, and the plan says so: a defect in the router
// breaks a route, a defect here breaks the databases of different customers at once. Every
// property below is therefore a refusal rather than a convenience.
//
//   - **the snapshot is mandatory**. Without a reference to restore from, a fleet migration
//     is an irreversible operation performed hopefully. The run refuses to start, and the
//     reference is written into the run log so the answer to "restore to what" is recorded
//     next to what was done;
//   - **nothing is shared between containers**. One container's failure is its own: the run
//     continues, and the failures are listed by name at the end. A total is not an answer,
//     because the next question is always "which ones";
//   - **the state lives in the containers**. There is no run table to keep consistent,
//     because each container records what it applied (T-5.1), so an interrupted run resumes
//     by simply looking again: a container that finished has nothing pending;
//   - **a container being migrated elsewhere is skipped, not queued**. Blocking would turn
//     two operators into a deadlock with a waiting list;
//   - **concurrency is low by default**. A hundred parallel migrations saturate the database
//     they are migrating.
//
export interface FleetOptions {
  /** Where to restore from if this goes wrong. Required, and recorded in the run log. */
  snapshot?: string
  /** Report what would happen and touch nothing. The documentation recommends running it first. */
  dryRun?: boolean
  /** Containers worked at a time. Deliberately low. */
  concurrency?: number
  /** Only these tenants, by slug or id: for retrying failures, or for a staged rollout. */
  only?: string[]
  /** Stop each container at this migration name, instead of the newest. */
  target?: string
  /** Aborted: the run stops between containers and reports the rest as not attempted. */
  signal?: AbortSignal
}

export type OutcomeStatus = 'migrated' | 'up-to-date' | 'failed' | 'locked' | 'not-attempted' | 'would-migrate'

export interface ContainerOutcome {
  readonly tenantId: string
  readonly slug: string
  readonly locator: string
  readonly status: OutcomeStatus
  readonly from: string | null
  readonly to: string | null
  readonly pending: string[]
  readonly error?: string
}

export interface FleetResult {
  readonly snapshot: string
  readonly dryRun: boolean
  readonly startedAt: string
  readonly finishedAt: string
  readonly total: number
  readonly outcomes: ContainerOutcome[]
  readonly failed: ContainerOutcome[]
  readonly interrupted: boolean
}

export interface FleetDeps {
  /** The registry, already filtered to what may be migrated. */
  tenants(): Promise<Tenant[]>
  migrations: MigrationRunner
  /** Returns null when another run holds the container. */
  withContainerLock<T>(locator: string, fn: () => Promise<T>): Promise<T | null>
}

export class SnapshotRequiredError extends Error {
  readonly code = 'SNAPSHOT_REQUIRED'
  constructor() {
    super(
      'A fleet migration needs --snapshot <reference>: it is the only way back, so it is not optional. ' +
        'Pass the backup, dump or point-in-time reference you would restore from.'
    )
    this.name = 'SnapshotRequiredError'
  }
}

const DEFAULT_CONCURRENCY = 2
const MAX_CONCURRENCY = 16

export async function migrateFleet(deps: FleetDeps, options: FleetOptions): Promise<FleetResult> {
  const snapshot = String(options.snapshot ?? '').trim()
  if (!snapshot) throw new SnapshotRequiredError()

  const dryRun = options.dryRun === true
  const width = Math.min(Math.max(1, Math.trunc(Number(options.concurrency) || DEFAULT_CONCURRENCY)), MAX_CONCURRENCY)
  const startedAt = new Date().toISOString()

  const wanted = new Set((options.only ?? []).map((s) => String(s).trim()).filter(Boolean))
  const fleet = (await deps.tenants())
    .filter((t) => wanted.size === 0 || wanted.has(t.slug) || wanted.has(t.id))
    // Sorted by slug so two runs walk the fleet in the same order: a staged rollout that
    // reorders itself between attempts is not staged.
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))

  if (globalThis.log?.i) {
    globalThis.log.info(
      `Fleet migration ${dryRun ? '(dry run) ' : ''}starting: ${fleet.length} container(s), ` +
        `concurrency ${width}, snapshot '${snapshot}'`
    )
  }

  const outcomes: ContainerOutcome[] = []
  let next = 0
  let interrupted = false

  const worker = async () => {
    for (;;) {
      if (options.signal?.aborted) {
        interrupted = true
        return
      }
      const index = next++
      if (index >= fleet.length) return
      outcomes.push(await one(deps, fleet[index], options, dryRun))
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, fleet.length) }, worker))

  // Whatever the interruption left untouched is reported, not omitted: a run that says
  // nothing about a container is a run an operator has to guess about.
  for (const tenant of fleet.slice(Math.min(next, fleet.length))) {
    outcomes.push(notAttempted(tenant))
  }
  if (interrupted) {
    for (const tenant of fleet) {
      if (!outcomes.some((o) => o.tenantId === tenant.id)) outcomes.push(notAttempted(tenant))
    }
  }

  outcomes.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
  const failed = outcomes.filter((o) => o.status === 'failed')

  const result: FleetResult = {
    snapshot,
    dryRun,
    startedAt,
    finishedAt: new Date().toISOString(),
    total: fleet.length,
    outcomes,
    failed,
    interrupted
  }

  if (globalThis.log?.i) {
    const done = outcomes.filter((o) => o.status === 'migrated').length
    globalThis.log.info(
      `Fleet migration finished: ${done} migrated, ${outcomes.filter((o) => o.status === 'up-to-date').length} already current, ` +
        `${failed.length} failed, ${outcomes.filter((o) => o.status === 'locked').length} locked, ` +
        `${outcomes.filter((o) => o.status === 'not-attempted').length} not attempted. Snapshot '${snapshot}'`
    )
  }
  for (const failure of failed) {
    if (globalThis.log?.e) globalThis.log.error(`Fleet migration failed on ${failure.slug} (${failure.locator}): ${failure.error}`)
  }

  return result
}

const notAttempted = (tenant: Tenant): ContainerOutcome => ({
  tenantId: tenant.id,
  slug: tenant.slug,
  locator: tenant.locator,
  status: 'not-attempted',
  from: null,
  to: null,
  pending: []
})

async function one(deps: FleetDeps, tenant: Tenant, options: FleetOptions, dryRun: boolean): Promise<ContainerOutcome> {
  const container: ContainerRef = { tenantId: tenant.id, locator: tenant.locator }
  const base = { tenantId: tenant.id, slug: tenant.slug, locator: tenant.locator }

  try {
    const from = await deps.migrations.version(container)
    const pending = (await deps.migrations.pending(container)).map((m) => m.name)
    const planned = options.target ? pending.filter((name) => name <= options.target!) : pending

    if (planned.length === 0) {
      return { ...base, status: 'up-to-date', from, to: from, pending: [] }
    }
    if (dryRun) {
      return { ...base, status: 'would-migrate', from, to: planned[planned.length - 1], pending: planned }
    }

    // The lock is taken around the work and not around the whole run: a fleet migration that
    // locked everything at once would make a staged rollout impossible.
    const reached = await deps.withContainerLock(tenant.locator, () => deps.migrations.apply(container, options.target))

    if (reached === null) {
      if (globalThis.log?.w) globalThis.log.warn(`Fleet migration: ${tenant.slug} is being migrated elsewhere, skipping`)
      return { ...base, status: 'locked', from, to: from, pending: planned }
    }

    if (globalThis.log?.i) globalThis.log.info(`Fleet migration: ${tenant.slug} ${from ?? 'empty'} to ${reached}`)
    return { ...base, status: 'migrated', from, to: reached, pending: [] }
  } catch (error) {
    return { ...base, status: 'failed', from: null, to: null, pending: [], error: describeError(error) }
  }
}

/**
 * The whole cause chain, in one line.
 *
 * The ORM wraps a driver error into "Failed query: <sql>", which tells an operator what was
 * attempted and not what the database said about it. On a fleet migrator that is the wrong
 * half: the statement is already in the repository, and the only thing this run knows that
 * nobody else does is why THIS container refused it.
 */
export function describeError(error: unknown): string {
  const parts: string[] = []
  for (let current: unknown = error; current; current = (current as { cause?: unknown }).cause) {
    const raw = (current as { message?: unknown }).message
    const message = raw ? String(raw).split('\n')[0].trim() : ''
    if (message && !parts.includes(message)) parts.push(message)
  }
  return parts.join(': ') || String(error)
}
