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
      ['pageSize', tunePageSize]
    ] as const) {
      process.stdout.write(`  ${name} … `)
      report[name] = await fn()
      say(report[name]?.skipped ? `skipped (${report[name].skipped})` : 'done')
    }

    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
    say('')
    say(`  Wrote ${path.relative(process.cwd(), OUT)} — every number carries where it came from.`)

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
