/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Bring the CONTROL plane to the current schema version (T-5.2).
//
// The control plane is migrated ONCE, by hand or by a deploy step, and that is the whole
// reason it is a separate command from the fleet migrator (T-5.3): one is an operation on a
// single database that either worked or did not, the other walks N containers and has to be
// resumable, bounded and interruptible. Merging them would give the safe operation the
// ceremony of the dangerous one, and the dangerous one the casualness of the safe one.
//
//   npm run db:migrate            apply
//   npm run db:migrate -- --dry   list what would be applied, touch nothing
//
import logger from '../lib/util/logger.js'
import * as loaderConfig from '../lib/loader/general.js'

global.log = logger as never

async function main() {
  const dry = process.argv.includes('--dry')

  const config = await loaderConfig.load()
  ;(global as any).config = config

  const schema = (config.options as any)?.control?.schema || 'public'
  const dataLayer: any = await import('../db.js')
  const { migrations, shutdown } = await dataLayer.start(config.options)

  // No tenantId: the runner reads that as "the control set" (lib/database/migrations/runner.ts).
  const container = { locator: schema }

  try {
    const pending = await migrations.pending(container)
    if (pending.length === 0) {
      logger.info(`Control plane '${schema}' is at ${(await migrations.version(container)) || 'no migration'}: nothing to apply`)
      return
    }

    logger.info(`Control plane '${schema}': ${pending.length} migration(s) pending`)
    for (const m of pending) logger.info(`  - ${m.name}`)
    if (dry) return

    const reached = await migrations.apply(container)
    logger.info(`Control plane '${schema}' is now at ${reached}`)
  } finally {
    await shutdown()
  }
}

main().catch((error) => {
  logger.fatal(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
