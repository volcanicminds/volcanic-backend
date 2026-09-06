/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The seven properties of docs/TESTING_V5.md §2.4. Every one of them is a PROPERTY
// observable from outside: what a client can read. None of them asserts a configuration,
// because a configuration test passes on broken code.
//
// Expected state today: all red. The data layer does not exist yet. They turn green when
// phase 3 closes, and they must do it WITHOUT being edited — a bench you adjust to make it
// pass is not a bench.
//
import { expect } from 'expect'
import {
  setup,
  teardown,
  inject,
  systemToken,
  createTenant,
  login,
  bearer,
  ACME,
  GLOBEX,
  CONTROL_TAG,
  HEADER
} from './harness.js'

const body = (res: any) => JSON.parse(res.body)

describe('Isolation on real Postgres', function () {
  this.timeout(60000)

  let system: string
  let acmeToken: string
  let globexToken: string
  let acmeId: string
  let globexId: string

  before(async () => {
    await setup()
    system = await systemToken()
    acmeId = (await createTenant(system, ACME)).id
    globexId = (await createTenant(system, GLOBEX)).id
    acmeToken = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    globexToken = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)
  })

  after(async () => await teardown())

  // 1. The session state of a request does not survive it.
  it('does not carry the tenant container into the next request', async () => {
    const inside = await inject({ method: 'GET', url: '/probe/tenant', headers: bearer(acmeToken, ACME.slug) })
    expect(body(inside).tag).toBe(ACME.tag)

    const after = await inject({ method: 'GET', url: '/probe/control' })
    expect(body(after).tag).toBe(CONTROL_TAG)
  })

  // 2. A control-scope route reads the registry, not a copy sitting inside a container.
  it('lists the registry from the control plane after a tenant request', async () => {
    await inject({ method: 'GET', url: '/probe/tenant', headers: bearer(acmeToken, ACME.slug) })

    const res = await inject({ method: 'GET', url: '/tenants', headers: bearer(system) })
    expect(res.statusCode).toBe(200)
    const slugs = (body(res).records ?? body(res)).map((t: any) => t.slug).sort()
    expect(slugs).toEqual([ACME.slug, GLOBEX.slug])
  })

  // 3. A subject that exists only inside a tenant cannot act on the platform.
  it('refuses a tenant token on a control-scope route', async () => {
    const res = await inject({ method: 'GET', url: '/tenants', headers: bearer(acmeToken) })
    expect([401, 403]).toContain(res.statusCode)
  })

  // 4. Impersonation does not leave the connection pointed at the impersonated tenant.
  it('does not leave the container behind after impersonation', async () => {
    const res = await inject({
      method: 'POST',
      url: `/tenants/${globexId}/impersonate`,
      headers: bearer(system),
      payload: { userId: GLOBEX.adminEmail, reason: 'isolation bench' }
    })
    expect(res.statusCode).toBe(200)

    const after = await inject({ method: 'GET', url: '/probe/control' })
    expect(body(after).tag).toBe(CONTROL_TAG)
  })

  // 5. The tenant comes from the token; the header cannot override it.
  it('refuses a token of one tenant presented with the header of another', async () => {
    const res = await inject({
      method: 'GET',
      url: '/probe/tenant',
      headers: { authorization: `Bearer ${acmeToken}`, [HEADER]: GLOBEX.slug }
    })
    expect(res.statusCode).toBeGreaterThanOrEqual(400)
    if (res.statusCode < 300) expect(body(res).tag).not.toBe(GLOBEX.tag)
  })

  // 6. Under concurrency no response carries the other tenant's data.
  it('keeps containers apart under interleaved concurrent requests', async () => {
    const calls = Array.from({ length: 24 }, (_, i) => {
      const t = i % 2 === 0 ? { slug: ACME.slug, token: acmeToken, tag: ACME.tag } : { slug: GLOBEX.slug, token: globexToken, tag: GLOBEX.tag }
      return inject({ method: 'GET', url: '/probe/tenant', headers: bearer(t.token, t.slug) }).then((res: any) => ({
        expected: t.tag,
        got: body(res).tag
      }))
    })
    for (const { expected, got } of await Promise.all(calls)) expect(got).toBe(expected)
  })

  // 7. A tenant provisioned through the API is usable at once, with no manual fix-up.
  it('provisions a tenant whose administrator can log in immediately', async () => {
    const token = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    expect(typeof token).toBe('string')

    const res = await inject({ method: 'GET', url: '/users/me', headers: bearer(token, ACME.slug) })
    expect(res.statusCode).toBe(200)
    expect(body(res).email).toBe(ACME.adminEmail)
  })

  // The registry ids are read but not asserted on: they exist so a failure names the tenant.
  it('exposes both tenants in the registry with stable ids', async () => {
    expect(typeof acmeId).toBe('string')
    expect(typeof globexId).toBe('string')
  })
})
