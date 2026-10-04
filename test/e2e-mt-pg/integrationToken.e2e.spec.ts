/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Integration tokens on real Postgres (T-14.7).
//
// `POST /token` answers with the bearer once. What is observed here: that bearer authenticates in
// the tenant it was created in and nowhere else, and the row the table keeps holds no copy of it,
// in any column, for whoever can read the table.
//
import { expect } from 'expect'
import { setup, teardown, inject, app, systemToken, createTenant, login, sql, bearer, ACME, GLOBEX } from './harness.js'

const body = (res: any) => JSON.parse(res.body)

describe('Integration tokens on real Postgres (T-14.7)', function () {
  this.timeout(60000)

  let created: any

  before(async () => {
    await setup()
    const system = await systemToken()
    await createTenant(system, ACME)
    await createTenant(system, GLOBEX)
    const admin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    const res = await inject({ method: 'POST', url: '/token', headers: bearer(admin, ACME.slug), payload: { name: 'ci' } })
    expect(res.statusCode).toBe(200)
    created = body(res)
  })

  after(async () => await teardown())

  it('returns the bearer once, and the bearer names the row', async () => {
    expect(created.token).toEqual(expect.any(String))
    expect(app().jwt.verify(created.token)).toMatchObject({ sub: created.externalId })
  })

  it('authenticates in its own tenant, and is a stranger in another', async () => {
    const own = await inject({ method: 'GET', url: '/probe/subject', headers: bearer(created.token, ACME.slug) })
    expect(own.statusCode).toBe(200)
    expect(body(own)).toEqual({ tenant: ACME.slug, user: null, token: created.id })

    // The row lives in the tenant the token was created in: anywhere else its subject is unknown.
    const elsewhere = await inject({ method: 'GET', url: '/probe/subject', headers: bearer(created.token, GLOBEX.slug) })
    expect(elsewhere.statusCode).toBe(404)
  })

  it('stores no copy of the bearer, in any column of the row', async () => {
    const rows = (await sql().query(`select * from "${ACME.locator}".token where id = $1`, [created.id])).rows
    expect(rows.length).toBe(1)
    expect(JSON.stringify(rows[0])).not.toContain(created.token)

    const listed = await inject({
      method: 'GET',
      url: `/token/${created.id}`,
      headers: bearer(await login(ACME.slug, ACME.adminEmail, ACME.adminPassword), ACME.slug)
    })
    expect(listed.statusCode).toBe(200)
    expect(body(listed).token).toBeUndefined()
  })
})
