#!/usr/bin/env node
//
// T-5.2: the two migration sets stay two.
//
// The control plane and a customer's container have different lives. The control plane is
// migrated once and holds the registry, the platform identities and the impersonation log; a
// tenant container is migrated N times and holds none of that. Tables that live in both
// (`user`, `token`, `change`, `migration`) are declared in both sets and **duplicated**: the
// same file is never shared.
//
// That is true today because the generation entries say so, and this check exists because
// "true today" is how defect D-15 started. The two properties below are the ones that would
// fail silently if someone shared an entry, moved a folder, or added a control table to the
// tenant schema: nothing would break, and a customer's container would quietly gain a copy
// of the tenant registry, which is the shape D-01 needed to become a privilege escalation.
//
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const SETS = {
  control: path.join(ROOT, 'lib/database/migrations/control'),
  tenant: path.join(ROOT, 'lib/database/migrations/tenant')
}

// Tables of the platform. Nothing that describes the fleet belongs inside one of its members:
// that is invariant 7, "outside the customer's container goes only what you could publish".
const CONTROL_ONLY = ['tenant', 'system_user', 'impersonation', 'destruction_request']

const sqlOf = (dir) =>
  !existsSync(dir)
    ? []
    : readdirSync(dir)
        .filter((f) => f.endsWith('.sql'))
        .map((f) => ({ file: f, sql: readFileSync(path.join(dir, f), 'utf8') }))

const problems = []

// 1. Disjoint folders. A shared one would make "two sets" a naming convention.
if (SETS.control === SETS.tenant) problems.push('the two sets point at the same folder')

const control = sqlOf(SETS.control)
const tenant = sqlOf(SETS.tenant)

if (control.length === 0) problems.push('the control set has no migration: run `npm run db:generate`')
if (tenant.length === 0) problems.push('the tenant set has no migration: run `npm run db:generate:tenant`')

// 2. No file is shared by content: duplicated on purpose, not linked.
const byHash = new Map()
for (const [set, files] of [['control', control], ['tenant', tenant]]) {
  for (const { file } of files) {
    const key = `${set}/${file}`
    if (byHash.has(file)) problems.push(`${key}: a file name is reused across the sets, which makes the order ambiguous`)
    else byHash.set(file, key)
  }
}

// 3. The platform's tables exist in the control set and in NO tenant container.
const creates = (sql) => [...sql.matchAll(/create\s+table\s+"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase())

const controlTables = new Set(control.flatMap(({ sql }) => creates(sql)))
const tenantTables = new Set(tenant.flatMap(({ sql }) => creates(sql)))

for (const table of CONTROL_ONLY) {
  if (!controlTables.has(table)) problems.push(`the control set does not create '${table}'`)
  if (tenantTables.has(table)) problems.push(`the tenant set creates '${table}', which belongs to the platform alone`)
}

// 4. The tables a container needs are in both, duplicated.
for (const table of ['user', 'token', 'change', 'migration']) {
  if (!controlTables.has(table)) problems.push(`the control set does not create '${table}'`)
  if (!tenantTables.has(table)) problems.push(`the tenant set does not create '${table}'`)
}

if (problems.length) {
  console.error('✖ the migration sets are not two (T-5.2):\n')
  for (const p of problems) console.error('  ' + p)
  console.error('')
  process.exit(1)
}
console.log(`✔ two migration sets: control (${control.length} file(s)), tenant (${tenant.length} file(s))`)
