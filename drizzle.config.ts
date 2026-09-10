import type { Config } from 'drizzle-kit'

//
// How migrations are written (T-5.1, extended per dialect in T-9.1).
//
// `drizzle-kit generate` emits plain SQL that gets committed and reviewed. Not a generated
// class to interpret at boot, not a JSON description of a change: what runs against a
// customer's database is what a reviewer reads, in the language the database speaks.
//
// Forward only. `drizzle-kit` generates no `down`, and that is the right shape: a `down` on
// a destructive migration restores the form and not the data, which is a promise that fails
// exactly when it is called on. Reversibility lives in the release discipline
// (expand/contract, see the README), not in a script that lies about it.
//
// Two sets, because the control plane and a customer's container have different lives
// (T-5.2). Two dialects, because the SQL genuinely differs — a timestamptz against an integer
// of epoch milliseconds, a boolean against 0/1, an array against JSON text — and translating
// one into the other at apply time would put a statement nobody has read in front of a
// customer's database. `MIGRATION_SET` and `MIGRATION_DIALECT` pick one of the four; the npm
// scripts pass both.
//
const sets = ['control', 'tenant'] as const
const dialects = { pg: 'postgresql', sqlite: 'sqlite' } as const

type SetName = (typeof sets)[number]
type DialectName = keyof typeof dialects

const set = (process.env.MIGRATION_SET || 'control') as SetName
const dialect = (process.env.MIGRATION_DIALECT || 'pg') as DialectName

if (!sets.includes(set)) {
  throw new Error(`MIGRATION_SET must be one of: ${sets.join(', ')}`)
}
if (!dialects[dialect]) {
  throw new Error(`MIGRATION_DIALECT must be one of: ${Object.keys(dialects).join(', ')}`)
}

export default {
  schema: `./lib/database/schema/entry/${set}.${dialect}.ts`,
  out: `./lib/database/migrations/${set}/${dialect}`,
  dialect: dialects[dialect],
  // The generated SQL never names a schema: the runner puts the statements inside the
  // container it is migrating, with SET LOCAL inside a transaction (T-3.1).
  breakpoints: true,
  strict: true,
  verbose: true
} satisfies Config
