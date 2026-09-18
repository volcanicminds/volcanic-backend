/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The tuning bench (T-9.4).
//
// Appendix A of EVO_FRAMEWORK.md carries the numbers that size the work factor, the pools, the
// LRU bound and the page ceiling — and the line under them says not to use them, because they
// came from a shared laptop. A number the document itself calls unreliable is not a
// measurement, it is a placeholder, and every default derived from it is a guess wearing a
// figure.
//
// So: measure on the machine that will run it, and write the answers down WITH their
// provenance. A number without provenance is indistinguishable from a number somebody invented,
// which is how appendix A ended up where it is.
//
//   npx tsx scripts/tune.ts                 # measure, write tuning.json, print what it would change
//   npx tsx scripts/tune.ts --write-config  # also apply it to .env, after a backup and a diff
//   npx tsx scripts/tune.ts --target-ms 250 # the password-hashing budget to aim at
//   npx tsx scripts/tune.ts --force         # measure anyway on a machine that is not fit for it
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import v8 from 'v8'
import vm from 'vm'

// ── what a run is allowed to do ───────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const has = (flag: string) => argv.includes(flag)
const value = (flag: string, fallback: number) => {
  const at = argv.indexOf(flag)
  const n = at >= 0 ? Number(argv[at + 1]) : NaN
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const WRITE_CONFIG = has('--write-config')
const FORCE = has('--force')
const TARGET_MS = value('--target-ms', 250)
// The heap a response cache is allowed to hold. 32 MB is not a law of nature: it is about 6% of
// a 512 MB container, which is the smallest shape this framework is expected to run in, and the
// point of naming it is that `maxEntries` bounds a COUNT while memory is spent in BYTES.
const CACHE_BUDGET_MB = value('--cache-budget-mb', 32)
const OUT = path.resolve(process.cwd(), 'tuning.json')
const ENV_FILE = path.resolve(process.cwd(), '.env')
const LOCK = path.join(os.tmpdir(), 'volcanic-tune.lock')

const say = (line = '') => process.stdout.write(line + '\n')

// ── refusing to measure a machine that cannot be measured ─────────────────────────────────
//
// Better no number than a number taken while something else was running: a plausible wrong
// figure is worse than a missing one, because it gets used.
//
function machineIsFit(): string | null {
  const cores = os.cpus()?.length || 1
  const [load1] = os.loadavg()
  // loadavg is 0 on Windows, so "no signal" is not "idle".
  if (load1 > 0 && load1 / cores > 0.4) {
    return `the machine is busy (load ${load1.toFixed(2)} over ${cores} cores). Measuring now would report the contention, not the cost.`
  }
  if (fs.existsSync(LOCK)) {
    return `another tune is running (${LOCK}). Two benches on one machine measure each other.`
  }
  return null
}

// ── measuring ─────────────────────────────────────────────────────────────────────────────
interface Sample {
  medianMs: number
  spreadPct: number
  runs: number
}

/**
 * Median rather than mean, and the spread reported next to it.
 *
 * A mean is moved by one slow run, and one slow run is exactly what a laptop produces. The
 * spread is not decoration: a median of 200 ms with a 5% spread and a median of 200 ms with a
 * 90% spread are not the same measurement, and only one of them is worth deriving a default
 * from.
 */
async function measure(fn: () => Promise<unknown> | unknown, runs = 7): Promise<Sample> {
  const times: number[] = []
  // One untimed pass: the first call pays for lazy initialisation that no later call pays.
  await fn()
  for (let i = 0; i < runs; i++) {
    const started = process.hrtime.bigint()
    await fn()
    times.push(Number(process.hrtime.bigint() - started) / 1e6)
  }
  times.sort((a, b) => a - b)
  const median = times[Math.floor(times.length / 2)]
  const spread = median > 0 ? ((times[times.length - 1] - times[0]) / median) * 100 : 0
  return { medianMs: round(median), spreadPct: round(spread), runs }
}

const round = (n: number) => Math.round(n * 100) / 100

/**
 * A forced collection, so that a heap delta measures what is still reachable rather than what
 * has not been collected yet. `--expose-gc` is not on the command line the npm script runs, so
 * the flag is turned on for the length of the call and turned off after it.
 *
 * Without this a "memory" measurement is a measurement of when the collector felt like running,
 * which is the kind of plausible wrong number this whole file exists to avoid.
 */
function forceGc(): boolean {
  const g = globalThis as any
  if (typeof g.gc === 'function') {
    g.gc()
    g.gc()
    return true
  }
  try {
    v8.setFlagsFromString('--expose_gc')
    const gc = vm.runInNewContext('gc')
    gc()
    gc()
    v8.setFlagsFromString('--no-expose_gc')
    return true
  } catch {
    return false
  }
}

/** Bytes still reachable after `fill`. Meaningless without the collection around it. */
function heapDelta(fill: () => void): number {
  forceGc()
  const before = process.memoryUsage().heapUsed
  fill()
  forceGc()
  return process.memoryUsage().heapUsed - before
}

/** The cost of one operation that is far too fast to time a single call of. */
async function perOp(fn: () => void, ops: number, runs = 7): Promise<Sample & { usPerOp: number }> {
  const sample = await measure(() => {
    for (let i = 0; i < ops; i++) fn()
  }, runs)
  return { ...sample, usPerOp: round((sample.medianMs / ops) * 1000) }
}

/** The work factor whose cost is closest to the budget, without going under it. */
async function tuneBcrypt(): Promise<any> {
  const bcrypt = await import('bcrypt').catch(() => null)
  if (!bcrypt) return { skipped: 'bcrypt is not installed' }

  const costs: Record<number, Sample> = {}
  let recommended = 12
  // Never below 12: the bench measures to spend the budget well, not to find permission to
  // spend less. `envInt('BCRYPT_COST', 12, { min: 12 })` enforces the same floor at runtime.
  for (let cost = 12; cost <= 16; cost++) {
    const sample = await measure(() => (bcrypt as any).default.hash('a-representative-password', cost), 5)
    costs[cost] = sample
    if (sample.medianMs <= TARGET_MS) recommended = cost
    if (sample.medianMs > TARGET_MS * 2) break // no point pricing what is already far too slow
  }
  return { targetMs: TARGET_MS, costs, recommended }
}

/** What one MFA decryption costs, which is one derivation on the login path. */
async function tuneKeyDerivation(): Promise<any> {
  const scrypt = (password: crypto.BinaryLike, salt: crypto.BinaryLike, keylen: number, options: any) =>
    new Promise((resolve, reject) =>
      crypto.scrypt(password, salt, keylen, options, (err, key) => (err ? reject(err) : resolve(key)))
    )

  const N = 32768
  const sample = await measure(
    () => scrypt('a-secret-of-the-right-length-32ch', crypto.randomBytes(16), 32, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }),
    5
  )
  return {
    N,
    sample,
    // The number that matters is not the cost, it is whether it blocks: v4 used the SYNC call
    // and 82 ms of it sat on the event loop at every MFA login.
    note: 'asynchronous since v5: this cost is paid off the event loop, not on it'
  }
}

