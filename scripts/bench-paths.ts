/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The hot-path bench (T-14.4, F62).
//
// Every authenticated request reads the same few rows before its handler runs: the tenant from
// the registry, then the user or the integration token behind the credential, or the platform
// operator on the control plane. This bench times those reads through the managers, called the
// way lib/loader/tenant.ts and lib/hooks/onRequest.ts call them, so a change inside a manager
// shows up here and a change anywhere else does not.
//
// It exists so that a statement is prepared only where the same bench, run before and after
// the change, shows the gain: run it, change the code, run it again with --baseline.
//
//   npm run bench:paths                             # PGlite; Postgres too with BENCH_DATABASE_URL
//   npm run bench:paths -- --out before.json        # where the report goes (bench-paths.json)
//   npm run bench:paths -- --baseline before.json   # every median against an earlier report
//   npm run bench:paths -- --rounds 15 --ops 1000   # timed rounds per path, operations per round
//   npm run bench:paths -- --force                  # measure on a busy machine, as indicative
//
// Postgres is read from BENCH_DATABASE_URL and never from DATABASE_URL: the bench creates its
// own schemas there and drops them at the end, which is not something to do by accident to the
// database a `.env` points at. It refuses to start when one of those schemas already exists.
//
import fs from 'fs'
import path from 'path'
import bcrypt from 'bcrypt'
import { sql } from 'drizzle-orm'
import { PostgresProvider, openPglite } from '../lib/database/adapters/postgres/index.js'
import { createMigrationRunner } from '../lib/database/migrations/runner.js'
import { createUserManager } from '../lib/database/managers/user.js'
import { createTokenManager } from '../lib/database/managers/token.js'
import { createTenantManager } from '../lib/database/managers/tenant.js'
import { createSystemUserManager } from '../lib/database/managers/systemUser.js'
import { table, type RuntimeHandle } from '../lib/database/managers/runtime.js'
import { migrationSets } from '../db.js'
import { BENCH_LOCK, machineIsFit, provenance } from './machine.js'

