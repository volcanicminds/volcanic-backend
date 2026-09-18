#!/usr/bin/env node
//
// T-5.2 and T-9.1: the two sets stay two, and each of them exists in both dialects.
//
// The control plane and a customer's container have different lives. The control plane is
// migrated once and holds the registry, the platform identities and the impersonation log; a
// tenant container is migrated N times and holds none of that. Tables that live in both
// (`user`, `token`, `change`, `migration`) are declared in both sets and **duplicated**: the
// same file is never shared.
//
// That is true today because the generation entries say so, and this check exists because
// "true today" is how defect D-15 started. The properties below are the ones that would fail
// silently if someone shared an entry, moved a folder, or added a control table to the tenant
// schema: nothing would break, and a customer's container would quietly gain a copy of the
// tenant registry, which is the shape D-01 needed to become a privilege escalation.
//
// The dialect parity is the T-9.1 half, and it fails a different way: a migration added to
// Postgres and forgotten on SQLite breaks nothing at all until someone deploys the serverless
// combination the capability matrix says is supported, and then it breaks on the first query
// against a table that was never created.
//
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SETS = ['control', 'tenant']
const DIALECTS = ['pg', 'sqlite']

const dirOf = (set, dialect) => path.join(ROOT, 'lib/database/migrations', set, dialect)

// Tables of the platform. Nothing that describes the fleet belongs inside one of its members:
// that is invariant 7, "outside the customer's container goes only what you could publish".
const CONTROL_ONLY = ['tenant', 'system_user', 'impersonation', 'destruction_request']
const SHARED = ['user', 'token', 'change', 'migration', 'session']

const sqlOf = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => ({ file: f, name: f.slice(0, -4), sql: readFileSync(path.join(dir, f), 'utf8') }))

// Postgres quotes an identifier with `"`, SQLite with a backtick, and drizzle-kit emits
// whichever the dialect uses. Both, plus the unquoted form.
const creates = (sql) =>
  [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-z_][a-z0-9_]*)["`]?/gi)].map((m) =>
    m[1].toLowerCase()
  )

const problems = []
const files = {}
const counts = []

for (const set of SETS) {
  for (const dialect of DIALECTS) {
    const dir = dirOf(set, dialect)
    const found = sqlOf(dir)
    files[`${set}:${dialect}`] = found

    // 1. Every combination exists. An empty one is not "nothing to do": it is an engine the
    //    framework can open and cannot prepare.
    if (found.length === 0) {
      problems.push(
        `the ${set}/${dialect} set has no migration: run \`npm run db:generate${set === 'tenant' ? ':tenant' : ''}${dialect === 'sqlite' ? ':sqlite' : ''}\``
      )
      continue
    }
    counts.push(`${set}/${dialect} (${found.length})`)

    // 2. The platform's tables exist in the control set and in NO tenant container.
    const tables = new Set(found.flatMap(({ sql }) => creates(sql)))
    for (const table of CONTROL_ONLY) {
      if (set === 'control' && !tables.has(table)) problems.push(`${set}/${dialect} does not create '${table}'`)
      if (set === 'tenant' && tables.has(table)) {
        problems.push(`${set}/${dialect} creates '${table}', which belongs to the platform alone`)
      }
    }
    // 3. The tables a container needs are in both sets, duplicated.
    for (const table of SHARED) {
      if (!tables.has(table)) problems.push(`${set}/${dialect} does not create '${table}'`)
    }
  }
}

// 4. The two dialects of a set carry the SAME migration names, in the same order. Names are
//    what the `migration` table records and what a review pairs up: two sets that drift apart
//    in naming are two schemas nobody declared different.
for (const set of SETS) {
  const [pg, sqlite] = DIALECTS.map((d) => (files[`${set}:${d}`] ?? []).map((f) => f.name).sort())
  if (pg.length && sqlite.length && JSON.stringify(pg) !== JSON.stringify(sqlite)) {
    const onlyPg = pg.filter((n) => !sqlite.includes(n))
    const onlySqlite = sqlite.filter((n) => !pg.includes(n))
    if (onlyPg.length) problems.push(`${set}: ${onlyPg.join(', ')} exists for pg and not for sqlite`)
    if (onlySqlite.length) problems.push(`${set}: ${onlySqlite.join(', ')} exists for sqlite and not for pg`)
  }
}

// 5. No file name is reused across the two SETS: it would make the order ambiguous.
for (const dialect of DIALECTS) {
  const control = (files[`control:${dialect}`] ?? []).map((f) => f.name)
  const tenant = (files[`tenant:${dialect}`] ?? []).map((f) => f.name)
  const shared = control.filter((n) => tenant.includes(n))
  if (shared.length) problems.push(`${dialect}: ${shared.join(', ')} is used by both sets, which makes the order ambiguous`)
}

if (problems.length) {
  console.error('✖ the migration sets are not what they must be (T-5.2, T-9.1):\n')
  for (const p of problems) console.error('  ' + p)
  console.error('')
  process.exit(1)
}
console.log(`✔ four migration sets: ${counts.join(', ')}`)