/** What the database will actually allow, against what the configuration plans to take. */
async function tuneConnections(): Promise<any> {
  const url = process.env.DATABASE_URL
  if (!url) return { skipped: 'no DATABASE_URL: the connection budget can only be measured against a real server' }

  const pg = await import('pg').catch(() => null)
  if (!pg) return { skipped: 'pg is not installed' }

  const client = new (pg as any).default.Client({ connectionString: url })
  try {
    await client.connect()
    const { rows } = await client.query(
      "select current_setting('max_connections')::int as max, current_setting('superuser_reserved_connections')::int as reserved"
    )
    const { rows: used } = await client.query('select count(*)::int as n from pg_stat_activity')
    const max = rows[0].max as number
    const reserved = rows[0].reserved as number

    // The framework refuses to boot when the arithmetic does not leave room for anything else
    // to reach the server — the operator's psql included. This reports the same sum before a
    // deployment discovers it at boot.
    const usable = max - reserved
    const controlPool = Number(process.env.DB_POOL_MAX) || 10
    const budget = Math.max(1, Math.floor((usable - controlPool) * 0.6))
    return {
      maxConnections: max,
      superuserReserved: reserved,
      inUseNow: used[0].n,
      controlPoolMax: controlPool,
      // 60% of what is left, because the other 40% is every other thing that talks to this
      // server: a second instance, a migration run, a backup, a person with a terminal.
      recommendedContainerBudget: budget,
      note: 'a framework that plans to use every connection plans to be the reason nobody can log in to fix it'
    }
  } catch (error: any) {
    return { skipped: `could not reach the database: ${error?.message}` }
  } finally {
    await client.end().catch(() => {})
  }
}

