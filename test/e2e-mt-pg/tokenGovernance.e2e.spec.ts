/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The acts on integration tokens over HTTP on real Postgres, under both strategies: each is
// written in the governance log of the tenant the token lives in, by the admin who made it, and in
// no other log; each tenant's admin reads its own log and no other; a session not confirmed lately
// confirms before a token is created, changed, reissued or unblocked, never before one is blocked
// or removed. What the rows say is checked from outside, with plain `pg`.
//
import { expect } from 'expect'
import { setup, teardown, inject, systemToken, createTenant, login, staled, sql, bearer, inTenantDatabase, ACME, GLOBEX } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const ACTS = ['token.created', 'token.updated', 'token.reissued', 'token.blocked', 'token.unblocked', 'token.deleted']
/** A role of the consumer that manages the tenant's tokens, so a machine can reach the routes. */
const INTEGRATOR = { code: 'integrator', name: 'Integrator', description: 'manages integration tokens', capabilities: ['tokens'] }

for (const strategy of ['schema', 'container'] as const) {
  describe(`The acts on integration tokens, in the tenant's own governance log, a ${strategy === 'schema' ? 'schema' : 'database'} each (T-18.2)`, function () {
    this.timeout(60000)

    let acmeAdmin: string
    let globexAdmin: string
    let acmeId: string
    let system: string

    /** A query on a container from outside the application, its unqualified names resolved there. */
    const inContainer = async (locator: string, text: string, params: unknown[] = []) => {
      if (strategy === 'container') return (await inTenantDatabase(locator, (c) => c.query(text, params))).rows
      const client = await sql().connect()
      try {
        await client.query('begin')
        await client.query(`set local search_path to "${locator}"`)
        const { rows } = await client.query(text, params)
        await client.query('commit')
        return rows
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    }
    const logOf = (locator: string) => inContainer(locator, 'select * from governance_log order by occurred_at, id')
    const as = (token: string, slug: string) => (method: string, url: string, payload?: unknown) =>
      inject({ method, url, headers: bearer(token, slug), ...(payload === undefined ? {} : { payload }) })

    before(async () => {
      await setup({}, { strategy, roles: [INTEGRATOR] })
      system = await systemToken()
      acmeId = (await createTenant(system, ACME)).id
      await createTenant(system, GLOBEX)
      acmeAdmin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      globexAdmin = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)
    })

    after(async () => await teardown())

    it("writes every act on a token in its tenant's log, by its admin, and in no other log", async () => {
      const acme = as(acmeAdmin, ACME.slug)
      const created = await acme('POST', '/token', { name: 'ci', expiresAt: null })
      expect(created.statusCode).toBe(200)
      const minted = body(created)
      expect((await acme('PUT', `/token/${minted.id}`, { name: 'ci-renamed' })).statusCode).toBe(200)
      const again = await acme('POST', `/token/${minted.id}/reissue`)
      expect(again.statusCode).toBe(200)
      expect((await acme('POST', `/token/${minted.id}/block`, { reason: 'leaked' })).statusCode).toBe(200)
      expect((await acme('POST', `/token/${minted.id}/unblock`)).statusCode).toBe(200)
      expect((await acme('DELETE', `/token/${minted.id}`)).statusCode).toBe(200)
      // Removed already: the log keeps the one removal there was.
      expect((await acme('DELETE', `/token/${minted.id}`)).statusCode).toBe(200)

      const [admin] = await inContainer(ACME.locator, 'select id from "user" where email = $1', [ACME.adminEmail])
      const rows = await logOf(ACME.locator)
      expect(rows.map((r: any) => r.action)).toEqual(ACTS)
      for (const row of rows) {
        expect(row).toMatchObject({ outcome: 'success', actor_id: admin.id, actor_plane: 'tenant', tenant_id: null, target_id: minted.id })
      }
      expect(rows.map((r: any) => r.detail)).toEqual([
        { roles: ['public'], expiresAt: null },
        { requested: ['name'] },
        null,
        { reason: 'leaked' },
        null,
        null
      ])
      for (const credential of [minted.token, body(again).token]) expect(JSON.stringify(rows)).not.toContain(credential)

      expect(await logOf(GLOBEX.locator)).toEqual([])
      expect((await sql().query(`select action from public.governance_log where action like 'token.%'`)).rows).toEqual([])
    })

    it("lets each tenant's admin read its own log, and nobody else", async () => {
      const own = await as(acmeAdmin, ACME.slug)('GET', '/governance-log')
      expect(own.statusCode).toBe(200)
      expect(body(own).map((r: any) => r.action).sort()).toEqual([...ACTS].sort())
      expect(body(own)[0]).toMatchObject({ outcome: 'success', actorPlane: 'tenant', targetId: expect.any(String) })
      expect(body(await as(acmeAdmin, ACME.slug)('GET', '/governance-log/count?action=token.blocked'))).toBe(1)
      expect(body(await as(globexAdmin, GLOBEX.slug)('GET', '/governance-log'))).toEqual([])

      // A session of one tenant naming another is refused before any container opens.
      const across = await as(acmeAdmin, GLOBEX.slug)('GET', '/governance-log')
      expect([across.statusCode, body(across).code]).toEqual([403, 'TENANT_MISMATCH'])

      // A member of the tenant without the capability reads nothing.
      const member = { email: 'member@acme.test', password: 'Member-pw-12345' }
      expect((await as(acmeAdmin, ACME.slug)('POST', '/users', member)).statusCode).toBe(200)
      await inContainer(ACME.locator, 'update "user" set confirmed = true where email = $1', [member.email])
      const user = await login(ACME.slug, member.email, member.password)
      for (const url of ['/governance-log', '/governance-log/count']) {
        const refused = await as(user, ACME.slug)('GET', url)
        expect([refused.statusCode, body(refused).code]).toEqual([403, 'FORBIDDEN'])
      }
    })

    it('asks a session not confirmed lately to confirm before a token is created, changed, reissued or unblocked, and never before one is taken away', async () => {
      const fresh = as(acmeAdmin, ACME.slug)
      const target = body(await fresh('POST', '/token', { name: 'target', expiresAt: null }))
      expect((await fresh('POST', `/token/${target.id}/block`, { reason: 'paused' })).statusCode).toBe(200)
      const before = (await logOf(ACME.locator)).length

      const stale = as(staled(acmeAdmin).token, ACME.slug)
      for (const [method, url, payload] of [
        ['POST', '/token', { name: 'never', expiresAt: null }],
        ['PUT', `/token/${target.id}`, { name: 'never' }],
        ['POST', `/token/${target.id}/reissue`, undefined],
        ['POST', `/token/${target.id}/unblock`, undefined]
      ] as const) {
        const res = await stale(method, url, payload)
        expect([method, url, res.statusCode, body(res).code]).toEqual([method, url, 403, 'STEP_UP_REQUIRED'])
      }
      expect((await logOf(ACME.locator)).length).toBe(before)

      expect((await stale('POST', `/token/${target.id}/block`, { reason: 'again' })).statusCode).toBe(200)
      expect((await stale('DELETE', `/token/${target.id}`)).statusCode).toBe(200)
      expect((await logOf(ACME.locator)).slice(before).map((r: any) => r.action)).toEqual(['token.blocked', 'token.deleted'])
    })

    it('never lets a token or an impersonation give a credential, and lets both take one away', async () => {
      const fresh = as(acmeAdmin, ACME.slug)
      const target = body(await fresh('POST', '/token', { name: 'target', expiresAt: null }))
      const machine = body(await fresh('POST', '/token', { name: 'machine', expiresAt: null, requiredRoles: [INTEGRATOR.code] }))
      expect(machine.roles).toContain(INTEGRATOR.code)

      const started = await inject({
        method: 'POST',
        url: `/tenants/${acmeId}/impersonate`,
        headers: bearer(system),
        payload: { userId: ACME.adminEmail, reason: 'token bench' }
      })
      expect(started.statusCode).toBe(200)
      const before = (await logOf(ACME.locator)).length

      for (const [who, credential] of [['token', machine.token], ['impersonation', body(started).token]] as const) {
        const by = as(credential, ACME.slug)
        for (const [method, url, payload] of [
          ['POST', '/token', { name: 'never', expiresAt: null }],
          ['PUT', `/token/${target.id}`, { name: 'never' }],
          ['POST', `/token/${target.id}/reissue`, undefined],
          ['POST', `/token/${target.id}/unblock`, undefined]
        ] as const) {
          const res = await by(method, url, payload)
          expect([who, method, url, res.statusCode, body(res).code]).toEqual([who, method, url, 403, 'STEP_UP_NOT_AVAILABLE'])
        }
      }
      expect((await logOf(ACME.locator)).length).toBe(before)

      expect((await as(machine.token, ACME.slug)('POST', `/token/${target.id}/block`, { reason: 'by a machine' })).statusCode).toBe(200)
      expect((await as(body(started).token, ACME.slug)('DELETE', `/token/${target.id}`)).statusCode).toBe(200)
      const acts = (await logOf(ACME.locator)).slice(before)
      expect(acts.map((r: any) => r.action)).toEqual(['token.blocked', 'token.deleted'])
      // Under an impersonation the act is the impersonated admin's, and the row says who was behind it.
      const [admin] = await inContainer(ACME.locator, 'select id from "user" where email = $1', [ACME.adminEmail])
      expect(acts[1]).toMatchObject({ actor_id: admin.id, actor_plane: 'tenant', detail: { impersonationId: expect.any(String) } })
    })

    it('does not make a change it cannot write down', async () => {
      const fresh = as(acmeAdmin, ACME.slug)
      const target = body(await fresh('POST', '/token', { name: 'kept', expiresAt: null }))
      const tokens = async () => (await inContainer(ACME.locator, 'select count(*)::int as n from token'))[0].n
      const count = await tokens()

      // The row has nowhere to go: the act fails, and the change it would have recorded is not made.
      await inContainer(ACME.locator, 'alter table governance_log rename to governance_log_away')
      try {
        expect((await fresh('POST', '/token', { name: 'unwritten', expiresAt: null })).statusCode).toBe(500)
        expect((await fresh('POST', `/token/${target.id}/block`, { reason: 'unwritten' })).statusCode).toBe(500)
      } finally {
        await inContainer(ACME.locator, 'alter table governance_log_away rename to governance_log')
      }
      expect(await tokens()).toBe(count)
      const [row] = await inContainer(ACME.locator, 'select blocked from token where id = $1', [target.id])
      expect(row.blocked).toBe(false)
    })
  })
}
