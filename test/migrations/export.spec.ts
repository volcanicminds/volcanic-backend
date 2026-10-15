/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Moving a container's SQL into a package and back.
//
// The failure this must never have is the plausible one: a dump that exists, opens cleanly, and
// carries a credential, a line `psql` runs on the machine, or fewer rows than it claims. So the
// assertions are the refusals and the scrub, on the reader alone and then on a real server.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Readable } from 'stream'
import { expect } from 'expect'
import { loadFrom, PACKAGE_SCHEMA, rebase, requireTools } from '../../lib/database/containers/export.js'
import { countsDiffer, RESTORED_PASSWORD } from '../../lib/database/containers/scrub.js'

;(global as any).log = {}

const URL = process.env.DATABASE_URL
const suite = URL ? describe : describe.skip

/** What `rebase` makes of `text`, fed in chunks of `size` bytes so a line or a character may be cut. */
async function through(text: string, from: string | null, to: string | null, size = 7): Promise<string> {
  const bytes = Buffer.from(text)
  const chunks: Buffer[] = []
  for (let i = 0; i < bytes.length; i += size) chunks.push(bytes.subarray(i, i + size))
  let out = ''
  for await (const chunk of Readable.from(chunks).pipe(rebase(from, to))) out += String(chunk)
  return out
}

/** The machine `code` of a rejection: what travels in the response body and what a client branches on. */
const codeOfRejection = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e: any) {
    return e?.code ?? 'NO_CODE'
  }
  return 'NO_ERROR'
}

describe('export · the reader every dump goes through (T-17.1)', () => {
  it('renames the schema, bare and quoted, and leaves the rows untouched', async () => {
    const dump = [
      'CREATE SCHEMA tenant_acme;',
      'CREATE TABLE tenant_acme.widget (id text, tenant_acme_ref text);',
      'CREATE TABLE "tenant_acme"."gadget" (id text);',
      'COPY tenant_acme.widget (id, tenant_acme_ref) FROM stdin;',
      'w1\ttenant_acme is a value, and so is \\copy',
      '\\.',
      'ALTER TABLE ONLY tenant_acme.widget ADD CONSTRAINT widget_pkey PRIMARY KEY (id);',
      ''
    ].join('\n')
    const out = await through(dump, 'tenant_acme', PACKAGE_SCHEMA)
    expect(out.split('\n')).toEqual([
      `CREATE SCHEMA IF NOT EXISTS "${PACKAGE_SCHEMA}";`,
      // A column that only starts with the name is another identifier.
      `CREATE TABLE "${PACKAGE_SCHEMA}".widget (id text, tenant_acme_ref text);`,
      `CREATE TABLE "${PACKAGE_SCHEMA}"."gadget" (id text);`,
      `COPY "${PACKAGE_SCHEMA}".widget (id, tenant_acme_ref) FROM stdin;`,
      'w1\ttenant_acme is a value, and so is \\copy',
      '\\.',
      `ALTER TABLE ONLY "${PACKAGE_SCHEMA}".widget ADD CONSTRAINT widget_pkey PRIMARY KEY (id);`,
      ''
    ])
  })

  it('refuses a meta-command outside the data with RESTORE_INTEGRITY_FAILED, and keeps the two pg_dump writes', async () => {
    const kept = await through('\\restrict abc123\nselect 1;\n\\unrestrict abc123\n', null, null)
    expect(kept).toBe('\\restrict abc123\nselect 1;\n\\unrestrict abc123\n')

    for (const line of ['\\! touch /tmp/owned', '\\copy x from program \'id\'', '\\restrict abc; \\! id', '\\i /etc/passwd']) {
      expect(await codeOfRejection(through(`select 1;\n${line}\nselect 2;\n`, null, null))).toBe('RESTORE_INTEGRITY_FAILED')
    }
  })

  it('reads a character cut between two chunks as one character', async () => {
    const text = "COPY t (v) FROM stdin;\nè più così\n\\.\nselect 'perché';\n"
    for (const size of [1, 2, 3, 5]) expect(await through(text, null, null, size)).toBe(text)
  })

  it('tells two sets of counts apart by the first table that differs', () => {
    expect(countsDiffer({ user: 2, token: 1 }, { token: 1, user: 2 })).toBeNull()
    expect(countsDiffer({ user: 2 }, { user: 1 })).toBe('user: 2 expected, 1 found')
    expect(countsDiffer({ user: 2 }, { user: 2, extra: 0 })).toBe('extra: absent expected, 0 found')
  })
})

