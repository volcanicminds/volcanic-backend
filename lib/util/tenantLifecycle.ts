import fs from 'fs'
import type { ExportedArtifact, Tenant, TenantHandle, TenantLifecycle, TenantPlace } from '../../types/global.js'

//
// The packages that follow a tenant's life (`TenantLifecycle`).
//
// Each runs inside the route that drives the moment, in the order given to `start()`, and its
// failure is the route's failure, named with the package: an export that left a package's data
// out, or a destruction that left it behind, would report a success that is not one.
//

const NAME = /^[A-Za-z0-9_-]+$/

/**
 * Checked at boot: the name ends up in the export's file names, so one that is not a file name,
 * or two packages with the same one, is an export overwriting itself.
 */
export function tenantLifecyclesOf(given: readonly TenantLifecycle[] | undefined): readonly TenantLifecycle[] {
  const lifecycles = [...(given ?? [])]
  const seen = new Set<string>()
  for (const lifecycle of lifecycles) {
    const name = String(lifecycle?.name ?? '')
    if (!NAME.test(name)) throw new Error(`tenantLifecycles: '${name}' is not a valid name (letters, digits, '-' and '_')`)
    if (seen.has(name)) throw new Error(`tenantLifecycles: '${name}' is given twice`)
    seen.add(name)
  }
  return Object.freeze(lifecycles)
}

async function named<T>(lifecycle: TenantLifecycle, moment: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    throw new Error(`Tenant lifecycle '${lifecycle.name}' failed to ${moment}: ${(error as Error)?.message}`, { cause: error })
  }
}

/**
 * Runs every `create`. Each package is pushed on `started` BEFORE it runs, so the one that fails
 * is undone with the others: it may have written half of what it meant to.
 */
export async function createInPackages(
  lifecycles: readonly TenantLifecycle[],
  place: TenantPlace,
  handle: TenantHandle,
  started: TenantLifecycle[]
): Promise<void> {
  for (const lifecycle of lifecycles) {
    if (!lifecycle.create) continue
    started.push(lifecycle)
    await named(lifecycle, 'create', () => lifecycle.create!(place, handle))
  }
}

/**
 * Undoes a creation that failed: every package that started, last first. Never throws, because it
 * runs on the way out of a failure that is the one to report; returns the messages of what could
 * not be undone, for the caller to say out loud.
 */
export async function undoPackages(started: readonly TenantLifecycle[], place: TenantPlace): Promise<string[]> {
  const failures: string[] = []
  for (const lifecycle of [...started].reverse()) {
    if (!lifecycle.destroy) continue
    try {
      await named(lifecycle, 'destroy', () => lifecycle.destroy!(place))
    } catch (error) {
      failures.push((error as Error).message)
    }
  }
  return failures
}

/**
 * Runs every `export`, each writing next to the dump at `<dump without extension>.<name>`. On a
 * failure the dump and what the packages wrote are removed before the error goes on: an export
 * missing part of the tenant must not sit in the directory looking like a whole one.
 */
export async function exportFromPackages(lifecycles: readonly TenantLifecycle[], tenant: Tenant, dump: string): Promise<ExportedArtifact[]> {
  const stem = dump.replace(/\.[^./]+$/, '')
  const artifacts: ExportedArtifact[] = []
  try {
    for (const lifecycle of lifecycles) {
      if (!lifecycle.export) continue
      // Listed before it runs, so a package that fails halfway is cleaned up with the rest.
      const artifact: ExportedArtifact = { name: lifecycle.name, path: `${stem}.${lifecycle.name}`, bytes: 0 }
      artifacts.push(artifact)
      artifact.bytes = await named(lifecycle, 'export', () => lifecycle.export!(tenant, artifact.path))
    }
    return artifacts
  } catch (error) {
    for (const written of [dump, ...artifacts.map((a) => a.path)]) fs.rmSync(written, { recursive: true, force: true })
    throw error
  }
}

/** What each package says of itself for the manifest; null for one without `describe`. */
export async function describePackages(
  lifecycles: readonly TenantLifecycle[],
  tenant: Tenant
): Promise<Map<string, Record<string, unknown> | null>> {
  const described = new Map<string, Record<string, unknown> | null>()
  for (const lifecycle of lifecycles) {
    described.set(lifecycle.name, lifecycle.describe ? await named(lifecycle, 'describe', () => lifecycle.describe!(tenant)) : null)
  }
  return described
}

/**
 * The packages a restore cannot rebuild, given the parts the export holds: a part whose package is
 * not in this build, or whose package has no `restore`. Checked before anything is built.
 */
export function unrestorable(lifecycles: readonly TenantLifecycle[], parts: readonly string[]): string[] {
  return parts.filter((name) => !lifecycles.find((l) => l.name === name)?.restore)
}

/**
 * The creation's step for a restored tenant: `restore` from its part for a package the export holds
 * one for, `create` for the others. Pushed on `started` before each runs, as on a creation.
 */
export async function restoreInPackages(
  lifecycles: readonly TenantLifecycle[],
  place: TenantPlace,
  handle: TenantHandle,
  parts: ReadonlyMap<string, string>,
  started: TenantLifecycle[]
): Promise<void> {
  for (const lifecycle of lifecycles) {
    const source = parts.get(lifecycle.name)
    if (source) {
      started.push(lifecycle)
      await named(lifecycle, 'restore', () => lifecycle.restore!(place, handle, source))
    } else if (lifecycle.create) {
      started.push(lifecycle)
      await named(lifecycle, 'create', () => lifecycle.create!(place, handle))
    }
  }
}

/** Runs every `destroy`, in order, and stops at the first failure: the tenant is then still there to destroy again. */
export async function destroyInPackages(lifecycles: readonly TenantLifecycle[], place: TenantPlace): Promise<void> {
  for (const lifecycle of lifecycles) {
    if (lifecycle.destroy) await named(lifecycle, 'destroy', () => lifecycle.destroy!(place))
  }
}
