import type { Config } from 'drizzle-kit'

//
// How migrations are written (T-5.1).
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
// (T-5.2). `MIGRATION_SET` picks one; the npm scripts pass it.
//
const sets = {
  control: { schema: './lib/database/schema/entry/control.pg.ts', out: './lib/database/migrations/control' },
  tenant: { schema: './lib/database/schema/entry/tenant.pg.ts', out: './lib/database/migrations/tenant' }
} as const

const chosen = sets[(process.env.MIGRATION_SET as keyof typeof sets) || 'control']
if (!chosen) {
  throw new Error(`MIGRATION_SET must be one of: ${Object.keys(sets).join(', ')}`)
}

export default {
  ...chosen,
  dialect: 'postgresql',
  // The generated SQL never names a schema: the runner puts the statements inside the
  // container it is migrating, with SET LOCAL inside a transaction (T-3.1).
  breakpoints: true,
  strict: true,
  verbose: true
} satisfies Config
