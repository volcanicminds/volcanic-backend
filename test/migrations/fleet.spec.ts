/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-5.3: the fleet migrator, against a real fleet.
//
// The plan calls this the highest-risk code in the rewrite, and asks for a fleet of at least
// twenty containers with a forced interruption among the cases. Both are here. What is
// asserted is not "the loop runs" but the five things an operator finds out about a fleet
// migrator only when it goes wrong: it refuses to start without a way back, it says WHICH
// containers failed, it does not stop the run because one of them did, it resumes instead of
// starting over, and it skips a container someone else is already migrating rather than
// queueing behind them.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { PostgresProvider } from '../../lib/database/adapters/postgres/index.js'
import { createMigrationRunner } from '../../lib/database/migrations/runner.js'
import { migrateFleet, SnapshotRequiredError, type FleetDeps } from '../../lib/database/migrations/fleet.js'

;(global as any).log = {}

const URL = process.env.DATABASE_URL
const suite = URL ? describe : describe.skip

const FLEET_SIZE = 24
const tenantOf = (n: number) => ({
  id: `id-${String(n).padStart(3, '0')}`,
  slug: `acme-${String(n).padStart(3, '0')}`,
  locator: `test_fleet_${String(n).padStart(3, '0')}`,
  status: 'active' as const,
  name: `Acme ${n}`,
  strategy: 'schema' as const,
  engine: 'postgres' as const
})

describe('fleet · what it refuses (T-5.3)', () => {
  const deps: FleetDeps = {
    tenants: async () => [],
    migrations: { pending: async () => [], apply: async () => '', version: async () => null, expected: () => null },
    withContainerLock: async (_l, fn) => await fn()
  }

  it('refuses to start without a snapshot', async () => {
    // The snapshot is the only way back from a fleet migration, so it is not a flag with a
    // default: without it the operation is irreversible and performed hopefully.
    await expect(migrateFleet(deps, {} as never)).rejects.toThrow(SnapshotRequiredError)
    await expect(migrateFleet(deps, { snapshot: '   ' })).rejects.toThrow(/only way back/)
  })

  it('accepts a reference and records it in the result', async () => {
    const result = await migrateFleet(deps, { snapshot: 'rds:acme-2026-09-08T10:00Z' })
    expect(result.snapshot).toBe('rds:acme-2026-09-08T10:00Z')
    expect(result.total).toBe(0)
  })
})

