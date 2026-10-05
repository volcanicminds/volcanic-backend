/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The HTTP bench: whole requests to the whole server (`npm run bench:http`).
//
// bench-paths times the statements behind a request; this times the request around them: the
// routing, the hooks, the token, the tenant resolution, the serialization, on a real socket. The
// server is the one a consumer boots (scripts/httpWorld.ts), the requests are the ones whose
// statements the query budget counts (test/budget/queryBudget.spec.ts), and the client is autocannon
// on a worker thread, so the load it generates does not queue behind the server on one event loop.
//
// Numbers, not a gate. A latency depends on the machine and on what else runs on it: compare a run
// with a baseline taken on the same machine (`--out`, `--baseline`), and read the IQR before
// reading a difference. The gate CI can hold is the statement count, which is the budget's.
// `--smoke` runs one short round, for CI to prove the bench still runs: it fails only on a request
// that did not answer 2xx.
//
// PGlite always, Postgres too with BENCH_DATABASE_URL, on throwaway schemas it refuses to take
// over. `--tenancy single` drops the tenants block (default `schema`). One tenancy per process:
// lib/api/system/routes.ts decides whether it is mounted when it is imported.
//
import fs from 'fs'
import path from 'path'
import autocannon from 'autocannon'
import { openWorld, SCENARIOS, type HttpWorld, type Scenario, type Tenancy } from './httpWorld.js'
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

const SMOKE = has('--smoke')
const FORCE = has('--force') || SMOKE
const ROUNDS = SMOKE ? 1 : count('--rounds', 10)
const DURATION_S = SMOKE ? 1 : count('--duration', 3)
const CONNECTIONS = count('--connections', 10)
const TENANCY = (text('--tenancy') ?? 'schema') as Tenancy
const OUT = path.resolve(process.cwd(), text('--out') ?? 'bench-http.json')
const BASELINE = text('--baseline')
const POSTGRES_URL = process.env.BENCH_DATABASE_URL
// Enough rows that the list reads one page of many and the count walks the whole table.
const USERS = 1000

const say = (line = '') => process.stdout.write(line + '\n')

// ── measuring ─────────────────────────────────────────────────────────────────────────────
// autocannon records latencies in whole milliseconds: a percentile of a fast route reads 0. The
// mean keeps the fraction; the p99 is the tail, where a millisecond is a fine grain.
interface Sample {
  rps: number
  meanMs: number
  p99Ms: number
}

interface ScenarioResult {
  rpsMedian: number
  meanMsMedian: number
  p99MsMedian: number
  /** p25 to p75 of the requests per second, as a share of the median. */
  rpsIqrPct: number
  rounds: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

async function hit(world: HttpWorld, scenario: Scenario, seconds: number): Promise<Sample> {
  const r: any = await autocannon({
    url: world.origin + scenario.url,
    headers: world.headers(scenario.as),
    connections: CONNECTIONS,
    duration: seconds,
    workers: 1
  })
  // A bench that times refusals measures nothing: a 401 is faster than the answer it replaces.
  if (r.non2xx || r.errors) {
    throw new Error(`${scenario.name}: ${r.non2xx} answers not 2xx and ${r.errors} errors over ${r.requests.total} requests`)
  }
  return { rps: r.requests.total / r.duration, meanMs: r.latency.average, p99Ms: r.latency.p99 }
}

function quantile(values: number[], q: number) {
  const s = [...values].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]
}

function summarise(samples: Sample[]): ScenarioResult {
  const rps = samples.map((s) => s.rps)
  const median = quantile(rps, 0.5)
  return {
    rpsMedian: round2(median),
    meanMsMedian: round2(quantile(samples.map((s) => s.meanMs), 0.5)),
    p99MsMedian: round2(quantile(samples.map((s) => s.p99Ms), 0.5)),
    rpsIqrPct: round2(median > 0 ? ((quantile(rps, 0.75) - quantile(rps, 0.25)) / median) * 100 : 0),
    rounds: samples.length
  }
}

/**
 * Every scenario once per round, starting from a different one each time, so a drift of the
 * machine during the run lands on all of them instead of on whichever ran last.
 */