describe('export · the refusals, without a server (T-17.1)', () => {
  it('refuses with EXPORT_TOOL_MISSING when the client is not there', async () => {
    // An empty PATH is a machine without the client: the export fails instead of becoming a smaller one.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-export-path-'))
    const saved = process.env.PATH
    process.env.PATH = empty
    try {
      expect(await codeOfRejection(requireTools('pg_dump', 'psql'))).toBe('EXPORT_TOOL_MISSING')
    } finally {
      process.env.PATH = saved
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('fails with EXPORT_FAILED when psql cannot reach the server', async function () {
    // Nothing listens on port 1: psql starts, fails, and exits non-zero.
    const code = await codeOfRejection(loadFrom('postgres://nobody@127.0.0.1:1/none', Readable.from(['select 1;\n']), rebase(null, null)))
    if (code === 'EXPORT_TOOL_MISSING') return this.skip()
    expect(code).toBe('EXPORT_FAILED')
  })
})

suite('export · a Postgres container, out and back (T-17.1, T-17.4)', function () {
  this.timeout(60000)

  const SOURCE = 'test_export_acme'
  const RESTORED = 'test_export_acme_back'
  const BAD = 'test_export_bad'
  const HASH = '$2b$10$abcdefghijklmnopqrstuuJ1yJ0q2XcZ0k7l9mN3oP5qR7sT9vW1y'
  let dir: string
  let provider: any
  let tools = true

  before(async function () {
    try {
      await requireTools('pg_dump', 'psql')
    } catch {
      tools = false
      return this.skip()
    }
    const { PostgresProvider } = await import('../../lib/database/adapters/postgres/index.js')
    provider = new PostgresProvider({ url: URL, schema: 'public', poolMax: 2 })
    for (const locator of [SOURCE, RESTORED, BAD]) await provider.dropSchema(locator)
    await provider.createSchema(SOURCE)

    const handle: any = await provider.forLocator(SOURCE, SOURCE)
    await handle.execute(`create table "user" (
      id text primary key, email text not null, password text not null, external_id text not null,
      mfa_enabled boolean not null default false, mfa_secret text, reset_password_token text,
      is_founder boolean not null default false, deleted_at timestamptz, created_at timestamptz not null default now())`)
    await handle.execute('create table session (id text primary key, user_id text)')
    await handle.execute('create table token (id text primary key, external_id text not null)')
    await handle.execute('create table widget (id text primary key, tag text)')
    await handle.execute(`insert into "user" (id, email, password, external_id, mfa_enabled, mfa_secret, reset_password_token, is_founder) values
      ('u-founder', 'founder@acme.test', '${HASH}', 'ext-founder', true, 'ENCRYPTED-TOTP-SECRET', 'RESET-ME', true),
      ('u-member', 'member@acme.test', '${HASH}', 'ext-member', false, null, null, false)`)
    await handle.execute("insert into session (id, user_id) values ('s1', 'u-founder')")
    await handle.execute("insert into token (id, external_id) values ('tok-1', 'ext-token')")
    await handle.execute("insert into widget (id, tag) values ('w1', 'ACME PRIVATE ROW')")

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-export-pg-'))
  })

  after(async () => {
    if (!tools) return
    for (const locator of [SOURCE, RESTORED, BAD]) await provider.dropSchema(locator)
    await provider.shutdown()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  let dump: any
  it('writes a dump with the rows, without a credential, and without the name of the container', async () => {
    dump = await provider.exportContainer({ id: 'id-acme', slug: 'acme', locator: SOURCE }, { target: path.join(dir, 'tenant.sql'), schemaVersion: '0001_init' })
    expect(dump).toMatchObject({ schemaVersion: '0001_init', schema: PACKAGE_SCHEMA, rowCounts: { user: 2, session: 0, token: 1, widget: 1 } })

    const text = fs.readFileSync(dump.path, 'utf8')
    expect(text).toContain('ACME PRIVATE ROW')
    expect(text).toContain(RESTORED_PASSWORD)
    for (const secret of [HASH, 'ENCRYPTED-TOTP-SECRET', 'RESET-ME', SOURCE, 'vm_scratch_']) expect(text).not.toContain(secret)
    // The external identities and the access log point at a user's external_id: it travels.
    expect(text).toContain('ext-founder')
    // No scratch container outlives the export.
    const left = await provider.db.execute("select nspname from pg_namespace where nspname like 'vm_scratch_%'")
    expect(left.rows).toEqual([])
  })

  it('restores the dump into a new container, scrubbed again, and names what the caller renews', async () => {
    const renew = await provider.restoreContainer(RESTORED, { dump: dump.path, schema: dump.schema, rowCounts: dump.rowCounts })
    expect(renew).toEqual({ tokenIds: ['tok-1'], founderId: 'u-founder' })

    const handle: any = await provider.forLocator(RESTORED, RESTORED)
    const users = await handle.execute('select id, password, external_id, mfa_enabled, mfa_secret from "user" order by id')
    expect(users.rows).toEqual([
      { id: 'u-founder', password: RESTORED_PASSWORD, external_id: 'ext-founder', mfa_enabled: false, mfa_secret: null },
      { id: 'u-member', password: RESTORED_PASSWORD, external_id: 'ext-member', mfa_enabled: false, mfa_secret: null }
    ])
    expect((await handle.execute('select tag from widget')).rows).toEqual([{ tag: 'ACME PRIVATE ROW' }])
  })

  it('answers null, having touched nothing, when the container is already there', async () => {
    expect(await provider.restoreContainer(RESTORED, { dump: dump.path, schema: dump.schema, rowCounts: dump.rowCounts })).toBeNull()
    const handle: any = await provider.forLocator(RESTORED, RESTORED)
    expect((await handle.execute('select count(*)::int as n from widget')).rows).toEqual([{ n: 1 }])
  })

  it('refuses a dump that does not hold the rows it claims, or carries a meta-command, and drops what it made', async () => {
    const exists = async () => (await provider.db.execute(`select 1 from pg_namespace where nspname = '${BAD}'`)).rows.length

    const fewer = { dump: dump.path, schema: dump.schema, rowCounts: { ...dump.rowCounts, widget: 2 } }
    expect(await codeOfRejection(provider.restoreContainer(BAD, fewer))).toBe('RESTORE_INTEGRITY_FAILED')
    expect(await exists()).toBe(0)

    const planted = path.join(dir, 'planted.sql')
    fs.writeFileSync(planted, fs.readFileSync(dump.path, 'utf8') + '\\! touch /tmp/owned\n')
    expect(await codeOfRejection(provider.restoreContainer(BAD, { ...fewer, dump: planted, rowCounts: dump.rowCounts }))).toBe(
      'RESTORE_INTEGRITY_FAILED'
    )
    expect(await exists()).toBe(0)
  })
})
