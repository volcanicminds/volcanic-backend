import { eq, sql, type Column, type Table } from 'drizzle-orm'
import type { UntypedDb } from './managers/runtime.js'

//
// Prepared statements on the paths every request walks.
//
// Drizzle builds the SQL of a query each time it runs it; a prepared query keeps the text and
// takes only the parameters. Kept per DATABASE and per TABLE OBJECT: under the `schema` strategy
// a tenant is a set of table objects with its schema printed into the SQL, so one statement per
// container is the correct granularity, and a container the provider evicts takes its
// statements with it (both maps are weak).
//
// UNNAMED, always: a named statement lives on the server connection, and the connection must go
// back to the pool as it came out. The empty name keeps the parse on the server and
// saves the builder in Node, which is where the measured cost was (docs/TUNING.md).
//
// Only where a bench measured the gain: the lookups of `scripts/bench-paths.ts`, and the list
// queries of `executeFind` and `executeCount` (docs/TUNING.md). Preparing every query would add
// statements without adding speed.
//
// BOUNDED per table: the key of a list query is the shape the client wrote (its filters, sort
// and fields), so a client can make up as many keys as it likes. Past the bound the statement
// used least recently goes; it is rebuilt if its shape comes back.
//

type Prepared = { execute(values?: Record<string, unknown>): Promise<unknown[]> }
type Buildable = { prepare(name: string): Prepared }

export const MAX_STATEMENTS_PER_TABLE = 256

const statements = new WeakMap<object, WeakMap<Table, Map<string, Prepared>>>()

/** The statement `build` describes, built once for this database and this table. */
export function prepared(db: object, table: Table, key: string, build: () => Buildable): Prepared {
  let byTable = statements.get(db)
  if (!byTable) statements.set(db, (byTable = new WeakMap()))
  let byKey = byTable.get(table)
  if (!byKey) byTable.set(table, (byKey = new Map()))
  let statement = byKey.get(key)
  if (statement) {
    // A Map iterates in insertion order: moving a hit to the end keeps the first key the oldest.
    byKey.delete(key)
  } else {
    statement = build().prepare('')
    if (byKey.size >= MAX_STATEMENTS_PER_TABLE) byKey.delete(byKey.keys().next().value!)
  }
  byKey.set(key, statement)
  return statement
}

/** How many statements are kept for this database and this table: for the tests of the bound. */
export function preparedCount(db: object, table: Table): number {
  return statements.get(db)?.get(table)?.size ?? 0
}

/** The first row of `table` whose `field` equals `value`, or null. */
export async function firstBy<Row = Record<string, unknown>>(
  db: UntypedDb,
  table: Table,
  field: string,
  value: unknown
): Promise<Row | null> {
  const statement = prepared(db, table, `firstBy:${field}`, () =>
    db
      .select()
      .from(table)
      .where(eq((table as unknown as Record<string, Column>)[field], sql.placeholder('value')))
      .limit(1)
  )
  const rows = await statement.execute({ value })
  return (rows[0] as Row) ?? null
}