// ── what a run is allowed to do ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (flag: string) => argv.includes(flag)
const text = (flag: string) => {
  const at = argv.indexOf(flag)
  return at >= 0 ? argv[at + 1] : undefined
}
const count = (flag: string, fallback: number) => {
  const n = Number(text(flag))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const FORCE = has('--force')
const ROUNDS = count('--rounds', 15)
const OPS = count('--ops', 1000)
// A login is one bcrypt verification, about a quarter of a second at the floor cost: a thousand
// of them per round would measure the patience of whoever runs this.
const LOGIN_OPS = 10
const OUT = path.resolve(process.cwd(), text('--out') ?? 'bench-paths.json')
const BASELINE = text('--baseline')
const POSTGRES_URL = process.env.BENCH_DATABASE_URL

// The shape of the data: enough rows that every lookup goes through an index, on more than one
// container, so a per-container cache is exercised the way a fleet exercises it.
const TENANTS = 3
const FILLER_TENANTS = 197
const USERS_PER_TENANT = 2000
const TOKENS_PER_TENANT = 200
const SYSTEM_USERS = 200
const PASSWORD = 'Bench-pw-123456'
const SEED = 1
const POSTGRES_SCHEMAS = ['bench_control', ...Array.from({ length: TENANTS }, (_, i) => `bench_t${i + 1}`)]

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'bench-secret-not-for-production-32x'

const say = (line = '') => process.stdout.write(line + '\n')

// ── the world the requests run in ─────────────────────────────────────────────────────────
interface BenchTenant {
  id: string
  slug: string
  handle: any
  users: string[]
  emails: string[]
  tokens: string[]
}

interface World {
  provider: PostgresProvider
  tenantManager: ReturnType<typeof createTenantManager>
  control: any
  tenants: BenchTenant[]
  systemUsers: string[]
  close(): Promise<void>
}

/** Inserts in batches and answers the external ids, in insertion order. */
async function insertAll(handle: RuntimeHandle, name: string, rows: Record<string, unknown>[]): Promise<string[]> {
  const t = table(handle, name) as any
  const ids: string[] = []
  for (let i = 0; i < rows.length; i += 500) {
    const inserted = await handle.db
      .insert(t)
      .values(rows.slice(i, i + 500))
      .returning({ externalId: t.externalId })
    ids.push(...inserted.map((r: { externalId: string }) => r.externalId))
  }
  return ids
}

async function populate(provider: PostgresProvider, locators: string[], close: () => Promise<void>): Promise<World> {
  const hash = await bcrypt.hash(PASSWORD, 12)
  const control = provider.control() as unknown as RuntimeHandle
  const runner = createMigrationRunner(
    async (container) => ({
      handle: (container.tenantId ? await provider.forLocator(container.locator, container.tenantId) : control) as never,
      locator: container.locator
    }),
    migrationSets()
  )
  await runner.apply({ locator: locators[0] })

  const registry = table(control, 'tenant') as any
  const registered = await control.db
    .insert(registry)
    .values([
      ...locators.slice(1).map((locator, i) => ({
        name: `Bench ${i + 1}`,
        slug: `bench-t${i + 1}`,
        strategy: 'schema',
        engine: provider.engine,
        locator
      })),
      ...Array.from({ length: FILLER_TENANTS }, (_, i) => ({
        name: `Filler ${i + 1}`,
        slug: `filler-${i + 1}`,
        strategy: 'schema',
        engine: provider.engine,
        locator: `filler_${i + 1}`
      }))
    ])
    .returning({ id: registry.id, slug: registry.slug, locator: registry.locator })

  const systemUsers = await insertAll(
    control,
    'systemUser',
    Array.from({ length: SYSTEM_USERS }, (_, i) => ({ email: `op${i + 1}@bench.test`, password: hash }))
  )

  const tenants: BenchTenant[] = []
  for (const row of registered.slice(0, TENANTS)) {
    await runner.apply({ locator: row.locator, tenantId: row.id })
    const handle = (await provider.tenant(row.id)) as unknown as RuntimeHandle
    const emails = Array.from({ length: USERS_PER_TENANT }, (_, i) => `u${i + 1}@${row.slug}.bench.test`)
    const users = await insertAll(
      handle,
      'user',
      emails.map((email) => ({ email, password: hash }))
    )
    const tokens = await insertAll(
      handle,
      'token',
      Array.from({ length: TOKENS_PER_TENANT }, (_, i) => ({ name: `token-${i + 1}` }))
    )
    tenants.push({ id: row.id, slug: row.slug, handle, users, emails, tokens })
  }

  const tenantManager = createTenantManager({ openContainer: (id) => provider.tenant(id) as never })
  return { provider, tenantManager, control, tenants, systemUsers, close }
}

async function pgliteWorld(): Promise<World> {
  const provider = new PostgresProvider({ schema: 'public', pglite: await openPglite() })
  const locators = ['public', ...POSTGRES_SCHEMAS.slice(1)]
  for (const locator of locators.slice(1)) await provider.createSchema(locator)
  return populate(provider, locators, () => provider.shutdown())
}

async function postgresWorld(url: string, poolMax: number): Promise<World> {
  const admin = new PostgresProvider({ url, schema: 'public', poolMax: 1 })
  const { rows } = await admin.control().execute(
    sql`select schema_name as name from information_schema.schemata where schema_name in (${sql.join(
      POSTGRES_SCHEMAS.map((s) => sql`${s}`),
      sql`, `
    )})`
  )
  if (rows.length) {
    await admin.shutdown()
    const found = rows.map((r: any) => r.name).join(', ')
    throw new Error(`Schemas ${found} already exist on BENCH_DATABASE_URL: drop them, or point the bench elsewhere`)
  }
  for (const schema of POSTGRES_SCHEMAS) await admin.createSchema(schema)

  const provider = new PostgresProvider({ url, schema: POSTGRES_SCHEMAS[0], poolMax })
  const close = async () => {
    await provider.shutdown()
    for (const schema of POSTGRES_SCHEMAS) await admin.dropSchema(schema)
    await admin.shutdown()
  }
  try {
    return await populate(provider, POSTGRES_SCHEMAS, close)
  } catch (error) {
    await close()
    throw error
  }
}

// ── the paths ─────────────────────────────────────────────────────────────────────────────
const users = createUserManager()
const tokens = createTokenManager()
const systemUsers = createSystemUserManager()

/** Deterministic, so two runs ask for the same rows in the same order. */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface BenchPath {
  name: string
  ops: number
  run(world: World, pick: <T>(list: T[]) => T): Promise<unknown>
}

const PATHS: BenchPath[] = [
  {
    // What a request with a token pays to enter its container: the registry row the token
    // names (lib/loader/tenant.ts), then the handle (`provider.tenant`), which reads it again.
    name: 'tenant.byId',
    ops: OPS,
    run: async (world, pick) => {
      const t = pick(world.tenants)
      const tenant = await world.tenantManager.getTenant(world.control, t.id)
      return tenant && (await world.provider.tenant(t.id))
    }
  },
  {
    // A request without a token: a login, a public route. The slug comes from the header.
    name: 'tenant.bySlug',
    ops: OPS,
    run: (world, pick) => world.tenantManager.getTenantBySlug(world.control, pick(world.tenants).slug)
  },
  {
    name: 'user.byExternalId',
    ops: OPS,
    run: (world, pick) => {
      const t = pick(world.tenants)
      return users.retrieveUserByExternalId(t.handle, pick(t.users))
    }
  },
  {
    name: 'token.byExternalId',
    ops: OPS,
    run: (world, pick) => {
      const t = pick(world.tenants)
      return tokens.retrieveTokenByExternalId(t.handle, pick(t.tokens))
    }
  },
  {
    name: 'systemUser.byExternalId',
    ops: OPS,
    run: (world, pick) => systemUsers.retrieveSystemUserByExternalId(world.control, pick(world.systemUsers))
  },
  {
    // The lookup and the bcrypt verification together, because that is what a login costs:
    // this row says how much of it a statement could ever change.
    name: 'login.password',
    ops: LOGIN_OPS,
    run: (world, pick) => {
      const t = pick(world.tenants)
      return users.retrieveUserByPassword(t.handle, pick(t.emails), PASSWORD)
    }
  }
]

// ── measuring ─────────────────────────────────────────────────────────────────────────────
interface PathResult {
  medianUs: number
  p25Us: number
  p75Us: number
  /** p25 to p75 as a share of the median: the dispersion a comparison has to beat. */
  iqrPct: number
  minUs: number
  maxUs: number
  rounds: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Microseconds per operation over one round, with `concurrency` operations in flight. */
async function timeRound(world: World, p: BenchPath, concurrency: number, pick: <T>(list: T[]) => T): Promise<number> {
  let started = 0
  const begin = process.hrtime.bigint()
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (started++ < p.ops) await p.run(world, pick)
    })
  )
  return Number(process.hrtime.bigint() - begin) / 1e3 / p.ops
}

