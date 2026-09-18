/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-11.11: renewal across containers, on real Postgres.
//
// The session registry moved a fact that used to live inside a signature into a row, and the row
// lives inside the tenant's own container. That raises a question the single-container suites
// cannot answer: on the renewal route the access token is gone by design, so nothing upstream has
// read a `tid`, and the credential itself is what names the container to open. If that addressing
// were wrong in either direction the damage would be silent and serious — a session written in
// one customer's schema and renewed from another's, or a renewal that opens the wrong container
// and finds nothing.
//
// So the properties below are observed from outside, as everything in this bench is: what the
// client gets back over HTTP, and what a plain `pg` connection sees in each schema.
//
import { expect } from 'expect'
import { setup, teardown, inject, systemToken, createTenant, sql, ACME, GLOBEX, HEADER } from './harness.js'

const body = (res: any) => JSON.parse(res.body)

/** The whole login body, which the harness helper reduces to the access token. */
async function session(slug: string, email: string, password: string) {
  const res = await inject({ method: 'POST', url: '/auth/login', headers: { [HEADER]: slug }, payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`login ${slug} failed (${res.statusCode}): ${res.body}`)
  return body(res)
}

const renew = (slug: string, refreshToken: string) =>
  inject({ method: 'POST', url: '/auth/refresh-token', headers: { [HEADER]: slug }, payload: { refreshToken } })

const sessionsIn = async (schema: string) => {
  const rows = await sql().query(`select scope, revoked_at, revoked_reason from "${schema}".session`)
  return rows.rows as { scope: string; revoked_at: Date | null; revoked_reason: string | null }[]
}

describe('Renewal across containers on real Postgres (T-11.11)', function () {
  this.timeout(60000)

  let system: string

  before(async () => {
    await setup()
    system = await systemToken()
    await createTenant(system, ACME)
    await createTenant(system, GLOBEX)
  })

  after(async () => await teardown())

  it('writes a tenant session inside that tenant container, and nowhere else', async () => {
    const before = (await sessionsIn(GLOBEX.locator)).length
    await session(ACME.slug, ACME.adminEmail, ACME.adminPassword)

    expect((await sessionsIn(ACME.locator)).length).toBeGreaterThan(0)
    // Invariant 7 applied to sessions: nothing of one customer appears in another's schema.
    expect((await sessionsIn(GLOBEX.locator)).length).toBe(before)
    // And the control plane holds platform sessions only, never a tenant user's.
    expect((await sessionsIn('public')).every((row) => row.scope === 'control')).toBe(true)
  })

  it('renews with the credential of its own tenant, and rotates it', async () => {
    const opened = await session(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    expect(typeof opened.refreshToken).toBe('string')

    const res = await renew(ACME.slug, opened.refreshToken)
    expect(res.statusCode).toBe(200)

    const renewed = body(res)
    expect(typeof renewed.token).toBe('string')
    expect(renewed.refreshToken).not.toBe(opened.refreshToken)

    // The renewed access token opens the container it belongs to, with the tenant taken from it.
    const probe = await inject({
      method: 'GET',
      url: '/probe/tenant',
      headers: { authorization: `Bearer ${renewed.token}`, [HEADER]: ACME.slug }
    })
    expect(body(probe).tag).toBe(ACME.tag)
  })

  it('refuses the credential of one tenant presented as another tenant', async () => {
    const opened = await session(ACME.slug, ACME.adminEmail, ACME.adminPassword)

    const res = await renew(GLOBEX.slug, opened.refreshToken)
    // Defect D-19 on the one route where the credential arrives in the body: renewal must not be
    // the door through which a session of one tenant is exchanged for a session in another.
    expect(res.statusCode).toBe(403)
    expect(body(res).code).toBe('TENANT_MISMATCH')

    // And the refusal costs the honest session nothing: it still renews where it belongs.
    expect((await renew(ACME.slug, opened.refreshToken)).statusCode).toBe(200)
  })

  it('closes the session when a spent credential comes back, and writes the reason in its row', async () => {
    const saved = process.env.SESSION_GRACE_SECONDS
    process.env.SESSION_GRACE_SECONDS = '0'
    try {
      const opened = await session(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      const rotated = body(await renew(ACME.slug, opened.refreshToken))

      const replay = await renew(ACME.slug, opened.refreshToken)
      expect(replay.statusCode).toBe(401)
      expect(body(replay).code).toBe('SESSION_REUSE_DETECTED')

      // The family goes, not only the copy that came back: the credential the legitimate holder
      // received one call earlier stops working too.
      expect((await renew(ACME.slug, rotated.refreshToken)).statusCode).toBe(401)

      const reasons = (await sessionsIn(ACME.locator)).map((row) => row.revoked_reason)
      expect(reasons).toContain('reuse detected')
    } finally {
      if (saved === undefined) delete process.env.SESSION_GRACE_SECONDS
      else process.env.SESSION_GRACE_SECONDS = saved
    }
  })

  it('stops renewing after a logout, which is what a logout was supposed to mean', async () => {
    const opened = await session(ACME.slug, ACME.adminEmail, ACME.adminPassword)

    const out = await inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${opened.token}`, [HEADER]: ACME.slug }
    })
    expect(out.statusCode).toBe(200)

    const res = await renew(ACME.slug, opened.refreshToken)
    expect(res.statusCode).toBe(401)
    expect(body(res).code).toBe('REFRESH_REQUIRED')
  })

  it('keeps the platform session in the control plane, renewable there and only there', async () => {
    const res = await inject({
      method: 'POST',
      url: '/system/auth/login',
      payload: { email: 'super@system.test', password: 'Super-pw-123456' }
    })
    const opened = body(res)
    expect(typeof opened.refreshToken).toBe('string')

    const renewed = await inject({ method: 'POST', url: '/system/auth/refresh-token', payload: { refreshToken: opened.refreshToken } })
    expect(renewed.statusCode).toBe(200)
    expect(body(renewed).refreshToken).not.toBe(opened.refreshToken)

    // The same credential offered to the tenant renewal is addressed at the control plane, and a
    // tenant renewal must not accept it whatever the header says.
    const crossed = await renew(ACME.slug, opened.refreshToken)
    expect(crossed.statusCode).toBeGreaterThanOrEqual(400)
  })
})
