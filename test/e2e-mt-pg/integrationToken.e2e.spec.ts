/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Integration tokens on real Postgres.
//
// `POST /token` answers with the bearer once. What is observed here: that bearer carries the tenant
// it was created in and authenticates there without a header and nowhere else, and the row the
// table keeps holds no copy of it, in any column, for whoever can read the table.
//
import { expect } from 'expect'
import { setup, teardown, inject, app, systemToken, createTenant, login, sql, bearer, ACME, GLOBEX } from './harness.js'

const body = (res: any) => JSON.parse(res.body)

describe('Integration tokens on real Postgres (T-14.7)', function () {
  this.timeout(60000)

  let admin: string
  let created: any
  let acme: any

  const mint = (payload: any) => inject({ method: 'POST', url: '/token', headers: bearer(admin, ACME.slug), payload })

  before(async () => {
    await setup()
    const system = await systemToken()
    acme = await createTenant(system, ACME)
    await createTenant(system, GLOBEX)
    admin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    const res = await mint({ name: 'ci', expiresAt: null })
    expect(res.statusCode).toBe(200)
    created = body(res)
  })

  after(async () => await teardown())

  it('returns the bearer once, and the bearer names the row and its tenant', async () => {
    expect(created.token).toEqual(expect.any(String))
    expect(app().jwt.verify(created.token)).toMatchObject({ sub: created.externalId, tid: acme.id })
  })

  it('authenticates in its own tenant without naming it, and is refused in another', async () => {
    // The token decides the tenant, as a session's does: a machine sends it alone.
    const alone = await inject({ method: 'GET', url: '/probe/subject', headers: bearer(created.token) })
    expect(alone.statusCode).toBe(200)
    expect(body(alone)).toEqual({ tenant: ACME.slug, user: null, token: created.id })

    const named = await inject({ method: 'GET', url: '/probe/subject', headers: bearer(created.token, ACME.slug) })
    expect(named.statusCode).toBe(200)

    // A header naming another tenant may only disagree, and is refused before any container opens.
    const elsewhere = await inject({ method: 'GET', url: '/probe/subject', headers: bearer(created.token, GLOBEX.slug) })
    expect(elsewhere.statusCode).toBe(403)
    expect(body(elsewhere).code).toBe('TENANT_MISMATCH')
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

  it('reissues a bearer that works, and the bearer before it stops at the next request (T-17.7)', async () => {
    const first = body(await mint({ name: 'reissued', expiresAt: null }))
    const use = (token: string) => inject({ method: 'GET', url: '/probe/subject', headers: bearer(token) })
    expect((await use(first.token)).statusCode).toBe(200)

    const res = await inject({ method: 'POST', url: `/token/${first.id}/reissue`, headers: bearer(admin, ACME.slug) })
    expect(res.statusCode).toBe(200)
    const second = body(res)
    expect([second.id, second.name]).toEqual([first.id, 'reissued'])
    expect(second.externalId).not.toBe(first.externalId)
    expect(app().jwt.verify(second.token)).toMatchObject({ sub: second.externalId, tid: acme.id })

    expect((await use(second.token)).statusCode).toBe(200)
    // The row is still there, under another externalId: the old `sub` names nobody.
    const stale = await use(first.token)
    expect([stale.statusCode, body(stale).code]).toEqual([404, 'SUBJECT_NOT_FOUND'])
    const row = (await sql().query(`select * from "${ACME.locator}".token where id = $1`, [first.id])).rows[0]
    expect(JSON.stringify(row)).not.toContain(second.token)
  })
})
