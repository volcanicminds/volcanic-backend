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

  let admin: string
  let created: any

  const mint = (payload: any) => inject({ method: 'POST', url: '/token', headers: bearer(admin, ACME.slug), payload })

  before(async () => {
    await setup()
    const system = await systemToken()
    await createTenant(system, ACME)
    await createTenant(system, GLOBEX)
    admin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    const res = await mint({ name: 'ci', expiresAt: null })
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

    const listed = await inject({ method: 'GET', url: `/token/${created.id}`, headers: bearer(admin, ACME.slug) })
    expect(listed.statusCode).toBe(200)
    expect(body(listed).token).toBeUndefined()
  })

  it('never expires only when `null` says so, and never by default', async () => {
    expect(created.expiresAt).toBeNull()
    expect(app().jwt.verify(created.token).exp).toBeUndefined()

    const missing = await mint({ name: 'no expiry given' })
    expect(missing.statusCode).toBe(400)
    const past = await mint({ name: 'already expired', expiresAt: new Date(Date.now() - 60_000).toISOString() })
    expect(past.statusCode).toBe(400)
    expect(body(past).code).toBe('TOKEN_EXPIRY_INVALID')
  })

  it('expires when its row says, and is refused after', async () => {
    const at = new Date(Math.ceil(Date.now() / 1000) * 1000 + 2000)
    const res = await mint({ name: 'short', expiresAt: at.toISOString() })
    expect(res.statusCode).toBe(200)
    const short = body(res)
    expect(new Date(short.expiresAt).getTime()).toBe(at.getTime())
    expect(app().jwt.decode(short.token)).toMatchObject({ exp: at.getTime() / 1000 })
    const row = (await sql().query(`select expires_at from "${ACME.locator}".token where id = $1`, [short.id])).rows[0]
    expect(row.expires_at.getTime()).toBe(at.getTime())

    expect((await inject({ method: 'GET', url: '/probe/subject', headers: bearer(short.token, ACME.slug) })).statusCode).toBe(200)
    await new Promise((resolve) => setTimeout(resolve, at.getTime() - Date.now() + 1000))
    expect((await inject({ method: 'GET', url: '/probe/subject', headers: bearer(short.token, ACME.slug) })).statusCode).toBe(401)
  })

  it('stops at the next request once blocked or removed, and a block can be lifted', async () => {
    const revocable = body(await mint({ name: 'revocable', expiresAt: null }))
    const use = () => inject({ method: 'GET', url: '/probe/subject', headers: bearer(revocable.token, ACME.slug) })
    const manage = (method: string, url: string, payload?: any) =>
      inject({ method, url, headers: bearer(admin, ACME.slug), payload })

    expect((await manage('POST', `/token/${revocable.id}/block`, { reason: 'leaked' })).statusCode).toBe(200)
    const blocked = await use()
    expect(blocked.statusCode).toBe(403)
    expect(body(blocked).code).toBe('TOKEN_NOT_VALID')

    expect((await manage('POST', `/token/${revocable.id}/unblock`)).statusCode).toBe(200)
    expect((await use()).statusCode).toBe(200)

    expect((await manage('DELETE', `/token/${revocable.id}`)).statusCode).toBe(200)
    const removed = await use()
    expect(removed.statusCode).toBe(403)
    expect(body(removed).code).toBe('TOKEN_NOT_VALID')
  })
})
