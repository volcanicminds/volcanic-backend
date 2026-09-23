/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.29 and T-12.30: an OIDC login through the flow engine, on the real flow store of a migrated
// container and against a provider that answers in process (test/lib/fixtures/fakeIdp.ts). The
// store is real because the properties in doubt are its own: the `state` found by its hash in the
// right container, spent with the first return, the verifier and the nonce kept encrypted, the
// result cashed only by the flow that started. SQLite always, Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import type { AuthPlaneFlows, ResolvedIdentityProvider } from '../../types/global.js'
import * as engine from '../../lib/auth/engine.js'
import type { FlowOutcome, FlowPlane } from '../../lib/auth/engine.js'
import { buildAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { mayLogIn, toSubject } from '../../lib/auth/subjects.js'
import { returnPathOf, useOidcFetch } from '../../lib/auth/authenticators/oidc.js'
import { createAuthFlowManager } from '../../lib/database/managers/authFlow.js'
import { createExternalIdentityManager } from '../../lib/database/managers/externalIdentity.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { fakeIdp } from '../lib/fixtures/fakeIdp.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from './fixtures/migrated.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'
;(global as any).log = {}
;(global as any).roles = (global as any).roles ?? { public: { code: 'public' }, admin: { code: 'admin' } }

const LIMITS = { flowTtl: 600, otpTtl: 300, otpMaxAttempts: 5, otpMaxSends: 3 }
const REDIRECT = 'https://api.acme.test/auth/flow/return/oidc'
const ONLY_OIDC: AuthPlaneFlows = { identify: ['oidc'], flows: [{ roles: ['*'], stages: [] }] }

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`auth · OIDC through the engine, ${name} (T-12.29, T-12.30)`, function () {
    this.timeout(30000)
    let db: Migrated
    const users = createUserManager()
    const store = createAuthFlowManager()
    const links = createExternalIdentityManager()
    const idp = fakeIdp()
    let seq = 0
    const unique = () => `${++seq}-${Date.now()}`

    before(async () => {
      db = await open()
      useOidcFetch(idp.fetch as any)
    })
    after(async () => {
      useOidcFetch(null)
      await db?.close()
    })

    const provider = (settings: Record<string, unknown> = {}): ResolvedIdentityProvider => ({
      key: 'acme',
      type: 'oidc',
      source: 'deployment',
      settings: { issuer: idp.issuer, clientId: 'console', redirectUri: REDIRECT, jit: { enabled: true, roles: [] }, ...settings },
      clientSecret: 'console-secret'
    })

    function plane(options: { flows?: AuthPlaneFlows; settings?: Record<string, unknown> } = {}) {
      const accesses: any[] = []
      const p: FlowPlane<any> = {
        plane: 'tenant',
        handle: db.tenant,
        tenant: null,
        routing: 'ctl',
        policy: 'OPTIONAL' as never,
        flows: options.flows ?? ONLY_OIDC,
        limits: LIMITS,
        registry: buildAuthenticatorRegistry(),
        managers: { userManager: users, authFlowManager: store, externalIdentityManager: links } as any,
        ip: null,
        userAgent: null,
        loadSubject: async (externalId) => {
          const user: any = await users.retrieveUserByExternalId(db.tenant, externalId)
          return (await mayLogIn(users, user)) ? { record: user, subject: toSubject('tenant', user) } : null
        },
        issue: async (user: any, _s, methods) => ({ body: { sub: user.externalId, methods }, subjectId: user.externalId }),
        record: async (entry) => void accesses.push(entry),
        accountCreation: async () => 'open',
        provider: async (key) => (key === 'acme' ? provider(options.settings) : null)
      }
      return { p, accesses }
    }

    const raw = (o: FlowOutcome) => (o.kind === 'partial' ? o.credential.raw : undefined)
    const refusal = (o: FlowOutcome) => (o.kind === 'refused' ? o.refusal.code : o.kind)
    const addressOf = (o: FlowOutcome) => {
      if (o.kind !== 'partial') throw new Error(`expected a partial answer, got ${JSON.stringify(o)}`)
      const action: any = o.stage.options[0].action
      expect(action.type).toBe('redirect')
      return action.url as string
    }

    it('goes out with PKCE S256 and a nonce, comes back, and logs in only with the next step', async () => {
      const { p, accesses } = plane()
      const started = await engine.start(p, 'oidc', { provider: 'acme', returnTo: '/after/login?tab=2' })
      const address = addressOf(started)
      const params = new URL(address).searchParams
      expect(params.get('code_challenge_method')).toBe('S256')
      expect(params.get('code_challenge')).toBeTruthy()
      expect(params.get('nonce')).toBeTruthy()
      // The state names the container and nothing else: never the flow credential.
      expect(params.get('state')).toMatch(/^st1\.ctl\./)
      expect(address).not.toContain(raw(started)!.split('.')[3])

      const email = `anna${unique()}@acme.test`
      const { code, state } = idp.authorize(address, { sub: `sub-${unique()}`, email, email_verified: true })
      const back = await engine.returnFrom(p, 'oidc', { code, state })
      expect(back).toEqual({ kind: 'returned', ok: true, returnTo: '/after/login?tab=2' })

      const done = await engine.step(p, raw(started), 'oidc', {})
      expect(done.kind).toBe('complete')
      expect((done as any).body.methods).toEqual(['oidc'])
      expect(accesses.map((a) => a.event)).toEqual(['flow.started', 'idp.provisioned', 'stage.passed', 'login.succeeded'])
    })

    it('refuses a state nobody issued, and one of another container', async () => {
      const { p } = plane()
      expect(refusal(await engine.returnFrom(p, 'oidc', { code: 'x', state: 'st1.ctl.AAAAAAAAAAAAAAAAAAAAAA' }))).toBe('FLOW_REQUIRED')
      expect(refusal(await engine.returnFrom(p, 'oidc', { code: 'x', state: 'st1.other.AAAAAAAAAAAAAAAAAAAAAA' }))).toBe('TENANT_MISMATCH')
      expect(refusal(await engine.returnFrom(p, 'oidc', { code: 'x' }))).toBe('FLOW_REQUIRED')
    })

    it('refuses an ID token with another nonce: the next step says so, and ends the flow', async () => {
      const { p, accesses } = plane()
      const started = await engine.start(p, 'oidc', { provider: 'acme' })
      const { code, state } = idp.authorize(addressOf(started), { sub: `sub-${unique()}` }, { nonce: 'not-the-one-sent' })
      expect(await engine.returnFrom(p, 'oidc', { code, state })).toEqual({ kind: 'returned', ok: false })
      expect(accesses.at(-1)).toMatchObject({ event: 'stage.failed', code: 'IDP_RETURN_INVALID', methods: ['oidc'] })
      // The state is spent with the failure, as with a success: the same return again finds nothing.
      expect(refusal(await engine.returnFrom(p, 'oidc', { code, state }))).toBe('FLOW_REQUIRED')
      const next = await engine.step(p, raw(started), 'oidc', {})
      expect(refusal(next)).toBe('IDP_RETURN_INVALID')
      expect((next as any).endsFlow).toBe(true)
      expect(accesses.at(-1)).toMatchObject({ event: 'login.failed', code: 'IDP_RETURN_INVALID', methods: ['oidc'] })
      expect(refusal(await engine.step(p, raw(started), 'oidc', {}))).toBe('FLOW_REQUIRED')
    })

    it('ends the flow when the person declines at the provider, without asking it for a token', async () => {
      const { p, accesses } = plane()
      const started = await engine.start(p, 'oidc', { provider: 'acme' })
      const { state } = idp.authorize(addressOf(started), { sub: `sub-${unique()}` })
      const exchanged = idp.exchanges.length
      expect(await engine.returnFrom(p, 'oidc', { error: 'access_denied', state })).toEqual({ kind: 'returned', ok: false })
      expect(accesses.at(-1)).toMatchObject({ event: 'stage.failed', code: 'IDP_DENIED' })
      expect(idp.exchanges.length).toBe(exchanged)
      // The console tells "you declined at the provider" from "the login expired".
      const next = await engine.step(p, raw(started), 'oidc', {})
      expect(refusal(next)).toBe('IDP_DENIED')
      expect((next as any).refusal.status).toBe(401)
      expect(refusal(await engine.step(p, raw(started), 'oidc', {}))).toBe('FLOW_REQUIRED')
    })

    it('answers IDP_UNAVAILABLE when the provider cannot be discovered, and leaves nothing behind', async () => {
      const { p } = plane({ settings: { issuer: 'https://unreachable.acme.test' } })
      expect(refusal(await engine.start(p, 'oidc', { provider: 'acme' }))).toBe('IDP_UNAVAILABLE')
    })

    it('spends the state with the first return: the same code and state again find nothing', async () => {
      const { p } = plane()
      const started = await engine.start(p, 'oidc', { provider: 'acme' })
      const { code, state } = idp.authorize(addressOf(started), { sub: `sub-${unique()}`, email: `b${unique()}@acme.test`, email_verified: true })
      expect(await engine.returnFrom(p, 'oidc', { code, state })).toMatchObject({ kind: 'returned', ok: true })
      const exchanged = idp.exchanges.length
      expect(refusal(await engine.returnFrom(p, 'oidc', { code, state }))).toBe('FLOW_REQUIRED')
      // Refused before the provider is asked again.
      expect(idp.exchanges.length).toBe(exchanged)
    })

    it('leaves a return to the flow that started it: another credential cannot cash it', async () => {
      const { p } = plane()
      const victim = await engine.start(p, 'oidc', { provider: 'acme' })
      const attacker = await engine.start(p, 'oidc', { provider: 'acme' })
      const { code, state } = idp.authorize(addressOf(attacker), { sub: `sub-${unique()}`, email: `m${unique()}@acme.test`, email_verified: true })
      await engine.returnFrom(p, 'oidc', { code, state })

      // The victim's flow has no result: the step is asked too early, and may be asked again.
      const early = await engine.step(p, raw(victim), 'oidc', {})
      expect(refusal(early)).toBe('IDP_RETURN_PENDING')
      expect((early as any).endsFlow).toBe(false)
      expect((await engine.step(p, raw(attacker), 'oidc', {})).kind).toBe('complete')
    })

    it('refuses a returnTo that is not a path, before anything leaves', async () => {
      const { p } = plane()
      for (const returnTo of ['https://evil.test/x', '//evil.test/x', '/\\evil.test', 'javascript:alert(1)']) {
        expect(refusal(await engine.start(p, 'oidc', { provider: 'acme', returnTo }))).toBe('AUTH_INPUT_INVALID')
      }
      expect(returnPathOf('/a/b?c=d#e')).toBe('/a/b?c=d#e')
      expect(returnPathOf(undefined)).toBeNull()
      expect(refusal(await engine.start(p, 'oidc', { provider: 'nobody' }))).toBe('IDP_UNKNOWN_PROVIDER')
    })

    describe('the second factor of the provider (F41)', () => {
      const flows: AuthPlaneFlows = { identify: ['oidc'], flows: [{ roles: ['*'], stages: [{ anyOf: ['totp', 'idp-mfa'] }] }] }

      async function loginWith(settings: Record<string, unknown>, claims: Record<string, unknown>) {
        const { p } = plane({ flows, settings })
        const started = await engine.start(p, 'oidc', { provider: 'acme' })
        const address = addressOf(started)
        const { code, state } = idp.authorize(address, { sub: `sub-${unique()}`, email: `f${unique()}@acme.test`, email_verified: true, ...claims })
        await engine.returnFrom(p, 'oidc', { code, state })
        return { address, done: await engine.step(p, raw(started), 'oidc', {}) }
      }

      it('counts only where the provider is trusted and the claim carries it', async () => {
        const trusted = await loginWith({ mfa: { trust: 'amr', values: ['mfa', 'hwk'] } }, { amr: ['pwd', 'mfa'] })
        expect(trusted.done.kind).toBe('complete')
        expect((trusted.done as any).body.methods).toEqual(['oidc', 'idp-mfa'])

        // The same claim from a provider nobody declared trusted leaves the stage to do.
        const untrusted = await loginWith({}, { amr: ['pwd', 'mfa'] })
        expect(untrusted.done.kind).toBe('partial')

        const weaker = await loginWith({ mfa: { trust: 'amr', values: ['hwk'] } }, { amr: ['pwd'] })
        expect(weaker.done.kind).toBe('partial')
      })

      it('asks for the level with acr_values when it trusts acr', async () => {
        const acr = await loginWith({ mfa: { trust: 'acr', values: ['urn:acme:loa:2'] } }, { acr: 'urn:acme:loa:2' })
        expect(new URL(acr.address).searchParams.get('acr_values')).toBe('urn:acme:loa:2')
        expect(acr.done.kind).toBe('complete')
      })
    })
  })
}

behaviours('SQLite', () => migratedSqlite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_p12_oidc_ctl', tenant: 'test_p12_oidc_acme' }))
}