/** What a page costs as it grows, which is what the ceiling on `_pageSize` is for. */
async function tunePageSize(): Promise<any> {
  const Database = await import('better-sqlite3').catch(() => null)
  if (!Database) return { skipped: 'better-sqlite3 is not installed' }

  const db = new (Database as any).default(':memory:')
  db.exec('create table probe (id integer primary key, a text, b text, c text)')
  const insert = db.prepare('insert into probe (a, b, c) values (?, ?, ?)')
  const many = db.transaction((n: number) => {
    for (let i = 0; i < n; i++) insert.run(`a-${i}`, `b-${i}`, 'c'.repeat(64))
  })
  many(20_000)

  const pages: Record<number, Sample> = {}
  for (const size of [25, 100, 500, 1000]) {
    const statement = db.prepare('select * from probe limit ? offset ?')
    pages[size] = await measure(() => statement.all(size, 5_000), 9)
  }
  db.close()

  // The clamp is about the cost a single caller can ask the server to pay, so the number worth
  // reporting is where it stops being linear.
  return { pages, current: Number(process.env.VOLCANIC_MAX_PAGE_SIZE) || 100 }
}

/**
 * What one cached response costs, which is the number `maxEntries` is actually spending.
 *
 * The cap counts entries; memory is spent in bytes, and the two are the same number only when
 * every response is the same size, which is never true. So the bench measures the byte cost of
 * a realistic page and reports the cap that fits the declared budget, instead of leaving a
 * round number to stand in for an amount of memory nobody has ever looked at.
 *
 * It measures the shipped store (`lib/util/cache.ts`) rather than a copy of it: a bench that
 * reimplements what it measures reports on the reimplementation.
 */