async function measureWorld(world: HttpWorld): Promise<Record<string, ScenarioResult>> {
  // Untimed: JIT, the driver's caches, the server's prepared statements.
  for (const scenario of SCENARIOS) await hit(world, scenario, 1)

  const samples: Record<string, Sample[]> = Object.fromEntries(SCENARIOS.map((s) => [s.name, []]))
  for (let r = 0; r < ROUNDS; r++) {
    for (let i = 0; i < SCENARIOS.length; i++) {
      const scenario = SCENARIOS[(i + r) % SCENARIOS.length]
      samples[scenario.name].push(await hit(world, scenario, DURATION_S))
    }
  }
  return Object.fromEntries(Object.entries(samples).map(([name, s]) => [name, summarise(s)]))
}

// ── the run ───────────────────────────────────────────────────────────────────────────────
type Report = {
  provenance: ReturnType<typeof provenance>
  settings: object
  results: Record<string, Record<string, ScenarioResult>>
}

function print(results: Report['results'], baseline?: Report) {
  for (const [config, scenarios] of Object.entries(results)) {
    say('')
    say(`  ${config}`)
    say(
      `    ${'scenario'.padEnd(14)}${'req/s'.padStart(10)}${'mean ms'.padStart(9)}${'p99 ms'.padStart(9)}${'IQR'.padStart(8)}` +
        (baseline ? 'req/s vs baseline'.padStart(22) : '')
    )
    for (const [name, r] of Object.entries(scenarios)) {
      const before = baseline?.results?.[config]?.[name]
      const ratio = before ? `${(r.rpsMedian / before.rpsMedian).toFixed(3)} (±${before.rpsIqrPct.toFixed(1)}%)` : ''
      say(
        `    ${name.padEnd(14)}${r.rpsMedian.toFixed(0).padStart(10)}${r.meanMsMedian.toFixed(2).padStart(9)}` +
          `${r.p99MsMedian.toFixed(2).padStart(9)}${`${r.rpsIqrPct.toFixed(1)}%`.padStart(8)}  ${ratio.padStart(20)}`
      )
    }
  }
}

async function main() {
  if (TENANCY !== 'single' && TENANCY !== 'schema') throw new Error(`--tenancy is single or schema, not ${TENANCY}`)
  const unfit = machineIsFit()
  if (unfit && !FORCE) {
    say(`\n  Refusing to measure: ${unfit}\n  Pass --force to measure anyway, and treat the numbers as indicative.\n`)
    process.exit(1)
  }
  if (unfit) say(`  (forced on an unfit machine: ${unfit})`)
  const baseline: Report | undefined = BASELINE ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : undefined

  fs.writeFileSync(BENCH_LOCK, String(process.pid))
  try {
    const configs: Array<{ name: string; open: () => Promise<HttpWorld> }> = [
      { name: `pglite, tenancy ${TENANCY}`, open: () => openWorld({ engine: 'pglite', tenancy: TENANCY, users: USERS }) }
    ]
    if (POSTGRES_URL) {
      configs.push({
        name: `postgres, tenancy ${TENANCY}`,
        open: () =>
          openWorld({ engine: 'postgres', tenancy: TENANCY, url: POSTGRES_URL, prefix: 'bench_http', leftovers: 'refuse', users: USERS })
      })
    } else {
      say('  BENCH_DATABASE_URL is not set: Postgres is skipped, PGlite only.')
    }

    const results: Report['results'] = {}
    for (const config of configs) {
      process.stdout.write(`  ${config.name} … `)
      const world = await config.open()
      try {
        results[config.name] = await measureWorld(world)
      } finally {
        await world.close()
      }
      say('done')
    }

    const report: Report = {
      provenance: provenance(),
      settings: { rounds: ROUNDS, durationS: DURATION_S, connections: CONNECTIONS, tenancy: TENANCY, users: USERS, smoke: SMOKE },
      results
    }
    fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
    print(results, baseline)
    say('')
    say(`  Wrote ${path.relative(process.cwd(), OUT)}. Medians of ${ROUNDS} rounds of ${DURATION_S}s, ${CONNECTIONS} connections.`)
    say('  IQR is p25 to p75 of req/s over the median; the ratio is this median over the baseline one.')
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
