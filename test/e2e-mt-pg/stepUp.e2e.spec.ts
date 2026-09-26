/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-13.5: step-up across containers, on real Postgres (F50 to F56).
//
// A step-up proves again the session row the token names, and that row lives in the subject's own
// container. What is observed here, from outside as everywhere in this bench: the row that moves
// is the caller's and no other, the access token keeps its `sid`, and a `freshAuth` route of each
// plane refuses a stale session and lets it through once confirmed.
//
import { expect } from 'expect'
import { setup, teardown, inject, app, systemToken, createTenant, sql, bearer, ACME, GLOBEX, HEADER, SYSTEM } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const tenMinutesAgo = () => Math.floor(Date.now() / 1000) - 600

/** The same session, signed as its login signed it ten minutes ago. */
const staled = (token: string) => {
  const claims: any = app().jwt.decode(token)
  const { iat: _iat, exp: _exp, ...rest } = claims
  return { claims, token: app().jwt.sign({ ...rest, auth_time: tenMinutesAgo() }) }
}

const provenAt = async (schema: string, sid: string) => {
  const rows = await sql().query(`select authenticated_at, auth_methods from "${schema}".session where sid = $1`, [sid])
  return rows.rows[0] as { authenticated_at: Date | null; auth_methods: string[] | null } | undefined
}

describe('Step-up across containers on real Postgres (T-13.5)', function () {
  this.timeout(60000)

  let system: string
  let globexId: string

  before(async () => {
    await setup()
    system = await systemToken()
    await createTenant(system, ACME)
    globexId = (await createTenant(system, GLOBEX)).id
  })

  after(async () => await teardown())

  it('confirms a tenant session inside its own container, and moves nothing elsewhere', async () => {
    const login = await inject({
      method: 'POST',
      url: '/auth/flow/start',
      headers: { [HEADER]: ACME.slug },
      payload: { method: 'password', email: ACME.adminEmail, password: ACME.adminPassword }
    })
    expect(login.statusCode).toBe(200)
    const { claims, token } = staled(body(login).token)
    const before = await provenAt(ACME.locator, claims.sid)
    expect(before?.authenticated_at).toBeInstanceOf(Date)
    const globexBefore = (await sql().query(`select sid, authenticated_at from "${GLOBEX.locator}".session order by sid`)).rows

    const refused = await inject({ method: 'POST', url: '/auth/mfa/setup', headers: bearer(token, ACME.slug) })
    expect(refused.statusCode).toBe(403)
    expect(body(refused)).toMatchObject({ code: 'STEP_UP_REQUIRED', maxAge: 300 })

    const confirmed = await inject({
      method: 'POST',
      url: '/auth/flow/step-up',
      headers: bearer(token, ACME.slug),
      payload: { method: 'password', email: ACME.adminEmail, password: ACME.adminPassword }
    })
    expect(confirmed.statusCode).toBe(200)
    const fresh: any = app().jwt.decode(body(confirmed).token)
    expect(fresh).toMatchObject({ sub: claims.sub, tid: claims.tid, sid: claims.sid })
    expect(fresh.auth_time).toBeGreaterThan(tenMinutesAgo() + 500)

    const after = await provenAt(ACME.locator, claims.sid)
    expect(after!.authenticated_at!.getTime()).toBeGreaterThanOrEqual(before!.authenticated_at!.getTime())
    expect(after!.auth_methods).toEqual(['password'])
    expect((await sql().query(`select sid, authenticated_at from "${GLOBEX.locator}".session order by sid`)).rows).toEqual(globexBefore)

    const passed = await inject({ method: 'POST', url: '/auth/mfa/setup', headers: bearer(body(confirmed).token, ACME.slug) })
    expect(body(passed).code).not.toBe('STEP_UP_REQUIRED')
  })

  it("refuses another tenant's session, and no session at all", async () => {
    const globex = await inject({
      method: 'POST',
      url: '/auth/flow/start',
      headers: { [HEADER]: GLOBEX.slug },
      payload: { method: 'password', email: GLOBEX.adminEmail, password: GLOBEX.adminPassword }
    })
    const { token } = staled(body(globex).token)
    const crossed = await inject({
      method: 'POST',
      url: '/auth/flow/step-up',
      headers: bearer(token, ACME.slug),
      payload: { method: 'password', email: ACME.adminEmail, password: ACME.adminPassword }
    })
    expect(crossed.statusCode).toBe(403)
    expect(body(crossed).code).toBe('TENANT_MISMATCH')

    // No session at all: the route's own authentication answers first.
    const anonymous = await inject({
      method: 'POST',
      url: '/auth/flow/step-up',
      headers: { [HEADER]: ACME.slug },
      payload: { method: 'password', email: ACME.adminEmail, password: ACME.adminPassword }
    })
    expect(anonymous.statusCode).toBe(401)
  })

  it('asks a stale operator to confirm before impersonating, in the control plane only', async () => {
    const { claims, token } = staled(system)
    const refused = await inject({
      method: 'POST',
      url: `/tenants/${globexId}/impersonate`,
      headers: bearer(token),
      payload: { userId: GLOBEX.adminEmail, reason: 'step-up bench' }
    })
    expect(refused.statusCode).toBe(403)
    expect(body(refused).code).toBe('STEP_UP_REQUIRED')

    const confirmed = await inject({
      method: 'POST',
      url: '/system/auth/flow/step-up',
      headers: bearer(token),
      payload: { method: 'password', email: SYSTEM.email, password: SYSTEM.password }
    })
    expect(confirmed.statusCode).toBe(200)
    const fresh: any = app().jwt.decode(body(confirmed).token)
    expect(fresh).toMatchObject({ sub: claims.sub, scp: 'control', sid: claims.sid })
    expect((await provenAt('public', claims.sid))?.auth_methods).toEqual(['password'])

    const allowed = await inject({
      method: 'POST',
      url: `/tenants/${globexId}/impersonate`,
      headers: bearer(body(confirmed).token),
      payload: { userId: GLOBEX.adminEmail, reason: 'step-up bench' }
    })
    expect(allowed.statusCode).toBe(200)

    // The impersonation token it hands out is never fresh, and cannot be made so (F55).
    const imp = body(allowed).token
    const setup = await inject({ method: 'POST', url: '/auth/mfa/setup', headers: bearer(imp, GLOBEX.slug) })
    expect(body(setup).code).toBe('STEP_UP_NOT_AVAILABLE')
  })
})