function summarise(samples: number[]): PathResult {
  const s = [...samples].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
  const median = at(0.5)
  return {
    medianUs: round2(median),
    p25Us: round2(at(0.25)),
    p75Us: round2(at(0.75)),
    iqrPct: round2(median > 0 ? ((at(0.75) - at(0.25)) / median) * 100 : 0),
    minUs: round2(s[0]),
    maxUs: round2(s[s.length - 1]),
    rounds: s.length
  }
}

/**
 * Every path once per round, starting from a different one each time, so a drift of the
 * machine during the run lands on all of them instead of on whichever ran last.
 */
async function measureWorld(world: World, concurrency: number): Promise<Record<string, PathResult>> {
  const next = random(SEED)
  const pick = <T>(list: T[]) => list[Math.floor(next() * list.length)]

  // A bench that times misses measures nothing: every path must find its row.
  for (const p of PATHS) {
    if (!(await p.run(world, pick))) throw new Error(`${p.name} found nothing: the bench data is wrong`)
  }
  // Untimed: JIT, the driver's caches, and the server's own (a named statement turns generic
  // after its fifth execution).
  for (const p of PATHS) await timeRound(world, p, concurrency, pick)

  const samples: Record<string, number[]> = Object.fromEntries(PATHS.map((p) => [p.name, []]))
  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 0; i < PATHS.length; i++) {
      const p = PATHS[(i + r) % PATHS.length]
      samples[p.name].push(await timeRound(world, p, concurrency, pick))
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([name, s]) => [name, summarise(s)]))
}

