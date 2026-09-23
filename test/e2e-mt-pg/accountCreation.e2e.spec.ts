/* eslint-disable @typescript-eslint/no-explicit-any */
//
// F49 over HTTP, on real Postgres and two real tenants: the platform decides the set of account
// creation modes, for every tenant or for one; each tenant's administrator picks inside its own
// set; the registration obeys what applies; a waiting account logs in only once approved.
//
import { expect } from 'expect'
import { setup, teardown, inject, systemToken, createTenant, login, bearer, sql, ACME, GLOBEX, HEADER } from './harness.js'

const body = (res: any) => JSON.parse(res.body)

describe('Account creation on real Postgres (F49)', function () {
  this.timeout(60000)

  let system: string
  let acmeAdmin: string
  let globexAdmin: string
  let globexId: string

  before(async () => {
    await setup()
    system = await systemToken()
    await createTenant(system, ACME)
    globexId = (await createTenant(system, GLOBEX)).id
    acmeAdmin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    globexAdmin = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)
  })

  after(async () => await teardown())

  const register = (slug: string, email: string) =>
    inject({
      method: 'POST',
      url: '/auth/register',
      headers: { [HEADER]: slug },
      payload: { username: email, email, password1: 'Visitor-pw-12345', password2: 'Visitor-pw-12345' }
    })
  const modeOf = async (slug: string) =>
    body(await inject({ method: 'GET', url: '/auth/flow/options', headers: { [HEADER]: slug } })).accountCreation

  it('is closed by default, and a tenant opens it inside what the platform allows', async () => {
    const rule = await inject({ method: 'GET', url: '/system/account-creation', headers: bearer(system) })
    expect(body(rule)).toMatchObject({ from: 'deployment', default: 'invite' })

    const closed = await register(ACME.slug, 'walkin@acme.test')
    expect(closed.statusCode).toBe(403)
    expect(body(closed).code).toBe('REGISTRATION_CLOSED')

    const chosen = await inject({
      method: 'PUT',
      url: '/settings/account-creation',
      headers: bearer(acmeAdmin, ACME.slug),
      payload: { mode: 'open' }
    })
    expect(chosen.statusCode).toBe(200)
    expect(body(chosen)).toMatchObject({ mode: 'open', choice: 'open' })
    expect(await modeOf(ACME.slug)).toBe('open')
    expect((await register(ACME.slug, 'walkin@acme.test')).statusCode).toBe(200)
    // The other tenant chose nothing and stays closed.
    expect(await modeOf(GLOBEX.slug)).toBe('invite')
  })

  it("holds a tenant to its own set, and lets a waiting account in only once it is approved", async () => {
    const narrowed = await inject({
      method: 'PUT',
      url: `/tenants/${globexId}`,
      headers: bearer(system),
      payload: { config: { account_creation: { allowed: ['approval', 'invite'] } } }
    })
    expect(narrowed.statusCode).toBe(200)

    const refused = await inject({
      method: 'PUT',
      url: '/settings/account-creation',
      headers: bearer(globexAdmin, GLOBEX.slug),
      payload: { mode: 'open' }
    })
    expect(refused.statusCode).toBe(403)
    expect(body(refused).code).toBe('ACCOUNT_CREATION_NOT_ALLOWED')

    await inject({
      method: 'PUT',
      url: '/settings/account-creation',
      headers: bearer(globexAdmin, GLOBEX.slug),
      payload: { mode: 'approval' }
    })
    expect((await register(GLOBEX.slug, 'newcomer@globex.test')).statusCode).toBe(200)

    // The address confirmed out of band: this bench is about the approval, not the confirmation email.
    await sql().query(`update "${GLOBEX.locator}"."user" set confirmed = true where email = 'newcomer@globex.test'`)
    const waiting = await inject({
      method: 'POST',
      url: '/auth/login',
      headers: { [HEADER]: GLOBEX.slug },
      payload: { email: 'newcomer@globex.test', password: 'Visitor-pw-12345' }
    })
    expect(waiting.statusCode).toBe(401)
    expect(body(waiting).code).toBe('AUTH_INVALID_CREDENTIALS')

    const pending = await inject({ method: 'GET', url: '/users?approved=false', headers: bearer(globexAdmin, GLOBEX.slug) })
    const rows = body(pending).records ?? body(pending)
    expect(rows.map((u: any) => u.email)).toEqual(['newcomer@globex.test'])

    const approved = await inject({ method: 'POST', url: `/users/${rows[0].id}/approve`, headers: bearer(globexAdmin, GLOBEX.slug) })
    expect(approved.statusCode).toBe(200)
    expect(await login(GLOBEX.slug, 'newcomer@globex.test', 'Visitor-pw-12345')).toBeTruthy()

    const log = await inject({ method: 'GET', url: '/access-log?event:in=account.pending,account.approved', headers: bearer(globexAdmin, GLOBEX.slug) })
    expect(body(log).map((r: any) => r.event).sort()).toEqual(['account.approved', 'account.pending'])
  })

  it('narrows every tenant at once from the platform, and a tenant with its own set keeps it', async () => {
    const all = await inject({
      method: 'PUT',
      url: '/system/account-creation',
      headers: bearer(system),
      payload: { allowed: ['invite'], default: 'invite' }
    })
    expect(all.statusCode).toBe(200)
    // Acme chose `open`, which is no longer allowed: the most closed mode left applies.
    expect(await modeOf(ACME.slug)).toBe('invite')
    expect((await register(ACME.slug, 'late@acme.test')).statusCode).toBe(403)
    const state = await inject({ method: 'GET', url: '/settings/account-creation', headers: bearer(acmeAdmin, ACME.slug) })
    expect(body(state)).toMatchObject({ choice: 'open', mode: 'invite', allowedFrom: 'control' })
    // Globex has a set of its own on its registry row.
    expect(await modeOf(GLOBEX.slug)).toBe('approval')

    const back = await inject({ method: 'DELETE', url: '/system/account-creation', headers: bearer(system) })
    expect(body(back).from).toBe('deployment')
    expect(await modeOf(ACME.slug)).toBe('open')
  })
})
