import { sql } from 'drizzle-orm'
import { escapeIdentifier, type PostgresHandle } from '../adapters/postgres/index.js'

//
// What a container's package must not carry, and what it counts.
//
// The credentials are emptied, the columns stay: the dump keeps the shape of the live schema, and
// a user who comes back sets a password and a second factor on the same row through the flows that
// already exist. Nothing encrypted leaves, so no package depends on the key of the machine that
// made it. Run on a copy before a package is written, and again on the container a package was
// restored into: a package written by hand would otherwise bring its secrets in.
//

/**
 * The `password` of a user restored from a package. Not a bcrypt hash, so no password matches
 * it, and the column stays `NOT NULL`.
 */
export const RESTORED_PASSWORD = '!package: no password, reset it'

// A user's `external_id` stays: external identities and the access log point at it. An integration
// token's is renewed by the restore, through the same operation as a reissue.
const CREDENTIALS: Record<string, Record<string, string>> = {
  user: {
    password: `'${RESTORED_PASSWORD}'`,
    mfa_enabled: 'false',
    mfa_secret: 'null',
    mfa_type: 'null',
    mfa_last_used_counter: 'null',
    reset_password_token: 'null',
    reset_password_token_at: 'null',
    confirmation_token: 'null'
  }
}

/** Tables whose rows are live credentials, and nothing else. */
const EMPTIED = ['session', 'auth_flow']

/**
 * Empties the credentials of the container `handle` opens, whose tables sit in `schema`. Only the
 * tables and columns that are there: a container at an older version may lack some.
 */
export async function scrubCredentials(handle: PostgresHandle, schema: string): Promise<void> {
  const present = await handle.execute<{ table_name: string; column_name: string }>(
    sql`select table_name, column_name from information_schema.columns where table_schema = ${schema} and table_name in ('user', 'session', 'auth_flow')`
  )
  const rows = present.rows ?? []

  for (const [table, columns] of Object.entries(CREDENTIALS)) {
    const there = new Set(rows.filter((r) => r.table_name === table).map((r) => r.column_name))
    const set = Object.entries(columns)
      .filter(([name]) => there.has(name))
      .map(([name, value]) => `${escapeIdentifier(name)} = ${value}`)
    if (set.length) await handle.execute(sql.raw(`update ${escapeIdentifier(table)} set ${set.join(', ')}`))
  }

  for (const table of EMPTIED) {
    if (rows.some((r) => r.table_name === table)) await handle.execute(sql.raw(`delete from ${escapeIdentifier(table)}`))
  }
}

/**
 * Exact row counts of every base table in `schema`. Exact, not planner estimates: the preview of a
 * destruction shows them to an operator about to type a slug, and a package is checked against them.
 */
export async function countRows(handle: PostgresHandle, schema: string): Promise<Record<string, number>> {
  const tables = await handle.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = ${schema} and table_type = 'BASE TABLE' order by table_name`
  )
  const rowCounts: Record<string, number> = {}
  for (const row of tables.rows ?? []) {
    const counted = await handle.execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${escapeIdentifier(row.table_name)}`))
    rowCounts[row.table_name] = Number(counted.rows?.[0]?.n ?? 0)
  }
  return rowCounts
}

/** The first difference between two sets of counts, or null when they are the same tables with the same rows. */
export function countsDiffer(expected: Record<string, number>, actual: Record<string, number>): string | null {
  for (const table of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (expected[table] !== actual[table]) return `${table}: ${expected[table] ?? 'absent'} expected, ${actual[table] ?? 'absent'} found`
  }
  return null
}
