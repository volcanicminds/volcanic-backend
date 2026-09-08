/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm'
import type { ContainerRef, Migration, MigrationRunner } from '../ports.js'
import { readMigrations, statementsOf, type MigrationFile } from './files.js'
import { uuidv7 } from '../uuid.js'

//
// The migration engine (T-5.1).
//
// Why the framework applies the SQL itself instead of calling `drizzle-kit`'s runtime
// migrator, which is what `docs/SCHEMA_V5.md` §2.4 first assumed: that migrator applies the
// statements of a file as they are written, into whatever the connection resolves. Our
// tables are built by a factory over a schema chosen at runtime, so the generated SQL is
// deliberately UNQUALIFIED and the same file has to land in `tenant_acme` one minute and in
// `tenant_globex` the next. There is no argument for that, so the engine is here.
//
// This is also the one place T-3.1 sanctions a `search_path`: inside a transaction, with
// `SET LOCAL`, which the commit or the rollback undoes by definition. The rule was never
// "never name a schema", it was "never leave one on a pooled connection".
//
// Three properties, and each of them is a decision:
//
//   - **one transaction per migration**, not one for the whole set. A set that fails halfway
//     leaves the migrations that succeeded applied and recorded, so the next run resumes
//     instead of starting over. On a fleet of a thousand containers, "start over" means
//     "never finish".
//   - **the record is written in the same transaction as the change**. A migration that
//     applied but was not recorded would be applied twice, and the second time it fails.
//   - **an edited migration is a failure, not a skip**. The hash is compared: a file that
//     changed after it ran means the container's schema and the repository disagree about
//     what happened, and the answer to that is to stop.
//
export interface MigrationSet {
  /** `control` or `tenant`: which set this is, recorded next to each applied name. */
  readonly name: string
  /**
   * Folders read in order, framework first, consumer second (T-5.1 point 5). The framework
   * owns the migrations of its own tables; a consumer's entities are the consumer's to move.
   */
  readonly folders: readonly string[]
}

export interface MigrationTarget {
  /** The handle of the container to migrate. */
  handle: any
  /** Postgres only: the schema to run inside. Absent for a file-per-container engine. */
  locator?: string
  dialect: 'postgres' | 'sqlite'
}

export class MigrationMismatchError extends Error {
  readonly code = 'MIGRATION_CHANGED'
  constructor(name: string, container: string) {
    super(
      `Migration '${name}' was applied to '${container}' with a different content. ` +
        'A migration is immutable once it has run: add a new one instead of editing it.'
    )
    this.name = 'MigrationMismatchError'
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/i

function assertLocator(locator: string): string {
  if (!IDENTIFIER.test(locator)) throw new Error(`Invalid container '${locator}'`)
  return `"${locator}"`
}

/** Every migration of a set, framework folders first. */
export function loadSet(set: MigrationSet): MigrationFile[] {
  const seen = new Set<string>()
  const all: MigrationFile[] = []
  for (const folder of set.folders) {
    for (const file of readMigrations(folder)) {
      // A consumer cannot shadow a framework migration by reusing its name: the collision
      // would be silent, and one of the two would never run.
      if (seen.has(file.name)) throw new Error(`Duplicate migration name '${file.name}' in ${folder}`)
      seen.add(file.name)
      all.push(file)
    }
  }
  return all.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
}

/** What a container has already applied, of one set, oldest first. */
async function applied(target: MigrationTarget, set: string): Promise<Array<{ name: string; hash: string }>> {
  const table = target.locator ? `${assertLocator(target.locator)}.migration` : 'migration'
  try {
    const rows: any = await target.handle.execute(
      sql.raw(`select name, hash from ${table} where "set" = '${set.replace(/'/g, "''")}' order by name asc`)
    )
    return (rows?.rows ?? rows ?? []) as Array<{ name: string; hash: string }>
  } catch {
    // No `migration` table yet: an empty container has applied nothing. This is the only
    // failure read as an answer, and it is the one the first migration of the set fixes.
    return []
  }
}

/**
 * Applies one migration, and records it, in a single transaction.
 *
 * The `SET LOCAL search_path` is what lets one unqualified file land in any container. It is
 * scoped to this transaction by definition of the statement, so the connection goes back to
 * the pool exactly as it came out (T-3.1).
 */
async function applyOne(target: MigrationTarget, set: string, file: MigrationFile): Promise<void> {
  await target.handle.transaction(async (tx: any) => {
    if (target.locator) {
      await tx.execute(sql.raw(`set local search_path to ${assertLocator(target.locator)}`))
    }
    for (const statement of statementsOf(file)) {
      await tx.execute(sql.raw(statement))
    }
    await tx.execute(
      sql.raw(
        `insert into migration ("id", "set", "name", "hash") values ` +
          `('${uuidv7()}', '${set.replace(/'/g, "''")}', '${file.name.replace(/'/g, "''")}', '${file.hash}')`
      )
    )
  })
}

export function createMigrationRunner(
  open: (container: ContainerRef) => Promise<MigrationTarget>,
  sets: Record<string, MigrationSet>
): MigrationRunner {
  const setFor = (container: ContainerRef): MigrationSet => {
    const set = sets[container.tenantId ? 'tenant' : 'control']
    if (!set) throw new Error('No migration set is configured for this container')
    return set
  }

  const outstanding = async (container: ContainerRef) => {
    const set = setFor(container)
    const target = await open(container)
    const done = new Map((await applied(target, set.name)).map((r) => [r.name, r.hash]))

    const files = loadSet(set)
    for (const file of files) {
      const hash = done.get(file.name)
      if (hash !== undefined && hash !== file.hash) {
        throw new MigrationMismatchError(file.name, container.locator)
      }
    }
    return { set, target, files: files.filter((f) => !done.has(f.name)), done }
  }

  return {
    async pending(container: ContainerRef): Promise<Migration[]> {
      const { files } = await outstanding(container)
      return files.map((f) => ({ id: f.hash, name: f.name }))
    },

    async apply(container: ContainerRef, upTo?: string): Promise<string> {
      const { set, target, files, done } = await outstanding(container)
      // `upTo` stops the set at a name, so a fleet can be brought to one version without
      // carrying the newest one to a container that is not ready for it.
      const run = upTo ? files.filter((f) => f.name <= upTo) : files

      let last = [...done.keys()].sort().pop() ?? null
      for (const file of run) {
        if (log?.i) log.info(`Migration ${set.name}/${file.name}: applying to ${container.locator}`)
        await applyOne(target, set.name, file)
        last = file.name
      }
      return last ?? ''
    },

    async version(container: ContainerRef): Promise<string | null> {
      const set = setFor(container)
      const target = await open(container)
      const rows = await applied(target, set.name)
      return rows.length ? rows[rows.length - 1].name : null
    }
  }
}
