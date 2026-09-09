/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify'
import { tenantsConfig } from '../util/tenancy.js'

//
// The instance does not serve traffic on a schema its code does not match (T-5.4).
//
// This is invariant 2 applied to the schema: a mismatch is not a warning, it is a refusal to
// start. The failure mode it removes is the quiet one. A process that boots against an older
// schema does not crash; it answers requests, writes rows into columns that mean something
// else, and is discovered later by the data.
//
// Two planes, two treatments, and the asymmetry is deliberate:
//
//   - the CONTROL plane is one database, migrated once, before the code that needs it. If it
//     is behind, nothing this process does is trustworthy, so the process does not start;
//   - a TENANT container is one of many, and they are migrated over time. One container being
//     behind must not take the other nine hundred down with it: it is refused at resolution,
//     with an explicit error and a log line, and the rest keep serving.
//
export interface SchemaCheckOptions {
  /** Called instead of process.exit(1) on the fail-fast path (injected by tests). */
  onFatal?: (message: string) => void
}

/** `checkOnResolve` and `refuseStartIfControlBehind`, both default true (invariant 2). */
export function migrationChecks(): { onResolve: boolean; onBoot: boolean } {
  const declared = (tenantsConfig() as any)?.migrations ?? {}
  return {
    onResolve: declared.checkOnResolve !== false,
    onBoot: declared.refuseStartIfControlBehind !== false
  }
}

/**
 * Refuses to boot when the control plane is behind the code.
 *
 * A deployment without a `tenants` block has nowhere to declare the flag, and that is the
 * right answer rather than a gap: with one container and one schema, running the new code
 * against the old tables has no staged-rollout reading. Migrate first.
 */
export async function assertControlSchemaCurrent(server: FastifyInstance, opts: SchemaCheckOptions = {}): Promise<void> {
  const migrations = (server as any)?.['migrations']
  if (!migrations?.expected) return // no data layer: nothing to be behind

  const onFatal =
    opts.onFatal ||
    ((message: string) => {
      if (log?.f) log.fatal(message)
      process.exit(1)
    })

  const schema = (global as any).config?.options?.control?.schema || 'public'
  const container = { locator: schema }

  const expected = migrations.expected(container)
  if (!expected) return // no migrations shipped at all: nothing to compare against

  let applied: string | null
  try {
    applied = await migrations.version(container)
  } catch (e) {
    // Unreachable is not "up to date", and it is not "behind" either. It is a database this
    // process cannot serve from, and saying which of the three is the point.
    return onFatal(
      `Startup: cannot read the schema version of the control plane '${schema}': ${(e as Error)?.message}`
    )
  }

  if (applied === expected) {
    if (log?.i) log.info(`Schema 🧱 control plane at ${applied}`)
    return
  }

  if (!migrationChecks().onBoot) {
    if (log?.w) {
      log.warn(
        `Schema 🧱 control plane is at ${applied ?? 'no migration'}, the code expects ${expected}. ` +
          'Serving anyway because refuseStartIfControlBehind is false.'
      )
    }
    return
  }

  onFatal(
    `Startup: the control plane '${schema}' is at ${applied ?? 'no migration'} and this code expects ${expected}. ` +
      'Run `npm run db:migrate` (or `npx volcanic migrate --control`) before starting. ' +
      'To serve anyway during a staged rollout, set tenants.migrations.refuseStartIfControlBehind to false.'
  )
}