async function tuneCache(): Promise<any> {
  const g = globalThis as any
  // The module logs through the `log` global and reads the deployment shape from `config`.
  g.log = g.log ?? {}
  g.config = g.config ?? { options: {} }

  const mod = await import('../lib/util/cache.js').catch(() => null)
  if (!mod) return { skipped: 'lib/util/cache.ts could not be imported' }
  const { configureCache, cacheSet, cacheGet, invalidateCache, defaultTtlFor } = mod as any

  // The shape an API actually returns, so the byte count is a page instead of a guess.
  const row = (i: number) => ({
    id: `1f2e3d4c-0000-4000-8000-${String(i).padStart(12, '0')}`,
    name: `Record number ${i}`,
    email: `user${i}@example.com`,
    createdAt: new Date(1758000000000 + i * 1000).toISOString(),
    amount: i * 3.5,
    active: i % 2 === 0
  })
  const page = (rows: number) => JSON.stringify(Array.from({ length: rows }, (_, index) => row(index)))
  const entryFor = (rows: number) => ({
    payload: page(rows),
    headers: { 'content-type': 'application/json; charset=utf-8' },
    statusCode: 200
  })
  const keyAt = (i: number) => `orders::tenant:id-acme::u-${i}|admin::GET /orders?_page=${i}`

  // What the shipped defaults are, read from the module rather than restated here.
  const shipped = configureCache({ enabled: true })

  // Byte cost per entry, at two page shapes: a normal page and the page-size clamp.
  const FILL = 2000
  const perEntry: Record<string, any> = {}
  for (const rows of [25, 100]) {
    configureCache({ enabled: true, ttl: 3600, maxEntries: FILL * 2 })
    const bytes = heapDelta(() => {
      for (let i = 0; i < FILL; i++) cacheSet(keyAt(i), entryFor(rows))
    })
    perEntry[`rows${rows}`] = {
      payloadBytes: Buffer.byteLength(page(rows)),
      heapBytesPerEntry: Math.round(bytes / FILL),
      // What the shipped cap costs at this page shape, which is the sentence a default owes.
      heapAtShippedCapMB: round(((bytes / FILL) * shipped.maxEntries) / 1024 / 1024)
    }
    invalidateCache()
  }

  // Store mechanics as the store grows: a hit is a delete plus a reinsert (that is how the Map
  // keeps LRU order), a write at a full store also evicts, and the background sweep walks
  // everything. If any of the three grew with size, the cap would be a performance decision;
  // the point of measuring is to find out whether it is only a memory one.
  const small = entryFor(25)
  const ops: Record<string, any> = {}
  for (const size of [1000, 10_000, 50_000]) {
    configureCache({ enabled: true, ttl: 3600, maxEntries: size })
    for (let i = 0; i < size; i++) cacheSet(keyAt(i), small)
    let n = 0
    const readHit = await perOp(() => void cacheGet(keyAt(n++ % size)), 2000)
    const writeEvict = await perOp(() => cacheSet(keyAt(size + (n++ % 1000)), small), 2000)
    // The 60s sweep iterates the whole store. An invalidation of a key-group that matches
    // nothing is that same full walk, in shipped code, so the cost is measured, not modelled.
    const fullScan = await measure(() => invalidateCache('matches-no-key-group'), 7)
    ops[size] = {
      readHitUs: readHit.usPerOp,
      writeEvictUs: writeEvict.usPerOp,
      fullScanMs: fullScan.medianMs
    }
    invalidateCache()
  }
  configureCache({ enabled: false })

  const typicalBytes = perEntry.rows25.heapBytesPerEntry
  const budgetBytes = CACHE_BUDGET_MB * 1024 * 1024
  // Rounded to something a human would write in a config file.
  const affordable = Math.max(100, Math.round(budgetBytes / typicalBytes / 100) * 100)

  return {
    shipped: { ttlSeconds: shipped.ttl, maxEntries: shipped.maxEntries },
    defaultTtlSeconds: { singleTenant: defaultTtlFor(false), withTenants: defaultTtlFor(true) },
    perEntry,
    ops,
    budgetMB: CACHE_BUDGET_MB,
    maxEntriesAtBudget: affordable,
    note: 'maxEntries bounds the COUNT, not the bytes: the same cap is a different amount of memory at a different page size'
  }
}

/**
 * What a rate limit costs the server, and what it buys against an attacker.
 *
 * A limit is two numbers and only one of them is about performance. `max` per `timeWindow`
 * decides how many password guesses one address gets per day, and the price of refusing them is
 * one bcrypt verification each, which is the most expensive thing on the login path. So the
 * bench measures the limiter's own overhead and the table it keeps per address, and then prices
 * the limits in the units that actually decide them: guesses per day, and CPU per minute.
 */
