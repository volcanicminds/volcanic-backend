#!/usr/bin/env node
//
// The operator's half of the fleet migrator (T-5.3).
//
// Deliberately thin: it parses arguments, prints a table and chooses an exit code. Everything
// that decides anything lives in `migrateFleet`, so a person at a terminal and a deploy script
// calling the exported function get the same behaviour and, more to the point, the same
// refusals. Two implementations of "migrate the fleet" would drift, and the one that drifts is
// always the one nobody tested.
//
//   npx volcanic migrate --tenants --snapshot <ref> [--dry-run]
//                        [--concurrency N] [--only a,b] [--target 0002_name]
//
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)

const flag = (name) => argv.includes(`--${name}`)
const value = (name, fallback) => {
  const withEquals = argv.find((a) => a.startsWith(`--${name}=`))
  if (withEquals) return withEquals.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback
}

const USAGE = `
volcanic sessions --purge [--tenants]

  --purge            REQUIRED. Removes the session rows no renewal can use any more (T-11.12).
  --tenants          Every active container as well as the control plane, instead of it alone.

volcanic auth-flows --purge [--tenants]

  --purge            REQUIRED. Removes the login flows that are over, once their sends have left
                     the per-subject window (T-12.18).
  --tenants          Every active container as well as the control plane, instead of it alone.

volcanic access-log --purge [--tenants]

  --purge            REQUIRED. Removes the access log rows past the retention of their plane:
                     ACCESS_LOG_RETENTION_DAYS (default 90) for tenant rows,
                     ACCESS_LOG_CONTROL_RETENTION_DAYS (default 180) for platform rows (T-12.33).
  --tenants          Every active container as well as the control plane, instead of it alone.

volcanic migrate --tenants --snapshot <reference> [options]

  --snapshot <ref>   REQUIRED. The backup you would restore from. Recorded in the run log.
  --dry-run          Report what would happen, container by container, and touch nothing.
  --concurrency <n>  Containers at a time (default 2, maximum 16).
  --only a,b         Only these tenants, by slug or id. For retrying failures or a staged rollout.
  --target <name>    Stop each container at this migration instead of the newest.
  --control          Migrate the control plane instead of the fleet.

Run it with --dry-run first. It is not a formality: it is the only step that costs nothing.
`

async function load(specifier) {
  const root = path.resolve(import.meta.dirname, '..')
  try {
    return await import(pathToFileURL(path.join(root, 'dist', specifier)).href)
  } catch {
    console.error(`Cannot load ${specifier}: the package is not built. Run \`npm run build\` first.`)
    process.exit(1)
  }
}

async function main() {
  const command = argv[0]
  const purges = { sessions: 'sessionManager', 'auth-flows': 'authFlowManager', 'access-log': 'accessLogManager' }
  const known = command === 'migrate' || command in purges
  // `sessions`, `auth-flows` and `access-log` have no default behaviour: the only thing they do is delete rows,
  // so it is asked for by name or not at all.
  const asked = command in purges ? flag('purge') : true
  if (!known || !asked || flag('help')) {
    console.log(USAGE)
    process.exit(known && flag('help') ? 0 : 1)
  }

  const logger = (await load('lib/util/logger.js')).default
  globalThis.log = logger

  const config = await (await load('lib/loader/general.js')).load()
  globalThis.config = config

  const dataLayer = await load('db.js')
  const layer = await dataLayer.start(config.options)

  try {
    // Each manager decides what "expired" means. Sessions (T-11.12): rows whose two clocks have
    // run out, so a revoked session stays until its own deadline and the reason it ended survives
    // it. Access log (T-12.33): rows past the retention of their own plane.
    if (command in purges) {
      // The paging over the registry lives in `purgeContainers` (lib/database/purge.ts), where
      // it is tested past the first thousand tenants.
      const { removed, containers } = await dataLayer.purgeContainers(layer, layer[purges[command]], { tenants: flag('tenants') })
      console.log(`${command}: ${removed} expired row(s) removed from ${containers} container(s)`)
      return 0
    }

    if (flag('control')) {
      const container = { locator: config.options?.control?.schema || 'public' }
      const pending = await layer.migrations.pending(container)
      if (flag('dry-run')) {
        console.log(pending.length ? `control plane: ${pending.map((m) => m.name).join(', ')}` : 'control plane: nothing to apply')
        return 0
      }
      const reached = await layer.migrations.apply(container)
      console.log(`control plane is at ${reached || 'no migration'}`)
      return 0
    }

    if (!flag('tenants')) {
      console.log(USAGE)
      return 1
    }

    // Interrupting is a supported way to stop, not a crash: the containers already migrated
    // stay migrated, and the run reports what it did not reach.
    const stopping = new AbortController()
    const stop = () => {
      console.error('\nInterrupted: finishing the containers in flight, then stopping.')
      stopping.abort()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)

    const result = await layer.migrateTenants({
      snapshot: value('snapshot'),
      dryRun: flag('dry-run'),
      concurrency: Number(value('concurrency', '2')),
      only: (value('only', '') || '').split(',').map((s) => s.trim()).filter(Boolean),
      target: value('target'),
      signal: stopping.signal
    })

    report(result)
    // Partial failure is explicit: the exit code says something went wrong and the output
    // says which containers, because "3 of 100 failed" is never the end of the question.
    return result.failed.length > 0 || result.interrupted ? 1 : 0
  } finally {
    await layer.shutdown()
  }
}

function report(result) {
  const width = Math.max(4, ...result.outcomes.map((o) => o.slug.length))
  console.log('')
  console.log(`snapshot: ${result.snapshot}${result.dryRun ? '   (DRY RUN, nothing was changed)' : ''}`)
  console.log('')
  for (const o of result.outcomes) {
    const move = o.status === 'up-to-date' ? o.to || 'empty' : `${o.from || 'empty'} -> ${o.to || '?'}`
    console.log(`  ${o.slug.padEnd(width)}  ${o.status.padEnd(14)}  ${move}${o.error ? `  ${o.error}` : ''}`)
  }
  console.log('')

  const count = (status) => result.outcomes.filter((o) => o.status === status).length
  console.log(
    `  ${result.total} container(s): ${count('migrated')} migrated, ${count('would-migrate')} would migrate, ` +
      `${count('up-to-date')} already current, ${count('locked')} locked, ${count('not-attempted')} not attempted, ` +
      `${result.failed.length} failed`
  )
  if (result.failed.length) {
    console.error('\nfailed:')
    for (const o of result.failed) console.error(`  ${o.slug} (${o.locator}): ${o.error}`)
  }
  console.log('')
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch(async (error) => {
    // The whole cause chain, for the same reason the per-container failures carry it: the
    // ORM's "Failed query: <sql>" says what was attempted and not what the database said
    // about it, and the second half is the only one the operator does not already have.
    let describe = (e) => e?.message || String(e)
    try {
      describe = (await load('lib/database/migrations/fleet.js')).describeError
    } catch {
      // Fall back to the plain message rather than losing the error to a failed import.
    }
    console.error(describe(error))
    process.exit(1)
  })
