/* eslint-disable @typescript-eslint/no-explicit-any */
//
// A database per tenant over HTTP on real Postgres: creating a tenant creates its database
// and migrates it, its users read their own rows and nobody else's, exporting it dumps that
// database whole, and destroying it drops it while the other tenant keeps working. What is on the
// server is checked from outside, with plain `pg`.
//
import fs from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import {
  setup,
  teardown,
  inject,
  systemToken,
  createTenant,
  login,
  sql,
  bearer,
  inTenantDatabase,
  ACME,
  GLOBEX,
  CONTROL_TAG
} from './harness.js'

const body = (res: any) => JSON.parse(res.body)

describe('A database per tenant on real Postgres (T-16.1)', function () {
  this.timeout(60000)

  const mailbox: any[] = []
  let exports: string
  let system: string
  let acmeId: string

  const call = (method: string, url: string, payload?: unknown) =>
    inject({ method, url, headers: bearer(system), ...(payload === undefined ? {} : { payload }) })
  const databases = async () =>
    (await sql().query('select datname from pg_database where datname = any($1) order by datname', [[ACME.locator, GLOBEX.locator]])).rows.map(
      (r: any) => r.datname
    )

  before(async () => {
    await setup(
      {
        challengeDeliveryManager: {
          isImplemented: () => true,
          deliver: async (message: any) => {
            mailbox.push(message)
          }
        }
      },
      { strategy: 'container' }
    )
    exports = await mkdtemp(path.join(os.tmpdir(), 'container-exports-'))
    ;(global as any).config.options.export_directory = exports
    system = await systemToken()
    acmeId = (await createTenant(system, ACME)).id
    await createTenant(system, GLOBEX)
  })

  after(async () => {
    await teardown()
    if (exports) await rm(exports, { recursive: true, force: true })
  })

  it('creates a database for each tenant, migrated, and no schema in the control one', async () => {
    expect(await databases()).toEqual([ACME.locator, GLOBEX.locator])
    const schemas = await sql().query('select schema_name from information_schema.schemata where schema_name = any($1)', [
      [ACME.locator, GLOBEX.locator]
    ])
    expect(schemas.rows).toEqual([])

    const applied = await inTenantDatabase(ACME.locator, (c) => c.query(`select name from public.migration where "set" = 'tenant'`))
    expect(applied.rows.length).toBeGreaterThan(0)
    const row = await sql().query('select strategy, schema_version from public.tenant where id = $1', [acmeId])
    expect(row.rows[0]).toEqual({ strategy: 'container', schema_version: applied.rows.at(-1).name })
  })

  it("gives each tenant's users their own rows and nobody else's", async () => {
    const acme = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    const globex = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)

    for (const [token, t] of [
      [acme, ACME],
      [globex, GLOBEX]
    ] as const) {
      const res = await inject({ method: 'GET', url: '/probe/tenant', headers: bearer(token, t.slug) })
      expect(body(res)).toMatchObject({ tenant: t.slug, tag: t.tag })
    }
    expect(body(await inject({ method: 'GET', url: '/probe/control' })).tag).toBe(CONTROL_TAG)
  })

  it("exports the tenant's database whole, and nothing of the other tenant or of the control plane", async () => {
    const res = await call('POST', `/tenants/${acmeId}/export`)
    expect(res.statusCode).toBe(200)
    const dump = fs.readFileSync(path.join(exports, body(res).package, 'tenant.sql'), 'utf8')
    expect(dump).toContain(ACME.tag)
    expect(dump).toContain(ACME.adminEmail)
    expect(dump).not.toContain(GLOBEX.tag)
    expect(dump).not.toContain(CONTROL_TAG)
  })

  it('drops the database of a destroyed tenant, and the other tenant keeps working', async () => {
    const preview = await call('POST', `/tenants/${acmeId}/destruction-request`)
    expect(preview.statusCode).toBe(200)
    expect(body(preview).preview.rowCounts.widget).toBe(1)
    expect(body(preview).preview.sizeBytes).toBeGreaterThan(0)

    const otp = mailbox.at(-1).code
    const destroyed = await call('DELETE', `/tenants/${acmeId}/data`, { token: body(preview).token, slug: ACME.slug, otp })
    expect(destroyed.statusCode).toBe(200)
    expect(await databases()).toEqual([GLOBEX.locator])

    const globex = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)
    const res = await inject({ method: 'GET', url: '/probe/tenant', headers: bearer(globex, GLOBEX.slug) })
    expect(body(res).tag).toBe(GLOBEX.tag)
  })
})