async function tuneRateLimit(): Promise<any> {
  const fastifyMod = await import('fastify').catch(() => null)
  const rateLimitMod = await import('@fastify/rate-limit').catch(() => null)
  if (!fastifyMod || !rateLimitMod) return { skipped: 'fastify or @fastify/rate-limit is not installed' }
  const fastify = (fastifyMod as any).default
  const rateLimit = (rateLimitMod as any).default

  const build = async (limit: any) => {
    const app = fastify({ logger: false })
    // Exactly how the framework registers it: only routes that opt in are limited.
    await app.register(rateLimit, { global: false })
    app.get('/plain', async () => ({ ok: true }))
    app.get('/limited', { config: { rateLimit: limit } }, async () => ({ ok: true }))
    await app.ready()
    return app
  }

  // Overhead: the same route with and without the limiter, on a ceiling high enough that
  // nothing is ever refused while it is being measured.
  const wide = await build({ max: 1_000_000, timeWindow: 60_000 })
  // Batched, because one inject costs about a tenth of a millisecond and the limiter's share of
  // it is under the noise of a single timed call. Measured one call at a time the overhead came
  // out NEGATIVE, and a negative overhead is not a small number, it is an absent one.
  const BATCH = 200
  const injectBatch = async (url: string) => {
    const sample = await measure(async () => {
      for (let i = 0; i < BATCH; i++) await wide.inject({ method: 'GET', url, remoteAddress: '10.0.0.1' })
    }, 7)
    return { perRequestMs: round(sample.medianMs / BATCH), batchMedianMs: sample.medianMs, spreadPct: sample.spreadPct }
  }
  const plain = await injectBatch('/plain')
  const limited = await injectBatch('/limited')
  await wide.close()

  // The table is keyed per address and the plugin bounds it at its `cache` option (5000 by
  // default). Measured as a DIFFERENCE between 5000 requests from 5000 addresses and 5000
  // requests from one address: both retain whatever a request retains, and only the first fills
  // the table, so the subtraction leaves the table and nothing else. Measured the direct way it
  // read 10 KB per address, which is the cost of the inject machinery wearing the table's name.
  const TRACKED = 5000
  const heapAfterRequests = async (address: (i: number) => string) => {
    const app = await build({ max: 1_000_000, timeWindow: 60_000 })
    forceGc()
    const before = process.memoryUsage().heapUsed
    for (let i = 0; i < TRACKED; i++) {
      await app.inject({ method: 'GET', url: '/limited', remoteAddress: address(i) })
    }
    forceGc()
    const used = process.memoryUsage().heapUsed - before
    await app.close()
    return used
  }
  const manyAddresses = await heapAfterRequests((i) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`)
  const oneAddress = await heapAfterRequests(() => '10.0.0.1')
  const heapPerAddress = Math.max(0, Math.round((manyAddresses - oneAddress) / TRACKED))

  // The same defaults the framework ships, read the same way `lib/api/auth/routes.ts` reads
  // them, so the bench prices what is actually running.
  const authMax = Math.floor(Number(process.env.AUTH_RATELIMIT_MAX) || 10)
  const authWindow = Math.floor(Number(process.env.AUTH_RATELIMIT_WINDOW) || 60_000)

  // Where the refusal actually lands, rather than where the configuration says it should.
  const strict = await build({ max: authMax, timeWindow: authWindow })
  const codes: number[] = []
  for (let i = 0; i < authMax + 2; i++) {
    codes.push((await strict.inject({ method: 'GET', url: '/limited', remoteAddress: '10.9.9.9' })).statusCode)
  }
  const anotherAddress = (await strict.inject({ method: 'GET', url: '/limited', remoteAddress: '10.9.9.10' })).statusCode
  await strict.close()

  // One refused login still costs a password verification, which is the whole point of the
  // limit being low: the cheap request is the attacker's, not the server's.
  const bcrypt = await import('bcrypt').catch(() => null)
  const cost = Math.floor(Number(process.env.BCRYPT_COST) || 12)
  let verifyMs = 0
  if (bcrypt) {
    const hash = await (bcrypt as any).default.hash('a-representative-password', cost)
    verifyMs = (await measure(() => (bcrypt as any).default.compare('a-wrong-password', hash), 5)).medianMs
  }

  const cores = os.cpus()?.length || 1
  /**
   * What one address can make the server spend, per minute, at this limit.
   *
   * `costMs` is the price of the work BEHIND the limit, and it is a parameter because the two
   * limits guard completely different work: a refused login still costs a bcrypt verification,
   * while the 404 handler costs a `reply.code(404).send()`. Charging a hash to the 404 handler
   * priced it at a quarter of a core per address and made the shipped limit look reckless. It
   * was the model that was wrong, which is the failure this whole file is written against.
   */
  const price = (max: number, windowMs: number, costMs: number, work: string) => {
    const cpuPerMinute = costMs ? round(max * costMs * (60_000 / windowMs)) : 0
    return {
      max,
      timeWindowMs: windowMs,
      work,
      costPerRequestMs: round(costMs),
      requestsPerDayPerAddress: Math.round(max * (86_400_000 / windowMs)),
      ...(cpuPerMinute
        ? {
            cpuMsPerMinutePerAddress: cpuPerMinute,
            percentOfOneCorePerAddress: round((cpuPerMinute / 60_000) * 100),
            addressesToSaturateOneCore: Math.ceil(60_000 / cpuPerMinute),
            addressesToSaturateThisMachine: Math.ceil((60_000 * cores) / cpuPerMinute)
          }
        : {})
    }
  }

  // The line the recommendation is drawn at, declared instead of implied: one address must not
  // be able to spend more than a quarter of a core on password verification.
  const CEILING_PERCENT_OF_CORE = 25
  const auth = price(authMax, authWindow, verifyMs, 'one bcrypt verification per attempt')
  const overBudget = (auth as any).percentOfOneCorePerAddress > CEILING_PERCENT_OF_CORE
  const recommendedAuthMax = overBudget
    ? Math.max(1, Math.floor((((CEILING_PERCENT_OF_CORE / 100) * 60_000) / (60_000 / authWindow)) / verifyMs))
    : authMax

  return {
    verification: { bcryptCost: cost, medianMs: round(verifyMs) },
    overheadPerRequestMs: round(limited.perRequestMs - plain.perRequestMs),
    injectPerRequestMs: { withoutLimiter: plain.perRequestMs, withLimiter: limited.perRequestMs, batchSize: BATCH },
    addressTable: { tracked: TRACKED, heapBytesPerAddress: heapPerAddress, heapMB: round((heapPerAddress * TRACKED) / 1024 / 1024) },
    refusedAtRequest: codes.indexOf(429) + 1,
    otherAddressStillAllowed: anotherAddress === 200,
    auth,
    // The 404 handler in index.ts, which is the only limit a request meets without opting in.
    // The work behind it is a 404 with no handler, so that is what it is priced at.
    notFound: price(30, 30_000, plain.perRequestMs, 'a 404 with no handler behind it'),
    ceilingPercentOfOneCore: CEILING_PERCENT_OF_CORE,
    recommendedAuthMax,
    verdict: overBudget
      ? `one address can spend more than ${CEILING_PERCENT_OF_CORE}% of a core: lower AUTH_RATELIMIT_MAX to ${recommendedAuthMax}`
      : 'measured and affordable: the shipped pair stays'
  }
}

// ── writing it down ───────────────────────────────────────────────────────────────────────
function provenance() {
  const cpus = os.cpus() || []
  return {
    at: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
    loadAverage1m: round(os.loadavg()[0]),
    // Named so a reader can tell a laptop measurement from a production one at a glance, which
    // is the single fact appendix A was missing.
    host: os.hostname()
  }
}

/** What the .env file says today, so the diff is about the file that will be rewritten. */
function readEnvFile(): Record<string, string> {
  if (!fs.existsSync(ENV_FILE)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (match) out[match[1]] = match[2].trim()
  }
  return out
}

/** The environment lines this run would change, and what they are today. */
function proposedEnv(report: any): Record<string, string> {
  const proposed: Record<string, string> = {}
  if (report.bcrypt?.recommended) proposed.BCRYPT_COST = String(report.bcrypt.recommended)
  if (report.connections?.recommendedContainerBudget) {
    proposed.TENANT_CONTAINERS_MAX_OPEN = String(report.connections.recommendedContainerBudget)
  }
  // Only when the measurement disagrees with what is shipped. A tool that writes a line saying
  // exactly what the code already does teaches the reader that its output is noise.
  const auth = report.rateLimit
  if (auth?.recommendedAuthMax && auth.recommendedAuthMax !== auth.auth?.max) {
    proposed.AUTH_RATELIMIT_MAX = String(auth.recommendedAuthMax)
  }
  return proposed
}

function applyToEnv(proposed: Record<string, string>): void {
  const before = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
  // The previous file is kept beside the new one, named by when it was replaced. An operator
  // undoing this at 3am should not have to reconstruct anything.
  const backup = `${ENV_FILE}.before-tune-${Date.now()}`
  if (before) fs.writeFileSync(backup, before)

  let after = before
  for (const [key, next] of Object.entries(proposed)) {
    const line = `${key}=${next}`
    after = new RegExp(`^${key}=.*$`, 'm').test(after)
      ? after.replace(new RegExp(`^${key}=.*$`, 'm'), line)
      : `${after.replace(/\n*$/, '')}\n${line}\n`
  }
  fs.writeFileSync(ENV_FILE, after)

  say('')
  say(`  wrote ${path.relative(process.cwd(), ENV_FILE)}`)
  if (before) say(`  previous file kept at ${path.relative(process.cwd(), backup)}`)
}

// ── the run ───────────────────────────────────────────────────────────────────────────────
async function main() {
  const unfit = machineIsFit()
  if (unfit && !FORCE) {
    say('')
    say(`  Refusing to measure: ${unfit}`)
    say('  Pass --force to measure anyway, and treat the numbers as indicative.')
    say('')
    process.exit(1)
  }
  if (unfit) say(`  (forced on an unfit machine: ${unfit})\n`)

  fs.writeFileSync(LOCK, String(process.pid))
  try {
    say('')
    say('  Measuring. This takes a minute or two, and the machine should stay idle.')
    say('')

    const report: any = { provenance: provenance(), targetMs: TARGET_MS }
    for (const [name, fn] of [
      ['bcrypt', tuneBcrypt],
      ['keyDerivation', tuneKeyDerivation],
      ['connections', tuneConnections],
      ['pageSize', tunePageSize],
      ['cache', tuneCache],
      ['rateLimit', tuneRateLimit]
    ] as const) {
      process.stdout.write(`  ${name} … `)
      report[name] = await fn()
      say(report[name]?.skipped ? `skipped (${report[name].skipped})` : 'done')
    }

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
    say('')
    say(`  Wrote ${path.relative(process.cwd(), OUT)} — every number carries where it came from.`)

    // The cache cap is not an environment variable: it lives in `options.cache` of the
    // consumer's `config/general.ts`, so it is reported here instead of being proposed for .env.
    const cache = report.cache
    if (cache && !cache.skipped) {
      say('')
      say(`  Cache: ${cache.perEntry.rows25.heapBytesPerEntry} B per entry at a 25-row page, so the shipped`)
      say(`  maxEntries ${cache.shipped.maxEntries} costs about ${cache.perEntry.rows25.heapAtShippedCapMB} MB (${cache.perEntry.rows100.heapAtShippedCapMB} MB at a 100-row page).`)
      say(`  ${CACHE_BUDGET_MB} MB of budget buys maxEntries ${cache.maxEntriesAtBudget} at that page shape.`)
    }
    if (report.rateLimit && !report.rateLimit.skipped) {
      say(`  Rate limit: ${report.rateLimit.verdict}`)
    }

    const proposed = proposedEnv(report)
    if (!Object.keys(proposed).length) {
      say('  Nothing to propose: the measurements that produce settings were all skipped.')
      return
    }

    say('')
    say('  Proposed:')
    // Compared against what is in the FILE, not against `process.env`: the file is what
    // `--write-config` rewrites, and a diff that reads somewhere else is a diff about the wrong
    // thing — it reports "not set" over a line it is about to overwrite.
    const envNow = readEnvFile()
    for (const [key, next] of Object.entries(proposed)) {
      const current = envNow[key]
      const suffix = current === undefined ? '   (not in .env)' : current === next ? '   (unchanged)' : `   (currently ${current})`
      say(`    ${key}=${next}${suffix}`)
    }

    if (!WRITE_CONFIG) {
      say('')
      say('  Not applied. A measurement taken on a busy machine is plausible and wrong, and the')
      say('  difference is only visible by reading it — so pass --write-config when you have.')
      say('')
      return
    }
    applyToEnv(proposed)
    say('')
  } finally {
    fs.rmSync(LOCK, { force: true })
  }
}

main().catch((error) => {
  fs.rmSync(LOCK, { force: true })
  console.error(error)
  process.exit(1)
})
