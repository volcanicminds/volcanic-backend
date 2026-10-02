/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-6.2: taking a customer's data out.
//
// The assertions are the three refusals, because the failure this operation must never have
// is the plausible one: a file that exists, opens cleanly, and is missing something. A backup
// nobody can tell is broken is worse than a backup that was never made.
//
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import {
  exportPath,
  exportPostgresSchema,
  ExportFailedError,
  ExportToolMissingError,
  DEFAULT_EXPORT_DIRECTORY
} from '../../lib/database/containers/export.js'

;(global as any).log = {}

const URL = process.env.DATABASE_URL
const suite = URL ? describe : describe.skip

const ACME: any = { id: 'id-acme', slug: 'acme', locator: 'test_export_acme', status: 'active' }

/**
 * The machine `code` of a rejection.
 *
 * Asserted alongside the class because they are not the same promise: the class name is
 * internal and a consumer never sees it, while the code travels in the response body and is
 * what a client branches on. A test that pins only the class lets the contract change silently.
 */
const codeOfRejection = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e: any) {
    return e?.code ?? 'NO_CODE'
  }
  return 'NO_ERROR'
}

describe('export · where the file goes (T-6.2)', () => {
  let dir: string
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-export-'))
  })
  after(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('names the file after the tenant, the version and the instant', () => {
    const file = exportPath(ACME, { directory: dir, schemaVersion: '0002_add_tags' }, 'sql')
    expect(path.basename(file)).toMatch(/^acme-0002_add_tags-.*\.sql$/)
    expect(path.dirname(file)).toBe(path.resolve(dir))
  })

  it('says so when the container has no version, instead of leaving it out', () => {
    const file = exportPath(ACME, { directory: dir, schemaVersion: null }, 'sql')
    // A dump whose version is unknown can be restored into a container the code no longer
    // matches, so "unknown" is written down rather than omitted.
    expect(path.basename(file)).toContain('no-migration')
  })

  it('keeps a hostile slug inside the configured directory', () => {
    const hostile: any = { id: 'x', slug: '../../etc/passwd', locator: 'x' }
    const file = exportPath(hostile, { directory: dir, schemaVersion: null }, 'sql')
    // The caller never chooses a path, and a slug is not a path: what survives sanitisation
    // is a file name, inside the directory, always.
    expect(path.dirname(file)).toBe(path.resolve(dir))
    expect(file).not.toContain('etc/passwd')
  })

  it('has a default nobody has to remember', () => {
    expect(DEFAULT_EXPORT_DIRECTORY).toBe('./data/exports')
  })
})

describe('export · the refusals, without a server (T-6.2)', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-export-refusal-'))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('refuses, and writes nothing, when pg_dump is not there', async () => {
    // An empty PATH is a machine without the client: the export fails instead of becoming a
    // smaller one. The tool-missing refusal carries its own code, because a deployment must
    // tell "I cannot export" from "the export failed": only one is fixable by retrying.
    const saved = process.env.PATH
    process.env.PATH = dir
    try {
      expect(await codeOfRejection(exportPostgresSchema(ACME, { directory: dir, schemaVersion: null }))).toBe(
        'EXPORT_TOOL_MISSING'
      )
    } finally {
      process.env.PATH = saved
    }
    expect(fs.readdirSync(dir)).toEqual([])
  })

  it('fails, and leaves nothing behind, when pg_dump cannot reach the server', async function () {
    // Nothing listens on port 1: pg_dump starts, fails, and exits non-zero.
    const request = { directory: dir, schemaVersion: null, url: 'postgres://nobody@127.0.0.1:1/none' }
    const code = await codeOfRejection(exportPostgresSchema(ACME, request))
    if (code === 'EXPORT_TOOL_MISSING') return this.skip() // no pg_dump on this machine
    expect(code).toBe('EXPORT_FAILED')
    // A truncated dump is a trap, not a partial result.
    expect(fs.readdirSync(dir)).toEqual([])
  })
})

suite('export · a Postgres container (T-6.2)', function () {
  this.timeout(60000)

  let dir: string
  let provider: any

  before(async () => {
    const { PostgresProvider } = await import('../../lib/database/adapters/postgres/index.js')
    provider = new PostgresProvider({ url: URL, schema: 'public', poolMax: 2 })
    await provider.dropSchema(ACME.locator)
    await provider.createSchema(ACME.locator)

    const handle: any = await provider.forLocator(ACME.locator, ACME.id)
    await handle.execute('create table widget (id text primary key, tag text)')
    await handle.execute("insert into widget (id, tag) values ('w1', 'ACME PRIVATE ROW')")

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-export-pg-'))
  })

  after(async () => {
    await provider.dropSchema(ACME.locator)
    await provider.shutdown()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes a dump of that container, and of nothing else', async function () {
    let result: any
    try {
      result = await exportPostgresSchema(ACME, { directory: dir, schemaVersion: '0001_init', url: URL })
    } catch (e) {
      // No pg_dump on this machine, or one too old for this server: either way the tool
      // cannot produce the export, and the refusal itself is what the next test asserts.
      if (e instanceof ExportToolMissingError) return this.skip()
      throw e
    }

    const dump = fs.readFileSync(result.path, 'utf8')
    expect(dump).toContain('widget')
    expect(dump).toContain('ACME PRIVATE ROW')
    // One customer's export contains that customer's data and no trace of anybody else's.
    expect(dump).not.toContain('system_user')
    expect(result.schemaVersion).toBe('0001_init')
    expect(result.bytes).toBeGreaterThan(0)
  })

  it('treats a pg_dump too old for the server as a missing tool', async function () {
    // The message names both versions, because "the export failed" sends an operator to look
    // at their schema and "pg_dump 14 cannot dump a server 16" sends them to install a client.
    try {
      await exportPostgresSchema(ACME, { directory: dir, schemaVersion: null, url: URL })
    } catch (e: any) {
      if (e instanceof ExportToolMissingError) {
        expect(e.message).toMatch(/pg_dump/)
        return
      }
      throw e
    }
    this.skip() // the client matches the server here: nothing to assert
  })

  it('fails on a schema that does not exist, without leaving a file', async function () {
    const before = fs.readdirSync(dir).length
    const ghost: any = { id: 'g', slug: 'ghost', locator: 'test_export_nothing_here' }

    try {
      await exportPostgresSchema(ghost, { directory: dir, schemaVersion: null, url: URL })
      throw new Error('the export should have failed')
    } catch (e: any) {
      if (e instanceof ExportToolMissingError) return this.skip()
      expect(e).toBeInstanceOf(ExportFailedError)
    }
    expect(fs.readdirSync(dir).length).toBe(before)
  })
})
