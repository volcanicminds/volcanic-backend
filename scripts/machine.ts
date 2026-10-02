//
// The machine a bench runs on: whether it can be measured now, and what it was.
//
// Shared by the tuning bench (scripts/tune.ts) and the hot-path bench (scripts/bench-paths.ts),
// so both refuse the same conditions, sign their numbers the same way, and refuse to run while
// the other one is: two benches on one machine measure each other.
//
import fs from 'fs'
import os from 'os'
import path from 'path'

/** Held by whichever bench is running, removed when it ends. */
export const BENCH_LOCK = path.join(os.tmpdir(), 'volcanic-bench.lock')

const round = (n: number) => Math.round(n * 100) / 100

/**
 * Better no number than a number taken while something else was running: a plausible wrong
 * figure is worse than a missing one, because it gets used.
 */
export function machineIsFit(): string | null {
  const cores = os.cpus()?.length || 1
  const [load1] = os.loadavg()
  // loadavg is 0 on Windows, so "no signal" is not "idle".
  if (load1 > 0 && load1 / cores > 0.4) {
    return `the machine is busy (load ${load1.toFixed(2)} over ${cores} cores). Measuring now would report the contention, not the cost.`
  }
  if (fs.existsSync(BENCH_LOCK)) {
    return `another bench is running (${BENCH_LOCK}). Two benches on one machine measure each other.`
  }
  return null
}

export function provenance() {
  const cpus = os.cpus() || []
  return {
    at: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    cpu: cpus[0]?.model ?? 'unknown',
    cores: cpus.length,
    totalMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
    loadAverage1m: round(os.loadavg()[0]),
    // Named so a reader can tell a laptop measurement from a production one at a glance.
    host: os.hostname()
  }
}
