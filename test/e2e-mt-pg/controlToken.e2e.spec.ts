/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Integration tokens of the control plane over HTTP on real Postgres, under both strategies.
//
// A machine that acts on the platform holds a row of the control plane's `token` table, issued by
// the superuser alone, with roles of the system catalogue and never `system:admin`. Its bearer is
// labelled as an integration token and signed for the control plane, so it is refused inside a
// tenant, and a tenant's credential is refused on the platform. The label alone says where a
// subject is looked up, on either plane: among the tokens with it, among the persons without it.
// What the rows say is checked from outside, with plain `pg`.
//
import { expect } from 'expect'
import { setup, teardown, inject, app, systemToken, createTenant, login, staled, sql, bearer, ACME, SYSTEM } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const ACTS = ['token.created', 'token.updated', 'token.reissued', 'token.blocked', 'token.unblocked', 'token.deleted']

for (const strategy of ['schema', 'container'] as const) {
  describe(`Integration tokens of the control plane, with tenants in a ${strategy === 'schema' ? 'schema' : 'database'} each (T-18.1)`, function () {
    this.timeout(60000)

    let system: string
    let operator: { id: string; externalId: string }
    let acme: any
    let acmeAdmin: string

    const as = (token: string) => (method: string, url: string, payload?: unknown) =>
      inject({ method, url, headers: bearer(token), ...(payload === undefined ? {} : { payload }) })
    const issue = async (payload: Record<string, unknown>) => {
      const res = await as(system)('POST', '/system/tokens', { expiresAt: null, ...payload })
      expect(res.statusCode).toBe(200)
      return body(res)
    }
    const probe = (headers: ReturnType<typeof bearer>) => inject({ method: 'GET', url: '/probe/platform', headers })
    const controlLog = async (actions: string[]) =>
      (await sql().query('select * from governance_log where action = any($1) order by occurred_at, id', [actions])).rows

    before(async () => {
      await setup({}, { strategy })
      system = await systemToken()
      acme = await createTenant(system, ACME)
      acmeAdmin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      const [row] = (await sql().query('select id, external_id from "system_user" where email = $1', [SYSTEM.email])).rows
      operator = { id: row.id, externalId: row.external_id }
    })

    after(async () => await teardown())

    it('takes the capabilities the project declared, and drops at boot a role naming one nobody declared', () => {
      expect(global.systemCapabilities).toContain('probe:platform')
      expect(Object.keys(global.systemRoles)).toContain('system:prober')
      expect(Object.keys(global.systemRoles)).not.toContain('system:misnamed')
    })

    it('issues a token of the control plane to the superuser, in the control table, never with system:admin', async () => {
      const machine = await issue({ name: 'sentinel', requiredRoles: ['system:prober', 'system:misnamed', 'admin'] })
      // Only the system catalogue, and no `public` default.
      expect(machine.roles).toEqual(['system:prober'])
      const { iat: _iat, ...claims } = app().jwt.decode(machine.token) as any
      expect(claims).toEqual({ sub: machine.externalId, typ: 'integration', scp: 'control' })
      const rows = (await sql().query('select id, roles from token where id = $1', [machine.id])).rows
      expect(rows).toEqual([{ id: machine.id, roles: ['system:prober'] }])
      expect(JSON.stringify(rows[0])).not.toContain(machine.token)

      const sovereign = await as(system)('POST', '/system/tokens', { name: 'root', expiresAt: null, requiredRoles: ['system:admin'] })
      expect([sovereign.statusCode, body(sovereign).code]).toEqual([403, 'TOKEN_ROLE_FORBIDDEN'])
      const promoted = await as(system)('PUT', `/system/tokens/${machine.id}`, { roles: ['system:admin'] })
      expect([promoted.statusCode, body(promoted).code]).toEqual([403, 'TOKEN_ROLE_FORBIDDEN'])
      expect((await sql().query("select count(*)::int as n from token where name = 'root'")).rows[0].n).toBe(0)
    })

    it("changes a token's name and roles alone, the roles from its own plane's catalogue, on either plane", async () => {
      // The fields that have routes of their own, which a body reaching the row whole would rewrite.
      const smuggled = { blocked: false, deletedAt: null, externalId: 'chosen', expiresAt: '2099-01-01T00:00:00.000Z' }

      const machine = await issue({ name: 'labels', requiredRoles: ['system:prober'] })
      expect((await as(system)('POST', `/system/tokens/${machine.id}/block`, { reason: 'paused' })).statusCode).toBe(200)
      const changed = await as(system)('PUT', `/system/tokens/${machine.id}`, {
        name: 'renamed',
        roles: ['system:auditor', 'admin', 'public', 'invented'],
        ...smuggled
      })
      expect(changed.statusCode).toBe(200)
      const [row] = (await sql().query('select name, roles, blocked, deleted_at, external_id, expires_at from token where id = $1', [machine.id])).rows
      expect(row).toEqual({ name: 'renamed', roles: ['system:auditor'], blocked: true, deleted_at: null, external_id: machine.externalId, expires_at: null })

      const tenant = (method: string, url: string, payload?: unknown) =>
        inject({ method, url, headers: bearer(acmeAdmin, ACME.slug), ...(payload === undefined ? {} : { payload }) })
      const own = body(await tenant('POST', '/token', { name: 'tenant-labels', expiresAt: null }))
      expect((await tenant('PUT', `/token/${own.id}`, { roles: ['system:prober', 'invented'], ...smuggled })).statusCode).toBe(200)
      expect(body(await tenant('GET', `/token/${own.id}`))).toMatchObject({ roles: ['public'], externalId: own.externalId, expiresAt: null })
      // The bearer still resolves to the row: its external id was not rewritten.
      expect((await inject({ method: 'GET', url: '/probe/subject', headers: bearer(own.token, ACME.slug) })).statusCode).toBe(200)
    })

    it('lets a machine reach the control route its capability opens, and no other', async () => {
      const machine = await issue({ name: 'prober', requiredRoles: ['system:prober'] })
      const opened = await probe(bearer(machine.token))
      expect(opened.statusCode).toBe(200)
      expect(body(opened)).toEqual({ systemUser: null, token: machine.id })

      // `governance-log` is a capability the role does not hold; the tokens are the superuser's.
      expect((await as(machine.token)('GET', '/system/governance-log')).statusCode).toBe(403)
      const minting = await as(machine.token)('POST', '/system/tokens', { name: 'child', expiresAt: null })
      expect([minting.statusCode, body(minting).code]).toEqual([403, 'FORBIDDEN'])
    })

    it("refuses the platform's token inside a tenant, and a tenant's credential on the platform", async () => {
      const machine = await issue({ name: 'outsider', requiredRoles: ['system:prober'] })
      const inside = await inject({ method: 'GET', url: '/probe/subject', headers: bearer(machine.token, ACME.slug) })
      expect([inside.statusCode, body(inside).code]).toEqual([403, 'SCOPE_MISMATCH'])

      const minted = await as(acmeAdmin)('POST', '/token', { name: 'tenant-machine', expiresAt: null })
      expect(minted.statusCode).toBe(200)
      for (const credential of [body(minted).token, acmeAdmin]) {
        const res = await probe(bearer(credential))
        expect([res.statusCode, body(res).code]).toEqual([403, 'SCOPE_MISMATCH'])
      }
    })

    it('refuses a blocked, a removed or a reissued bearer from the next request', async () => {
      const machine = await issue({ name: 'revocable', requiredRoles: ['system:prober'] })
      expect((await probe(bearer(machine.token))).statusCode).toBe(200)

      expect((await as(system)('POST', `/system/tokens/${machine.id}/block`, { reason: 'leaked' })).statusCode).toBe(200)
      const blocked = await probe(bearer(machine.token))
      expect([blocked.statusCode, body(blocked).code]).toEqual([403, 'TOKEN_NOT_VALID'])
      expect((await as(system)('POST', `/system/tokens/${machine.id}/unblock`)).statusCode).toBe(200)
      expect((await probe(bearer(machine.token))).statusCode).toBe(200)

      const reissued = await as(system)('POST', `/system/tokens/${machine.id}/reissue`)
      expect(reissued.statusCode).toBe(200)
      expect((await probe(bearer(machine.token))).statusCode).toBe(404)
      expect((await probe(bearer(body(reissued).token))).statusCode).toBe(200)

      expect((await as(system)('DELETE', `/system/tokens/${machine.id}`)).statusCode).toBe(200)
      const removed = await probe(bearer(body(reissued).token))
      expect([removed.statusCode, body(removed).code]).toEqual([403, 'TOKEN_NOT_VALID'])
    })

    it('asks a session not confirmed lately to confirm before issuing, changing, reissuing or unblocking, never before blocking or removing', async () => {
      const target = await issue({ name: 'guarded', requiredRoles: ['system:prober'] })
      const stale = as(staled(system).token)
      const before = (await controlLog(ACTS)).length
      for (const [method, url, payload] of [
        ['POST', '/system/tokens', { name: 'never', expiresAt: null }],
        ['PUT', `/system/tokens/${target.id}`, { name: 'never' }],
        ['POST', `/system/tokens/${target.id}/reissue`, undefined],
        ['POST', `/system/tokens/${target.id}/unblock`, undefined]
      ] as const) {
        const res = await stale(method, url, payload)
        expect([method, url, res.statusCode, body(res).code]).toEqual([method, url, 403, 'STEP_UP_REQUIRED'])
      }
      expect((await controlLog(ACTS)).length).toBe(before)
      expect((await stale('POST', `/system/tokens/${target.id}/block`, { reason: 'incident' })).statusCode).toBe(200)
      expect((await stale('DELETE', `/system/tokens/${target.id}`)).statusCode).toBe(200)
    })

    it("writes every act in the control plane's governance log, by its operator, and in no tenant's", async () => {
      const machine = await issue({ name: 'audited', requiredRoles: ['system:prober'] })
      const by = as(system)
      expect((await by('PUT', `/system/tokens/${machine.id}`, { name: 'audited-renamed' })).statusCode).toBe(200)
      expect((await by('POST', `/system/tokens/${machine.id}/reissue`)).statusCode).toBe(200)
      expect((await by('POST', `/system/tokens/${machine.id}/block`, { reason: 'rotation' })).statusCode).toBe(200)
      expect((await by('POST', `/system/tokens/${machine.id}/unblock`)).statusCode).toBe(200)
      expect((await by('DELETE', `/system/tokens/${machine.id}`)).statusCode).toBe(200)

      const rows = (await controlLog(ACTS)).filter((r: any) => r.target_id === machine.id)
      expect(rows.map((r: any) => r.action)).toEqual(ACTS)
      for (const row of rows) {
        expect(row).toMatchObject({ outcome: 'success', actor_id: operator.id, actor_kind: 'system_user', tenant_id: null })
      }
      expect(rows[0].detail).toEqual({ roles: ['system:prober'], expiresAt: null })
    })

    it('names a control token as the author of what it does on the platform', async () => {
      const machine = await issue({ name: 'provisioner', requiredRoles: ['system:operator'] })
      const renamed = await as(machine.token)('PUT', `/tenants/${acme.id}`, { name: 'Acme by a machine' })
      expect(renamed.statusCode).toBe(200)
      const [row] = (await controlLog(['tenant.updated'])).filter((r: any) => r.tenant_id === acme.id).slice(-1)
      expect(row).toMatchObject({ actor_id: machine.id, actor_kind: 'token' })
    })

    it('looks a labelled credential up among the tokens alone and any other among the persons alone, on either plane', async () => {
      const machine = await issue({ name: 'labelled', requiredRoles: ['system:prober'] })
      const sign = (claims: Record<string, unknown>) => bearer(app().jwt.sign(claims))
      // A session's subject is the person's external id.
      const admin = (app().jwt.decode(acmeAdmin) as any).sub
      const tenantMachine = body(await as(acmeAdmin)('POST', '/token', { name: 'labelled-tenant', expiresAt: null }))

      // The platform: a token's subject without the label is no person, a person's with it is no token.
      for (const claims of [
        { sub: machine.externalId, scp: 'control' },
        { sub: operator.externalId, scp: 'control', typ: 'integration' }
      ]) {
        const res = await probe(sign(claims))
        expect([claims, res.statusCode, body(res).code]).toEqual([claims, 404, 'SUBJECT_NOT_FOUND'])
      }

      // A tenant, the same rule.
      for (const claims of [
        { sub: tenantMachine.externalId, tid: acme.id },
        { sub: admin, tid: acme.id, typ: 'integration' }
      ]) {
        const res = await inject({ method: 'GET', url: '/probe/subject', headers: sign(claims) })
        expect([claims, res.statusCode, body(res).code]).toEqual([claims, 404, 'SUBJECT_NOT_FOUND'])
      }
    })

    it('resolves a session opened with the session registry off among the persons, which carries no session number', async () => {
      const saved = process.env.JWT_REFRESH
      process.env.JWT_REFRESH = 'false'
      try {
        const platform = await systemToken()
        const tenant = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
        expect(app().jwt.decode(platform)).not.toHaveProperty('sid')
        expect(app().jwt.decode(tenant)).not.toHaveProperty('sid')
        const me = await as(platform)('GET', '/system/auth/me')
        expect(me.statusCode).toBe(200)
        const subject = await inject({ method: 'GET', url: '/probe/subject', headers: bearer(tenant) })
        expect(subject.statusCode).toBe(200)
        expect(body(subject).user).toEqual(expect.any(String))
      } finally {
        if (saved === undefined) delete process.env.JWT_REFRESH
        else process.env.JWT_REFRESH = saved
      }
    })

    it('reads a token in one query, and never among the persons, in bearer mode', async () => {
      const machine = await issue({ name: 'counted', requiredRoles: ['system:prober'] })
      const reads = { token: 0, user: 0, systemUser: 0 }
      const spy = (manager: any, method: string, key: keyof typeof reads) => {
        const original = manager[method]
        manager[method] = async (...args: unknown[]) => {
          reads[key]++
          return original.apply(manager, args)
        }
        return () => (manager[method] = original)
      }
      const restore = [
        spy(app().tokenManager, 'retrieveTokenByExternalId', 'token'),
        spy(app().userManager, 'retrieveUserByExternalId', 'user'),
        spy(app().systemUserManager, 'retrieveSystemUserByExternalId', 'systemUser')
      ]
      try {
        expect((await probe(bearer(machine.token))).statusCode).toBe(200)
        expect(reads).toEqual({ token: 1, user: 0, systemUser: 0 })
      } finally {
        for (const undo of restore) undo()
      }
    })

    // The app boots in bearer mode and registers no cookie reader, so a token planted in a cookie
    // is proven in test/lib/authChannels.spec.ts.
    it('in cookie mode takes the token from the header and no session from there', async () => {
      const machine = await issue({ name: 'cookie-mode', requiredRoles: ['system:prober'] })
      const saved = process.env.AUTH_MODE
      process.env.AUTH_MODE = 'COOKIE'
      try {
        expect((await probe(bearer(machine.token))).statusCode).toBe(200)
        for (const session of [system, acmeAdmin]) {
          const res = await probe(bearer(session))
          expect([res.statusCode, body(res).code]).toEqual([401, 'CREDENTIAL_CHANNEL'])
        }
      } finally {
        process.env.AUTH_MODE = saved
      }
    })
  })
}
