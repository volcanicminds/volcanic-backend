/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.39: the login flow across containers, on real Postgres.
//
// Phase 12 put three new kinds of row inside the tenant's container: the flow of a login in
// progress, the link between an account and an identity at a provider, and the access log. The
// return from a provider arrives with no token and, with the header resolver, no header, so the
// only thing that names its container is the flow `state`. If any of that addressing were wrong the
// damage would be silent: a flow of one customer cashed in another's schema, or one customer's
// provider answering for an account of another.
//
// As in the rest of this bench, the properties are observed from outside: what the client gets
// over HTTP, and what a plain `pg` connection sees in each schema. The providers are two in-process
// issuers (test/lib/fixtures/fakeIdp.ts): the only network these tests use is the database's.
//
import { expect } from 'expect'
import { useOidcFetch } from '../../lib/auth/authenticators/oidc.js'
import { fakeIdp } from '../lib/fixtures/fakeIdp.js'
import { setup, teardown, inject, systemToken, createTenant, sql, bearer, ACME, GLOBEX, HEADER, SYSTEM } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const REDIRECT = 'https://api.bench.test/auth/flow/return/oidc'
// The same `sub` at both providers: unique per issuer only, which is the point of the fourth test.
const SAME_SUB = 'same-sub-at-two-providers'

const rowsIn = async (schema: string, table: string, where = 'true') =>
  (await sql().query(`select * from "${schema}"."${table}" where ${where}`)).rows as any[]

const flowStart = (slug: string, payload: any) => inject({ method: 'POST', url: '/auth/flow/start', headers: { [HEADER]: slug }, payload })

