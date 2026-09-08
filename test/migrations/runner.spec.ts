/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-5.1: the migration engine, against a real Postgres.
//
// What is worth testing here is not "the SQL runs" but the four properties that make a fleet
// of containers survivable: the same unqualified file lands in a different schema each time,
// a failure halfway leaves the successful part applied so the next run resumes, an edited
// migration is caught instead of silently skipped, and nothing is left on the connection
// afterwards. The last one is T-3.1's rule, and migrations are the one path allowed to name
// a schema at all.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { PostgresProvider } from '../../lib/database/adapters/postgres/index.js'
import { createMigrationRunner, loadSet, MigrationMismatchError } from '../../lib/database/migrations/runner.js'
import { readMigrations, statementsOf } from '../../lib/database/migrations/files.js'

;(global as any).log = {}

const URL = process.env.DATABASE_URL
const suite = URL ? describe : describe.skip

/** A migration set on disk, written per test so the content is visible next to the assertion. */
function folderWith(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-migrations-'))
  for (const [name, sqlText] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), sqlText)
  }
  return dir
}

describe('migrations · the format (T-5.1)', () => {
  it('orders by file name, and carries a checksum', () => {
    const dir = folderWith({
      '0001_first.sql': 'create table a (id text);',
      '0000_zeroth.sql': 'create table b (id text);',
      'notes.md': 'ignored'
    })
    const files = readMigrations(dir)

    // The order is the directory, not an index file that can disagree with it.
    expect(files.map((f) => f.name)).toEqual(['0000_zeroth', '0001_first'])
    expect(files[0].hash).toMatch(/^[0-9a-f]{64}$/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('splits on the breakpoint drizzle-kit writes, and tolerates a file without one', () => {
    const dir = folderWith({
      '0000_two.sql': 'create table a (id text);\n--> statement-breakpoint\ncreate table b (id text);\n',
      '0001_one.sql': 'create table c (id text);'
    })
    const [two, one] = readMigrations(dir)
    expect(statementsOf(two).length).toBe(2)
    expect(statementsOf(one).length).toBe(1)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('does not read an unreachable database as an empty one', async () => {
    const dir = folderWith({ '0000_init.sql': 'select 1;' })
    const unreachable = createMigrationRunner(
      async () => ({
        handle: {
          execute: async () => {
            throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:55432'), { code: 'ECONNREFUSED' })
          },
          transaction: async () => undefined
        },
        locator: 'public',
        dialect: 'postgres' as const
      }),
      { control: { name: 'control', folders: [dir] }, tenant: { name: 'tenant', folders: [dir] } }
    )

    // The dangerous shape a migration tool can take is telling a system that HAS migrated
    // that it has not. Only "the table does not exist yet" is an answer; everything else is
    // a failure and travels as one.
    await expect(unreachable.pending({ locator: 'public' })).rejects.toThrow(/ECONNREFUSED/)
    await expect(unreachable.version({ locator: 'public' })).rejects.toThrow(/ECONNREFUSED/)
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('refuses two migrations with the same name across folders', () => {
    const a = folderWith({ '0000_init.sql': 'select 1;' })
    const b = folderWith({ '0000_init.sql': 'select 2;' })
    // A consumer shadowing a framework migration would be silent, and one of the two would
    // never run.
    expect(() => loadSet({ name: 'control', folders: [a, b] })).toThrow(/Duplicate migration/)
    fs.rmSync(a, { recursive: true, force: true })
    fs.rmSync(b, { recursive: true, force: true })
  })
})

suite('migrations · applying a set (T-5.1)', function () {
  this.timeout(30000)

  let provider: PostgresProvider
  const ACME = 'test_mig_acme'
  const GLOBEX = 'test_mig_globex'
  let dir: string

  const SET = () => ({ control: { name: 'control', folders: [dir] }, tenant: { name: 'tenant', folders: [dir] } })

  const runnerOn = () =>
    createMigrationRunner(async (container) => {
      const handle: any = container.tenantId
        ? provider.forLocator(container.locator, container.tenantId)
        : provider.control()
      return { handle, locator: container.locator, dialect: 'postgres' as const }
    }, SET())

  before(async () => {
    provider = new PostgresProvider({ url: URL, schema: 'public', poolMax: 1 })
    for (const schema of [ACME, GLOBEX]) {
      await provider.dropSchema(schema)
      await provider.createSchema(schema)
    }
    dir = folderWith({
      '0000_init.sql':
        'CREATE TABLE "migration" ("id" text PRIMARY KEY NOT NULL, "set" text NOT NULL, "name" text NOT NULL, "hash" text NOT NULL, "applied_at" timestamp with time zone DEFAULT now() NOT NULL);\n' +
        '--> statement-breakpoint\n' +
        'CREATE TABLE "widget" ("id" text PRIMARY KEY NOT NULL, "tag" text);',
      '0001_add_note.sql': 'ALTER TABLE "widget" ADD COLUMN "note" text;'
    })
  })

  after(async () => {
    await provider.dropSchema(ACME)
    await provider.dropSchema(GLOBEX)
    await provider.shutdown()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('puts the same unqualified file into a different container each time', async () => {
    const runner = runnerOn()
    expect((await runner.pending({ tenantId: 'a', locator: ACME })).map((m) => m.name)).toEqual([
      '0000_init',
      '0001_add_note'
    ])

    expect(await runner.apply({ tenantId: 'a', locator: ACME })).toBe('0001_add_note')
    expect(await runner.apply({ tenantId: 'b', locator: GLOBEX })).toBe('0001_add_note')

    const control: any = provider.control()
    // Two schemas, one set of files, and neither container knows about the other.
    for (const schema of [ACME, GLOBEX]) {
      const cols: any = await control.execute(
        sql.raw(`select column_name from information_schema.columns where table_schema = '${schema}' and table_name = 'widget'`)
      )
      expect(cols.rows.map((r: any) => r.column_name).sort()).toEqual(['id', 'note', 'tag'])
    }
  })

  it('leaves nothing on the connection, though it is the one path allowed to name a schema', async () => {
    const control: any = provider.control()
    // The SET LOCAL of the migration is undone by its own commit, by definition of the
    // statement. This is what T-3.1 kept the door open for, and it is still closed behind it.
    const path$ = await control.execute(sql`select current_setting('search_path') as sp`)
    expect(path$.rows[0].sp).toBe('public')
  })

  it('records what it applied, inside the container', async () => {
    const runner = runnerOn()
    expect(await runner.version({ tenantId: 'a', locator: ACME })).toBe('0001_add_note')

    const control: any = provider.control()
    const rows: any = await control.execute(sql.raw(`select "set", "name" from "${ACME}".migration order by name`))
    expect(rows.rows.map((r: any) => r.name)).toEqual(['0000_init', '0001_add_note'])
    expect(rows.rows.every((r: any) => r.set === 'tenant')).toBe(true)
  })

  it('is a no-op the second time, and resumable rather than repeated', async () => {
    const runner = runnerOn()
    expect(await runner.pending({ tenantId: 'a', locator: ACME })).toEqual([])
    // Applying twice would fail on the CREATE TABLE if the record had not been written in
    // the same transaction as the change.
    expect(await runner.apply({ tenantId: 'a', locator: ACME })).toBe('0001_add_note')
  })

  it('stops at the version it was asked for', async () => {
    const THIRD = 'test_mig_third'
    await provider.dropSchema(THIRD)
    await provider.createSchema(THIRD)

    const runner = runnerOn()
    expect(await runner.apply({ tenantId: 'c', locator: THIRD }, '0000_init')).toBe('0000_init')
    expect((await runner.pending({ tenantId: 'c', locator: THIRD })).map((m) => m.name)).toEqual(['0001_add_note'])
    await provider.dropSchema(THIRD)
  })

  it('refuses a migration that changed after it ran', async () => {
    fs.writeFileSync(path.join(dir, '0001_add_note.sql'), 'ALTER TABLE "widget" ADD COLUMN "other" text;')
    const runner = runnerOn()

    // The container and the repository disagree about what happened. Skipping it would leave
    // a schema nobody can reason about; the answer is to stop.
    await expect(runner.pending({ tenantId: 'a', locator: ACME })).rejects.toThrow(MigrationMismatchError)
    fs.writeFileSync(path.join(dir, '0001_add_note.sql'), 'ALTER TABLE "widget" ADD COLUMN "note" text;')
  })

  it('leaves the successful part applied when one migration fails', async () => {
    const BROKEN = 'test_mig_broken'
    await provider.dropSchema(BROKEN)
    await provider.createSchema(BROKEN)

    const broken = folderWith({
      '0000_init.sql':
        'CREATE TABLE "migration" ("id" text PRIMARY KEY NOT NULL, "set" text NOT NULL, "name" text NOT NULL, "hash" text NOT NULL, "applied_at" timestamp with time zone DEFAULT now() NOT NULL);\n' +
        '--> statement-breakpoint\n' +
        'CREATE TABLE "widget" ("id" text PRIMARY KEY NOT NULL);',
      '0001_bad.sql': 'ALTER TABLE "nothing_here" ADD COLUMN "x" text;'
    })

    const runner = createMigrationRunner(
      async (container) => ({
        handle: provider.forLocator(container.locator, container.tenantId as string),
        locator: container.locator,
        dialect: 'postgres' as const
      }),
      { tenant: { name: 'tenant', folders: [broken] }, control: { name: 'control', folders: [broken] } }
    )

    await expect(runner.apply({ tenantId: 'x', locator: BROKEN })).rejects.toThrow()
    // One transaction per migration, not one for the set: on a fleet of a thousand
    // containers, "start over" means "never finish".
    expect(await runner.version({ tenantId: 'x', locator: BROKEN })).toBe('0000_init')

    await provider.dropSchema(BROKEN)
    fs.rmSync(broken, { recursive: true, force: true })
  })
})
