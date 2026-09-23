/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-5.2 and T-9.1: the control plane and a customer's container have different lives, so they
// have different sets — and each set exists in both dialects, because the SQL genuinely
// differs and translating it at apply time would put an unread statement in front of a
// customer's data.
//
// The interesting assertion is not that four folders exist. It is that the runner picks the
// set from WHAT IT IS MIGRATING and not from an argument a caller can get wrong, that what a
// tenant container receives contains nothing about the fleet it belongs to, and that the two
// dialects of a set stay the same schema written twice rather than two schemas nobody
// declared different.
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

const DIALECTS = ['pg', 'sqlite'] as const

const filesOf = (set: string, dialect: string) => {
  const dir = path.join(ROOT, 'lib/database/migrations', set, dialect)
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql'))
}

const sqlOf = (set: string, dialect: string) =>
  filesOf(set, dialect)
    .map((f) => fs.readFileSync(path.join(ROOT, 'lib/database/migrations', set, dialect, f), 'utf8'))
    .join('\n')

// Postgres quotes with `"`, SQLite with a backtick.
const tablesOf = (sql: string) =>
  [...sql.matchAll(/create\s+table\s+["`]?([a-z_][a-z0-9_]*)["`]?/gi)].map((m) => m[1].toLowerCase()).sort()

describe('migrations · two sets, not one (T-5.2)', () => {
  it('gives a tenant container the application tables and nothing about the platform', () => {
    // On every dialect: invariant 7 does not hold "on Postgres".
    for (const dialect of DIALECTS) {
      const tenant = tablesOf(sqlOf('tenant', dialect))
      expect(tenant).toEqual(['access_log', 'auth_flow', 'change', 'external_identity', 'migration', 'session', 'setting', 'token', 'user'])

      // Invariant 7 as a file list: outside the customer's container goes only what you could
      // publish, and the registry of every other customer is the clearest example of what you
      // could not.
      for (const platform of ['tenant', 'system_user', 'impersonation', 'destruction_request', 'identity_provider']) {
        expect(tenant).not.toContain(platform)
      }
    }
  })

  it('gives the control plane the platform tables AND the application ones', () => {
    for (const dialect of DIALECTS) {
      const control = tablesOf(sqlOf('control', dialect))
      for (const platform of ['tenant', 'system_user', 'impersonation', 'destruction_request', 'identity_provider']) {
        expect(control).toContain(platform)
      }
      // Not an oversight: with no `tenants` block the application data lives here, so the
      // control plane is also a container.
      for (const shared of ['user', 'token', 'change', 'migration', 'session', 'auth_flow', 'external_identity', 'access_log']) {
        expect(control).toContain(shared)
      }
    }
  })

  it('duplicates the shared tables instead of sharing a file', () => {
    const sets = migrationSets()
    for (const dialect of DIALECTS) {
      const control = loadSet(sets[`control:${dialect}`]).map((m) => m.name)
      const tenant = loadSet(sets[`tenant:${dialect}`]).map((m) => m.name)

      expect(control.length).toBeGreaterThan(0)
      expect(tenant.length).toBeGreaterThan(0)
      // No file belongs to both. A shared migration would make the two sets a naming
      // convention: one edit, and both a customer's container and the registry move together
      // whether or not that was the intent.
      expect(control.filter((name) => tenant.includes(name))).toEqual([])
    }
  })

  it('reads the framework folder first and the consumer one after', () => {
    const sets = migrationSets()
    for (const set of ['control', 'tenant'] as const) {
      for (const dialect of DIALECTS) {
        const [framework, consumer] = sets[`${set}:${dialect}`].folders
        expect(framework).toContain(path.join('lib', 'database', 'migrations', set, dialect))
        expect(consumer).toContain(path.join('migrations', set, dialect))
        // The framework owns the migrations of its own tables and nothing else; a consumer's
        // entities are the consumer's to move.
        expect(framework).not.toBe(consumer)
      }
    }
  })

  it('writes the same schema twice, not two schemas (T-9.1)', () => {
    // The two dialects of a set carry the SAME names, so a review pairs them up and a
    // migration added to one and forgotten on the other is caught here — not on the first
    // query against a table that was never created, in the one deployment shape that uses it.
    for (const set of ['control', 'tenant'] as const) {
      const [pg, sqlite] = DIALECTS.map((d) => filesOf(set, d).sort())
      expect(pg).toEqual(sqlite)
    }
  })

  it('writes each dialect in its own language, and not a translation of the other', () => {
    // If these ever converge, someone has started generating one from the other, and the SQL
    // a customer's database receives is no longer the SQL a reviewer read.
    const pg = sqlOf('tenant', 'pg')
    const sqlite = sqlOf('tenant', 'sqlite')

    expect(pg).toMatch(/timestamp with time zone/i)
    expect(pg).toMatch(/USING btree/i)
    expect(sqlite).not.toMatch(/timestamp with time zone/i)
    expect(sqlite).not.toMatch(/USING btree/i)
    // Epoch milliseconds in an integer: no local time ever reaches the database, which is the
    // guarantee timestamptz gives on the other side.
    expect(sqlite).toMatch(/unixepoch\(\) \* 1000/)
  })
})