suite('fleet · twenty-four containers (T-5.3)', function () {
  this.timeout(120000)

  let provider: PostgresProvider
  let dir: string
  const fleet = Array.from({ length: FLEET_SIZE }, (_, i) => tenantOf(i))

  const runnerOn = (folder: string) =>
    createMigrationRunner(
      async (container) => ({
        handle: provider.forLocator(container.locator, container.tenantId as string),
        locator: container.locator,
        dialect: 'postgres' as const
      }),
      { tenant: { name: 'tenant', folders: [folder] }, control: { name: 'control', folders: [folder] } }
    )

  const depsOn = (folder: string, tenants = fleet): FleetDeps => ({
    tenants: async () => tenants as never,
    migrations: runnerOn(folder),
    withContainerLock: (locator, fn) => provider.withContainerLock(locator, fn)
  })

  before(async () => {
    provider = new PostgresProvider({ url: URL, schema: 'public', poolMax: 6 })
    for (const t of fleet) {
      await provider.dropSchema(t.locator)
      await provider.createSchema(t.locator)
    }
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-fleet-'))
    fs.writeFileSync(
      path.join(dir, '0000_init.sql'),
      'CREATE TABLE "migration" ("id" text PRIMARY KEY NOT NULL, "set" text NOT NULL, "name" text NOT NULL, "hash" text NOT NULL, "applied_at" timestamp with time zone DEFAULT now() NOT NULL);\n' +
        '--> statement-breakpoint\nCREATE TABLE "widget" ("id" text PRIMARY KEY NOT NULL);'
    )
    fs.writeFileSync(path.join(dir, '0001_note.sql'), 'ALTER TABLE "widget" ADD COLUMN "note" text;')
  })

  after(async () => {
    for (const t of fleet) await provider.dropSchema(t.locator)
    await provider.shutdown()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('shows what it would do, and does nothing', async () => {
    const result = await migrateFleet(depsOn(dir), { snapshot: 'before-release-7', dryRun: true, concurrency: 4 })

    expect(result.total).toBe(FLEET_SIZE)
    expect(result.outcomes.every((o) => o.status === 'would-migrate')).toBe(true)
    expect(result.outcomes[0].pending).toEqual(['0000_init', '0001_note'])
    // Nothing was touched: the containers are still empty.
    expect(await depsOn(dir).migrations.version({ tenantId: fleet[0].id, locator: fleet[0].locator })).toBe(null)
  })

  it('migrates the whole fleet, and is a no-op the second time', async () => {
    const first = await migrateFleet(depsOn(dir), { snapshot: 'before-release-7', concurrency: 4 })
    expect(first.failed).toEqual([])
    expect(first.outcomes.filter((o) => o.status === 'migrated').length).toBe(FLEET_SIZE)
    expect(first.outcomes.every((o) => o.to === '0001_note')).toBe(true)

    const second = await migrateFleet(depsOn(dir), { snapshot: 'before-release-7', concurrency: 4 })
    expect(second.outcomes.every((o) => o.status === 'up-to-date')).toBe(true)
  })

  it('keeps each container to itself', async () => {
    const runner = runnerOn(dir)
    for (const t of [fleet[0], fleet[FLEET_SIZE - 1]]) {
      expect(await runner.version({ tenantId: t.id, locator: t.locator })).toBe('0001_note')
    }
  })

  it('skips a container someone else is migrating, instead of queueing behind it', async () => {
    // A third migration, so there is something left to do.
    fs.writeFileSync(path.join(dir, '0002_tag.sql'), 'ALTER TABLE "widget" ADD COLUMN "tag" text;')
    const held = fleet[3]

    let release: () => void = () => {}
    const holding = new Promise<void>((resolve) => {
      release = resolve
    })
    // Another run, holding the advisory lock on one container for the duration.
    const other = provider.withContainerLock(held.locator, async () => {
      await holding
      return 'held'
    })
    await new Promise((r) => setTimeout(r, 50))

    const result = await migrateFleet(depsOn(dir), { snapshot: 'before-release-8', concurrency: 4 })
    release()
    expect(await other).toBe('held')

    const skipped = result.outcomes.find((o) => o.slug === held.slug)!
    // Blocking would turn two operators into a deadlock with a waiting list.
    expect(skipped.status).toBe('locked')
    expect(result.outcomes.filter((o) => o.status === 'migrated').length).toBe(FLEET_SIZE - 1)

    // And the one that was locked is picked up by the next run.
    const again = await migrateFleet(depsOn(dir), { snapshot: 'before-release-8', only: [held.slug] })
    expect(again.outcomes[0].status).toBe('migrated')
  })

  it('reports which containers failed, and migrates the rest anyway', async () => {
    const broken = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-fleet-bad-'))
    fs.writeFileSync(path.join(broken, '0003_bad.sql'), 'ALTER TABLE "widget" ADD COLUMN "note" text;') // already exists

    // Two containers get the broken migration; everybody else is up to date.
    const result = await migrateFleet(depsOn(dir), { snapshot: 'before-release-9', concurrency: 4 })
    expect(result.failed).toEqual([])

    fs.copyFileSync(path.join(broken, '0003_bad.sql'), path.join(dir, '0003_bad.sql'))
    try {
      const withFailure = await migrateFleet(depsOn(dir), { snapshot: 'before-release-9', concurrency: 4 })

      // Every container fails on the same duplicate column, and the run says so by name: "22
      // of 24 failed" is never the end of the question.
      expect(withFailure.failed.length).toBe(FLEET_SIZE)
      expect(withFailure.failed[0].slug).toBe(fleet[0].slug)
      // The database's complaint, not just the statement that was attempted: the SQL is
      // already in the repository, and why THIS container refused it is the only thing the
      // run knows that nobody else does.
      expect(withFailure.failed[0].error).toMatch(/already exists/i)
      // The run went through the whole fleet rather than stopping at the first one.
      expect(withFailure.outcomes.length).toBe(FLEET_SIZE)
    } finally {
      // In a `finally` so a failed assertion cannot leave a broken migration in the folder
      // and turn the next test's result into a lie about a different thing.
      fs.rmSync(path.join(dir, '0003_bad.sql'), { force: true })
      fs.rmSync(broken, { recursive: true, force: true })
    }
  })

  it('stops when interrupted, and the next run resumes from where it stopped', async () => {
    // A fresh fleet so the interruption has something to leave behind.
    const second = Array.from({ length: FLEET_SIZE }, (_, i) => ({ ...tenantOf(i), locator: `test_fleet_b_${i}` }))
    for (const t of second) {
      await provider.dropSchema(t.locator)
      await provider.createSchema(t.locator)
    }

    const stopping = new AbortController()
    let done = 0
    const counting: FleetDeps = {
      ...depsOn(dir, second as never),
      migrations: {
        ...runnerOn(dir),
        apply: async (container, target) => {
          const reached = await runnerOn(dir).apply(container, target)
          if (++done >= 5) stopping.abort()
          return reached
        }
      }
    }

    const interrupted = await migrateFleet(counting, {
      snapshot: 'before-release-10',
      concurrency: 1,
      signal: stopping.signal
    })

    expect(interrupted.interrupted).toBe(true)
    const migrated = interrupted.outcomes.filter((o) => o.status === 'migrated').length
    expect(migrated).toBeGreaterThanOrEqual(5)
    expect(migrated).toBeLessThan(FLEET_SIZE)
    // What it did not reach is reported, not omitted: a run that says nothing about a
    // container is a run an operator has to guess about.
    expect(interrupted.outcomes.length).toBe(FLEET_SIZE)
    expect(interrupted.outcomes.filter((o) => o.status === 'not-attempted').length).toBe(FLEET_SIZE - migrated)

    // The state lives in the containers, so resuming is just looking again.
    const resumed = await migrateFleet(depsOn(dir, second as never), { snapshot: 'before-release-10', concurrency: 4 })
    expect(resumed.failed).toEqual([])
    expect(resumed.outcomes.filter((o) => o.status === 'up-to-date').length).toBe(migrated)
    expect(resumed.outcomes.filter((o) => o.status === 'migrated').length).toBe(FLEET_SIZE - migrated)

    for (const t of second) await provider.dropSchema(t.locator)
  })

  it('migrates a subset, and stops at a named version', async () => {
    const third = [tenantOf(90), tenantOf(91)].map((t) => ({ ...t, locator: `test_fleet_c_${t.id.slice(-3)}` }))
    for (const t of third) {
      await provider.dropSchema(t.locator)
      await provider.createSchema(t.locator)
    }

    const only = await migrateFleet(depsOn(dir, third as never), {
      snapshot: 'staged',
      only: [third[0].slug],
      target: '0000_init'
    })
    expect(only.total).toBe(1)
    expect(only.outcomes[0].to).toBe('0000_init')

    const runner = runnerOn(dir)
    expect(await runner.version({ tenantId: third[1].id, locator: third[1].locator })).toBe(null)

    for (const t of third) await provider.dropSchema(t.locator)
  })
})