// ── the run ───────────────────────────────────────────────────────────────────────────────
type Report = { provenance: ReturnType<typeof provenance>; settings: object; results: Record<string, Record<string, PathResult>> }

function print(results: Report['results'], baseline?: Report) {
  for (const [config, paths] of Object.entries(results)) {
    say('')
    say(`  ${config}`)
    say(`    ${'path'.padEnd(26)}${'µs/op'.padStart(12)}${'IQR'.padStart(9)}${baseline ? 'vs baseline'.padStart(14) : ''}`)
    for (const [name, r] of Object.entries(paths)) {
      const before = baseline?.results?.[config]?.[name]
      const ratio = before ? `${(r.medianUs / before.medianUs).toFixed(3)} (±${before.iqrPct.toFixed(1)}%)` : ''
      say(`    ${name.padEnd(26)}${r.medianUs.toFixed(1).padStart(12)}${`${r.iqrPct.toFixed(1)}%`.padStart(9)}  ${ratio}`)
    }
  }
}

async function main() {
  const unfit = machineIsFit()
  if (unfit && !FORCE) {
    say(`\n  Refusing to measure: ${unfit}\n  Pass --force to measure anyway, and treat the numbers as indicative.\n`)
    process.exit(1)
  }
  if (unfit) say(`  (forced on an unfit machine: ${unfit})`)
  const baseline: Report | undefined = BASELINE ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : undefined

  fs.writeFileSync(BENCH_LOCK, String(process.pid))
  try {
    const configs: Array<{ name: string; concurrency: number; open: () => Promise<World> }> = [
      { name: 'pglite, concurrency 1', concurrency: 1, open: pgliteWorld }
    ]
    if (POSTGRES_URL) {
      configs.push(
        // Latency: one request at a time. Throughput: as many in flight as the pool holds.
        { name: 'postgres, concurrency 1', concurrency: 1, open: () => postgresWorld(POSTGRES_URL, 10) },
        { name: 'postgres, concurrency 10', concurrency: 10, open: () => postgresWorld(POSTGRES_URL, 10) }
      )
    } else {
      say('  BENCH_DATABASE_URL is not set: Postgres is skipped, PGlite only.')
    }

    const results: Report['results'] = {}
    for (const config of configs) {
      process.stdout.write(`  ${config.name} … `)
      const world = await config.open()
      try {
        results[config.name] = await measureWorld(world, config.concurrency)
      } finally {
        await world.close()
      }
      say('done')
    }

    const report: Report = {
      provenance: provenance(),
      settings: { rounds: ROUNDS, ops: OPS, loginOps: LOGIN_OPS, tenants: TENANTS, usersPerTenant: USERS_PER_TENANT },
      results
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
    print(results, baseline)
    say('')
    say(`  Wrote ${path.relative(process.cwd(), OUT)}. Median of ${ROUNDS} rounds; IQR is p25 to p75 over the median.`)
    if (baseline) say('  The ratio is this median over the baseline one; the ± is the baseline dispersion.')
    say('')
  } finally {
    fs.rmSync(BENCH_LOCK, { force: true })
  }
}

main().catch((error) => {
  fs.rmSync(BENCH_LOCK, { force: true })
  console.error(error)
  process.exit(1)
})
