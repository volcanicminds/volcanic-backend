/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-5.2: the control plane and a customer's container have different lives, so they have
// different sets.
//
// The interesting assertion is not that two folders exist. It is that the runner picks the
// set from WHAT IT IS MIGRATING and not from an argument a caller can get wrong, and that
// what a tenant container receives contains nothing about the fleet it belongs to.
//
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { expect } from 'expect'
import { loadSet } from '../../lib/database/migrations/runner.js'
import { migrationSets } from '../../db.js'

;(global as any).log = {}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')

const sqlOf = (set: string) => {
  const dir = path.join(ROOT, 'lib/database/migrations', set)
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
    .join('\n')
}

const tablesOf = (sql: string) =>
  [...sql.matchAll(/create\s+table\s+"?([a-z_][a-z0-9_]*)"?/gi)].map((m) => m[1].toLowerCase()).sort()

describe('migrations · two sets, not one (T-5.2)', () => {
  it('gives a tenant container the application tables and nothing about the platform', () => {
    const tenant = tablesOf(sqlOf('tenant'))
    expect(tenant).toEqual(['change', 'migration', 'token', 'user'])

    // Invariant 7 as a file list: outside the customer's container goes only what you could
    // publish, and the registry of every other customer is the clearest example of what you
    // could not.
    for (const platform of ['tenant', 'system_user', 'impersonation', 'destruction_request']) {
      expect(tenant).not.toContain(platform)
    }
  })

  it('gives the control plane the platform tables AND the application ones', () => {
    const control = tablesOf(sqlOf('control'))
    for (const platform of ['tenant', 'system_user', 'impersonation', 'destruction_request']) {
      expect(control).toContain(platform)
    }
    // Not an oversight: with no `tenants` block the application data lives here, so the
    // control plane is also a container.
    for (const shared of ['user', 'token', 'change', 'migration']) {
      expect(control).toContain(shared)
    }
  })

  it('duplicates the shared tables instead of sharing a file', () => {
    const sets = migrationSets()
    const control = loadSet(sets.control).map((m) => m.name)
    const tenant = loadSet(sets.tenant).map((m) => m.name)

    expect(control.length).toBeGreaterThan(0)
    expect(tenant.length).toBeGreaterThan(0)
    // No file belongs to both. A shared migration would make the two sets a naming
    // convention: one edit, and both a customer's container and the registry move together
    // whether or not that was the intent.
    expect(control.filter((name) => tenant.includes(name))).toEqual([])
  })

  it('reads the framework folder first and the consumer one after', () => {
    const sets = migrationSets()
    for (const set of ['control', 'tenant'] as const) {
      const [framework, consumer] = sets[set].folders
      expect(framework).toContain(path.join('lib', 'database', 'migrations', set))
      expect(consumer).toContain(path.join('migrations', set))
      // The framework owns the migrations of its own tables and nothing else; a consumer's
      // entities are the consumer's to move.
      expect(framework).not.toBe(consumer)
    }
  })
})