describe('The login flow across containers on real Postgres (T-12.39)', function () {
  this.timeout(60000)

  const acmeIdp = fakeIdp('https://idp.acme.test')
  const globexIdp = fakeIdp('https://idp.globex.test')
  let tenants: Record<string, any>

  before(async () => {
    // One `fetch` for the two issuers, routed by origin as a network would.
    useOidcFetch(((url: string, init?: RequestInit) =>
      (new URL(url).origin === acmeIdp.issuer ? acmeIdp : globexIdp).fetch(url, init)) as any)
    await setup()
    const system = await systemToken()
    tenants = { [ACME.slug]: await createTenant(system, ACME), [GLOBEX.slug]: await createTenant(system, GLOBEX) }

    // Each tenant its own provider, linking by a verified address of its own domain.
    for (const [t, idp, domain] of [
      [ACME, acmeIdp, 'acme.test'],
      [GLOBEX, globexIdp, 'globex.test']
    ] as const) {
      const res = await inject({
        method: 'POST',
        url: `/tenants/${tenants[t.slug].id}/identity-providers`,
        headers: bearer(system),
        payload: {
          key: 'sso',
          type: 'oidc',
          config: { issuer: idp.issuer, clientId: t.slug, redirectUri: REDIRECT, linkByEmail: true, emailDomains: [domain] },
          clientSecret: `${t.slug}-secret`
        }
      })
      if (res.statusCode !== 201) throw new Error(`provider for ${t.slug} failed (${res.statusCode}): ${res.body}`)
    }
  })

  after(async () => {
    useOidcFetch(null)
    await teardown()
  })

  /** Starts an OIDC login on `slug` and plays the browser at the provider: the flow credential and the return. */
  async function toProvider(slug: string, idp: ReturnType<typeof fakeIdp>, email: string) {
    const started = await flowStart(slug, { method: 'oidc', provider: 'sso' })
    expect(started.statusCode).toBe(202)
    const { flow, stage } = body(started)
    const { code, state } = idp.authorize(stage.options[0].action.url, { sub: SAME_SUB, email, email_verified: true })
    return { flow: flow as string, code, state }
  }

  it('keeps the flow row and the access log of a tenant inside its container, and in no other', async () => {
    const acmeFlows = (await rowsIn(ACME.locator, 'auth_flow')).length
    const globexFlows = (await rowsIn(GLOBEX.locator, 'auth_flow')).length
    const controlFlows = (await rowsIn('public', 'auth_flow')).length

    // The round trip opens a flow before anyone is known: the row must already be in acme's schema.
    await flowStart(ACME.slug, { method: 'oidc', provider: 'sso' })
    expect((await rowsIn(ACME.locator, 'auth_flow')).length).toBe(acmeFlows + 1)
    expect((await rowsIn(GLOBEX.locator, 'auth_flow')).length).toBe(globexFlows)
    expect((await rowsIn('public', 'auth_flow')).length).toBe(controlFlows)

    // A refused password login is written where the account would have lived.
    const refused = await flowStart(ACME.slug, { method: 'password', email: ACME.adminEmail, password: 'wrong-password-1' })
    expect(refused.statusCode).toBe(401)
    const failures = (schema: string) => rowsIn(schema, 'access_log', `event = 'login.failed'`)
    expect((await failures(ACME.locator)).length).toBeGreaterThan(0)
    expect(await failures(GLOBEX.locator)).toEqual([])
    expect((await rowsIn('public', 'access_log')).every((row) => row.scope === 'control')).toBe(true)
  })

  it("refuses acme's flow credential presented as globex, and the flow survives for acme", async () => {
    const { flow, code, state } = await toProvider(ACME.slug, acmeIdp, ACME.adminEmail)
    const step = (slug: string) => inject({ method: 'POST', url: '/auth/flow/step', headers: { [HEADER]: slug }, payload: { flow, method: 'oidc' } })

    const crossed = await step(GLOBEX.slug)
    expect(crossed.statusCode).toBe(403)
    expect(body(crossed).code).toBe('TENANT_MISMATCH')

    // Still acme's, and still waiting for its provider: the refusal cost the honest flow nothing.
    const waiting = await step(ACME.slug)
    expect([waiting.statusCode, body(waiting).code]).toEqual([409, 'IDP_RETURN_PENDING'])
    await inject({ method: 'GET', url: `/auth/flow/return/oidc?code=${code}&state=${encodeURIComponent(state)}` })
    const done = await step(ACME.slug)
    expect([done.statusCode, body(done).email]).toEqual([200, ACME.adminEmail])
  })

  it("refuses a return that carries acme's state and declares globex", async () => {
    const { code, state } = await toProvider(ACME.slug, acmeIdp, ACME.adminEmail)
    const url = `/auth/flow/return/oidc?code=${code}&state=${encodeURIComponent(state)}`

    const crossed = await inject({ method: 'GET', url, headers: { [HEADER]: GLOBEX.slug } })
    expect(crossed.statusCode).toBe(403)
    expect(body(crossed).code).toBe('TENANT_MISMATCH')
    // Refused before the provider was asked anything: the code was not spent.
    expect(acmeIdp.exchanges).not.toContain(code)
  })

  it('keeps the same `sub` at two tenants and two providers as two identities, each in its own container', async () => {
    for (const [t, idp] of [
      [ACME, acmeIdp],
      [GLOBEX, globexIdp]
    ] as const) {
      const { flow, code, state } = await toProvider(t.slug, idp, t.adminEmail)
      // The navigation back carries no header: the state alone names the container.
      const back = await inject({ method: 'GET', url: `/auth/flow/return/oidc?code=${code}&state=${encodeURIComponent(state)}` })
      expect(back.statusCode).toBe(303)
      const done = await inject({ method: 'POST', url: '/auth/flow/step', headers: { [HEADER]: t.slug }, payload: { flow, method: 'oidc' } })
      expect(done.statusCode).toBe(200)
      expect(body(done).email).toBe(t.adminEmail)

      // The session opens this tenant's container and no other.
      const probe = await inject({ method: 'GET', url: '/probe/tenant', headers: bearer(body(done).token, t.slug) })
      expect(body(probe).tag).toBe(t.tag)
    }

    const links = async (schema: string) => (await rowsIn(schema, 'external_identity', `subject = '${SAME_SUB}'`)).map((r) => r.issuer)
    expect(await links(ACME.locator)).toEqual([acmeIdp.issuer])
    expect(await links(GLOBEX.locator)).toEqual([globexIdp.issuer])
    expect(await rowsIn('public', 'external_identity')).toEqual([])
  })

  it('keeps the flow and the accesses of the platform in the control plane only', async () => {
    const tenantRows = async () => [
      ...(await rowsIn(ACME.locator, 'access_log', `scope = 'control'`)),
      ...(await rowsIn(GLOBEX.locator, 'access_log', `scope = 'control'`)),
      ...(await rowsIn(ACME.locator, 'auth_flow', `scope = 'control'`)),
      ...(await rowsIn(GLOBEX.locator, 'auth_flow', `scope = 'control'`))
    ]
    const before = (await rowsIn('public', 'access_log', `scope = 'control'`)).length

    const ok = await inject({ method: 'POST', url: '/system/auth/flow/start', payload: { method: 'password', email: SYSTEM.email, password: SYSTEM.password } })
    expect(ok.statusCode).toBe(200)
    const refused = await inject({ method: 'POST', url: '/system/auth/flow/start', payload: { method: 'password', email: SYSTEM.email, password: 'wrong-password-1' } })
    expect(refused.statusCode).toBe(401)

    const events = (await rowsIn('public', 'access_log', `scope = 'control'`)).map((r) => r.event)
    expect(events.length).toBe(before + 2)
    expect(events).toEqual(expect.arrayContaining(['login.succeeded', 'login.failed']))
    expect(await tenantRows()).toEqual([])
  })
})
