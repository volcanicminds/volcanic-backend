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
import { setup, teardown, inject, systemToken, createTenant, sql, bearer, inTenantDatabase, login, ACME, GLOBEX } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const INITECH = { slug: 'initech', locator: 'tenant_initech' }
const COPY = { slug: 'acme-copy', locator: 'tenant_acme_copy', password: 'Copy-pw-1234567' }

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
      // The table comes back with the dump: only the folder is the package's to put back.
      async restore(place: any, _handle: any, source: string) {
        fs.cpSync(source, folderOf(place.locator), { recursive: true })
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
      for (const locator of [INITECH.locator, COPY.locator]) {
        await sql().query(`drop schema if exists "${locator}" cascade`)
        await sql().query(`drop database if exists "${locator}" with (force)`)
      }
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
      const { package: name, artifacts } = body(res)
      expect(artifacts).toEqual([{ name: 'notes', bytes: 'acme file'.length }])
      expect(fs.readFileSync(path.join(exports, name, 'tenant.notes', 'note.txt'), 'utf8')).toBe('acme file')
      expect(fs.readFileSync(path.join(exports, name, 'tenant.sql'), 'utf8')).toContain('acme note')
    })

    let copyId: string
    it('restores a package as a new tenant: the rows, the folder, the founder, and nothing that was a credential (T-17.4)', async () => {
      const admin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      const minted = await inject({ method: 'POST', url: '/token', headers: bearer(admin, ACME.slug), payload: { name: 'ci', expiresAt: null } })
      expect(minted.statusCode).toBe(200)
      const idp = await inject({
        method: 'POST',
        url: `/tenants/${acmeId}/identity-providers`,
        headers: bearer(system),
        payload: { key: 'entra', type: 'oidc', status: 'active', config: { issuer: 'https://login.example.com/acme', clientId: 'acme-app', redirectUri: 'https://acme.example.com/callback' }, clientSecret: 'IDP-SECRET' }
      })
      expect(idp.statusCode).toBe(201)

      const exported = await inject({ method: 'POST', url: `/tenants/${acmeId}/export`, headers: bearer(system) })
      expect(exported.statusCode).toBe(200)
      const { package: name } = body(exported)
      const onDisk = fs.readdirSync(path.join(exports, name)).join(' ')
      for (const secret of [ACME.adminPassword, 'IDP-SECRET']) expect(fs.readFileSync(path.join(exports, name, 'tenant.sql'), 'utf8')).not.toContain(secret)
      expect(onDisk).toBe('envelope.json manifest.json tenant.notes tenant.sql')

      // The customer's copy leaves the envelope out; the operator's keeps it.
      const client = await inject({ method: 'GET', url: `/tenants/${acmeId}/exports/${name}`, headers: bearer(system) })
      expect([client.statusCode, client.headers['content-type']]).toEqual([200, 'application/x-tar'])
      expect(client.rawPayload.includes(Buffer.from(`${name}/tenant.sql`))).toBe(true)
      expect(client.rawPayload.includes(Buffer.from('envelope.json'))).toBe(false)
      const operator = await inject({ method: 'GET', url: `/tenants/${acmeId}/exports/${name}?profile=operator`, headers: bearer(system) })
      expect(operator.rawPayload.includes(Buffer.from('envelope.json'))).toBe(true)

      const restored = await inject({
        method: 'POST',
        url: '/tenants/import',
        headers: bearer(system),
        payload: { package: name, slug: COPY.slug, locator: COPY.locator, founderPassword: COPY.password }
      })
      expect(restored.statusCode).toBe(201)
      const copy = body(restored)
      copyId = copy.id
      expect(copy).toMatchObject({ slug: COPY.slug, locator: COPY.locator, name: ACME.name, status: 'active' })
      expect(copy.id).not.toBe(acmeId)

      expect(await notesOf(COPY.locator)).toEqual([{ body: 'acme note' }])
      expect(fs.readFileSync(path.join(folderOf(COPY.locator), 'note.txt'), 'utf8')).toBe('acme file')

      // The founder logs in with the password the request set, and with no other.
      await expect(login(COPY.slug, ACME.adminEmail, ACME.adminPassword)).rejects.toThrow(/401/)
      const founder = await login(COPY.slug, ACME.adminEmail, COPY.password)
      const probe = await inject({ method: 'GET', url: '/probe/tenant', headers: bearer(founder, COPY.slug) })
      expect(body(probe)).toMatchObject({ tenant: COPY.slug, tag: ACME.tag })

      // An integration token comes back under a new external id: a bearer of the source names nothing here.
      const tokens = async (locator: string) =>
        strategy === 'container'
          ? (await inTenantDatabase(locator, (c) => c.query('select id, external_id from public.token order by id'))).rows
          : (await sql().query(`select id, external_id from "${locator}".token order by id`)).rows
      const [source, back] = [await tokens(ACME.locator), await tokens(COPY.locator)]
      expect(back.map((t: any) => t.id)).toEqual(source.map((t: any) => t.id))
      expect(back.map((t: any) => t.external_id)).not.toContain(source[0].external_id)

      // The identity provider comes back disabled, without its secret.
      const providers = await inject({ method: 'GET', url: `/tenants/${copy.id}/identity-providers`, headers: bearer(system) })
      expect(body(providers).map((p: any) => [p.key, p.status])).toEqual([['entra', 'disabled']])
      const entra = await inject({ method: 'GET', url: `/tenants/${copy.id}/identity-providers/entra`, headers: bearer(system) })
      expect(body(entra)).toMatchObject({ status: 'disabled', hasClientSecret: false })

      const event = (await sql().query(`select detail from public.governance_log where action = 'tenant.imported' and outcome = 'success' and tenant_id = $1`, [copy.id])).rows
      expect(event).toEqual([{ detail: expect.objectContaining({ sourceTenantId: acmeId, package: name, tokens: 1, identityProviders: 1 }) }])
    })

    it('records that a tenant moved, with the package it went with, and keeps it out of service (T-17.6)', async () => {
      const exported = await inject({ method: 'POST', url: `/tenants/${copyId}/export`, headers: bearer(system) })
      expect(exported.statusCode).toBe(200)
      const { package: name } = body(exported)
      const other = await inject({ method: 'POST', url: `/tenants/${acmeId}/move`, headers: bearer(system), payload: { destination: 'eu-west-2', package: name } })
      expect([other.statusCode, body(other).code]).toEqual([409, 'TENANT_PACKAGE_MISMATCH'])

      const moved = await inject({ method: 'POST', url: `/tenants/${copyId}/move`, headers: bearer(system), payload: { destination: 'eu-west-2', package: name } })
      expect(moved.statusCode).toBe(200)
      expect(body(moved)).toEqual({ id: copyId, status: 'moved', movedTo: 'eu-west-2' })
      await expect(login(COPY.slug, ACME.adminEmail, COPY.password)).rejects.toThrow(/failed/)
      expect(await containerExists(COPY.locator)).toBe(true)
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
      destroyedWith = body(destroyed).exportRef
    })

    let destroyedWith: string
    it('restores the package a destruction left, under the same slug and locator, as a new row', async () => {
      const res = await inject({
        method: 'POST',
        url: '/tenants/import',
        headers: bearer(system),
        payload: { package: destroyedWith, slug: ACME.slug, locator: ACME.locator, founderPassword: COPY.password }
      })
      expect(res.statusCode).toBe(201)
      expect(body(res).id).not.toBe(acmeId)
      const rows = (await sql().query('select id, status from public.tenant where slug = $1 order by created_at', [ACME.slug])).rows
      expect(rows).toEqual([
        { id: acmeId, status: 'destroyed' },
        { id: body(res).id, status: 'active' }
      ])
      expect(await notesOf(ACME.locator)).toEqual([{ body: 'acme note' }])
      await login(ACME.slug, ACME.adminEmail, COPY.password)
    })
  })
}
