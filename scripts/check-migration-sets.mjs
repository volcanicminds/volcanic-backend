#!/usr/bin/env node
//
// T-5.2: the two sets stay two.
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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SETS = ['control', 'tenant']

const dirOf = (set) => path.join(ROOT, 'lib/database/migrations', set, 'pg')

// Tables of the platform. Nothing that describes the fleet belongs inside one of its members:
// that is invariant 7, "outside the customer's container goes only what you could publish".
const CONTROL_ONLY = ['tenant', 'system_user', 'impersonation', 'destruction_request', 'identity_provider', 'governance_log']
const SHARED = ['user', 'token', 'change', 'migration', 'session', 'auth_flow', 'external_identity', 'access_log']

const sqlOf = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => ({ file: f, name: f.slice(0, -4), sql: readFileSync(path.join(dir, f), 'utf8') }))

// drizzle-kit quotes an identifier with `"`; the unquoted form is matched too.
const creates = (sql) =>
  [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase())

const problems = []
const files = {}
const counts = []

for (const set of SETS) {
  const found = sqlOf(dirOf(set))
  files[set] = found

  // 1. Every set exists. An empty one is not "nothing to do": it is a container the framework
  //    can open and cannot prepare.
  if (found.length === 0) {
    problems.push(`the ${set} set has no migration: run \`npm run db:generate${set === 'tenant' ? ':tenant' : ''}\``)
    continue
  }
  counts.push(`${set} (${found.length})`)

  // 2. The platform's tables exist in the control set and in NO tenant container.
  const tables = new Set(found.flatMap(({ sql }) => creates(sql)))
  for (const table of CONTROL_ONLY) {
    if (set === 'control' && !tables.has(table)) problems.push(`${set} does not create '${table}'`)
    if (set === 'tenant' && tables.has(table)) problems.push(`${set} creates '${table}', which belongs to the platform alone`)
  }
  // 3. The tables a container needs are in both sets, duplicated.
  for (const table of SHARED) {
    if (!tables.has(table)) problems.push(`${set} does not create '${table}'`)
  }
}

// 4. No file name is reused across the two sets: it would make the order ambiguous.
const control = (files.control ?? []).map((f) => f.name)
const shared = control.filter((n) => (files.tenant ?? []).some((f) => f.name === n))
if (shared.length) problems.push(`${shared.join(', ')} is used by both sets, which makes the order ambiguous`)

if (problems.length) {
  console.error('✖ the migration sets are not what they must be (T-5.2):\n')
  for (const p of problems) console.error('  ' + p)
  console.error('')
  process.exit(1)
}
console.log(`✔ two migration sets: ${counts.join(', ')}`)
