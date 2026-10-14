/* eslint-disable @typescript-eslint/no-explicit-any */
//
// A package that follows a tenant's life, over HTTP on real Postgres and under both
// strategies. The package keeps a table inside the container, written with text SQL through the
// public door (`access(handle).raw`), and a folder outside it: the table goes with the container,
// the folder is exported next to the dump and removed with the tenant, and a creation the package
// refuses leaves nothing behind. What is on the server and on the disk is checked from outside.
//
import fs from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { access } from '../../db.js'
import { setup, teardown, inject, systemToken, createTenant, sql, bearer, inTenantDatabase, ACME, GLOBEX } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const INITECH = { slug: 'initech', locator: 'tenant_initech' }

for (const strategy of ['schema', 'container'] as const) {
  describe(`A package that follows a tenant, a ${strategy === 'schema' ? 'schema' : 'database'} each (T-16.2)`, function () {
    this.timeout(60000)

    const mailbox: any[] = []
    let exports: string
    let folders: string
    let system: string
    let acmeId: string

    const folderOf = (locator: string) => path.join(folders, locator)
    const notes = {
      name: 'notes',
      async create(place: any, handle: any) {
        await access(handle).raw.transaction(async (query) => {
          await query('create table notes (body text)')
          await query('insert into notes (body) values ($1)', [`${place.slug} note`])
        })
        fs.mkdirSync(folderOf(place.locator), { recursive: true })
        fs.writeFileSync(path.join(folderOf(place.locator), 'note.txt'), `${place.slug} file`)
        if (place.slug === INITECH.slug) throw new Error('this package refuses initech')
      },
      async export(tenant: any, target: string) {
        fs.cpSync(folderOf(tenant.locator), target, { recursive: true })
        return fs.statSync(path.join(target, 'note.txt')).size
      },
      async destroy(place: any) {
        fs.rmSync(folderOf(place.locator), { recursive: true, force: true })
      }
    }

    /** The package's rows, read from outside the application. */
    const notesOf = async (locator: string) =>
      strategy === 'container'
        ? (await inTenantDatabase(locator, (c) => c.query('select body from public.notes'))).rows
        : (await sql().query(`select body from "${locator}".notes`)).rows
    const containerExists = async (locator: string) =>
      strategy === 'container'
        ? (await sql().query('select 1 from pg_database where datname = $1', [locator])).rows.length === 1
        : (await sql().query('select 1 from information_schema.schemata where schema_name = $1', [locator])).rows.length === 1

    before(async () => {
      folders = await mkdtemp(path.join(os.tmpdir(), 'lifecycle-folders-'))
      await setup(
        {
          challengeDeliveryManager: { isImplemented: () => true, deliver: async (message: any) => void mailbox.push(message) },
          tenantLifecycles: [notes]
        },
        { strategy }
      )
      exports = await mkdtemp(path.join(os.tmpdir(), 'lifecycle-exports-'))
      ;(global as any).config.options.export_directory = exports
      system = await systemToken()
      acmeId = (await createTenant(system, ACME)).id
      await createTenant(system, GLOBEX)
    })

    after(async () => {
      await sql().query(`drop schema if exists "${INITECH.locator}" cascade`)
      await sql().query(`drop database if exists "${INITECH.locator}" with (force)`)
      await teardown()
      for (const dir of [exports, folders]) if (dir) await rm(dir, { recursive: true, force: true })
    })

    it('lets the package build its part inside the container and outside it, and nothing in the control plane', async () => {
      expect(await notesOf(ACME.locator)).toEqual([{ body: 'acme note' }])
      expect(await notesOf(GLOBEX.locator)).toEqual([{ body: 'globex note' }])
      expect(fs.readFileSync(path.join(folderOf(ACME.locator), 'note.txt'), 'utf8')).toBe('acme file')
      // Unqualified text SQL under the schema strategy is the tenant's, never the control plane's.
      expect((await sql().query(`select to_regclass('public.notes') as t`)).rows[0].t).toBe(null)
    })

    it('undoes the package and the container when the package refuses the tenant, and writes no row', async () => {
      const res = await inject({
        method: 'POST',
        url: '/tenants',
        headers: bearer(system),
        payload: {
          name: 'Initech',
          slug: INITECH.slug,
          strategy,
          engine: 'postgres',
          locator: INITECH.locator,
          admin: { email: 'admin@initech.test', password: 'Initech-pw-1234', adminConfirmed: true }
        }
      })
      expect(res.statusCode).toBe(500)
      expect(fs.existsSync(folderOf(INITECH.locator))).toBe(false)
      expect(await containerExists(INITECH.locator)).toBe(false)
      expect((await sql().query('select 1 from public.tenant where slug = $1', [INITECH.slug])).rows).toEqual([])
    })

    it("refuses a tenant whose container is another tenant's, and leaves that tenant whole (T-16.4)", async () => {
      const res = await inject({
        method: 'POST',
        url: '/tenants',
        headers: bearer(system),
        payload: {
          name: 'Globex twin',
          slug: 'globex-twin',
          strategy,
          engine: 'postgres',
          locator: GLOBEX.locator,
          admin: { email: 'admin@globex-twin.test', password: 'Twin-pw-123456', adminConfirmed: true }
        }
      })
      expect([res.statusCode, body(res).code]).toEqual([409, 'TENANT_LOCATOR_TAKEN'])
      expect(await notesOf(GLOBEX.locator)).toEqual([{ body: 'globex note' }])
      expect(fs.readFileSync(path.join(folderOf(GLOBEX.locator), 'note.txt'), 'utf8')).toBe('globex file')
      expect((await sql().query('select 1 from public.tenant where slug = $1', ['globex-twin'])).rows).toEqual([])
    })

    it("exports the package's folder next to the dump, and its table inside the dump", async () => {
      const res = await inject({ method: 'POST', url: `/tenants/${acmeId}/export`, headers: bearer(system) })
      expect(res.statusCode).toBe(200)
      const { path: dump, artifacts } = body(res)
      expect(artifacts).toEqual([{ name: 'notes', path: dump.replace(/\.sql$/, '.notes'), bytes: 'acme file'.length }])
      expect(fs.readFileSync(path.join(artifacts[0].path, 'note.txt'), 'utf8')).toBe('acme file')
      expect(fs.readFileSync(dump, 'utf8')).toContain('acme note')
    })

    it("removes the package's folder with the tenant, and leaves the other tenant's", async () => {
      const preview = await inject({ method: 'POST', url: `/tenants/${acmeId}/destruction-request`, headers: bearer(system) })
      expect(preview.statusCode).toBe(200)
      const destroyed = await inject({
        method: 'DELETE',
        url: `/tenants/${acmeId}/data`,
        headers: bearer(system),
        payload: { token: body(preview).token, slug: ACME.slug, otp: mailbox.at(-1).code }
      })
      expect(destroyed.statusCode).toBe(200)
      expect(body(destroyed).artifacts).toHaveLength(1)

      expect(fs.existsSync(folderOf(ACME.locator))).toBe(false)
      expect(await containerExists(ACME.locator)).toBe(false)
      expect(fs.existsSync(folderOf(GLOBEX.locator))).toBe(true)
      expect(await notesOf(GLOBEX.locator)).toEqual([{ body: 'globex note' }])
    })
  })
}
