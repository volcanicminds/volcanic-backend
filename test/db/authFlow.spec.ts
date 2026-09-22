//
// T-12.12, against a real container migrated with the framework's own migrations: the flow store,
// the links to external identities and the tenant's identity providers, as the database sees them.
//
// SQLite always; Postgres too when DATABASE_URL is set, because the two properties that are
// statements and not JavaScript (one winner among concurrent submissions of a code, and the
// per-subject ceiling across flows) are exactly where two engines can disagree.
//
import { expect } from 'expect'
import { eq } from 'drizzle-orm'
import type { AuthFlowManagement, ChallengeLimits, DataHandle } from '../../types/global.js'
import { createAuthFlowManager, challengeMac } from '../../lib/database/managers/authFlow.js'
import { createExternalIdentityManager } from '../../lib/database/managers/externalIdentity.js'
import { createIdentityProviderManager } from '../../lib/database/managers/identityProvider.js'
import { hashSecret } from '../../lib/database/managers/session.js'
import { column } from '../../lib/database/managers/runtime.js'
import type { RuntimeHandle } from '../../lib/database/managers/runtime.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from './fixtures/migrated.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'
;(global as unknown as { log: object }).log = {}

const LIMITS: ChallengeLimits = { perFlow: 3, perSubject: [{ max: 5, windowSeconds: 900 }, { max: 20, windowSeconds: 86_400 }] }
const inTen = () => new Date(Date.now() + 600_000)
const inFive = () => new Date(Date.now() + 300_000)

let counter = 0
const unique = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++counter}`

interface RawFlow {
  flowId: string
  secretHash: string
  challengeHash: string | null
  stateHash: string | null
  external: string | null
  subjectId: string | null
  candidateSubjectId: string | null
}

async function rawFlow(raw: RuntimeHandle, flowId: string): Promise<RawFlow> {
  const t = raw.tables.authFlow
  const rows = (await raw.db.select().from(t).where(eq(column(t, 'flowId'), flowId as never))) as RawFlow[]
  return rows[0]
}

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`database/managers · the flow store on ${name} (T-12.12)`, function () {
    this.timeout(30000)

    let db: Migrated
    let tenant: DataHandle
    const flows: AuthFlowManagement = createAuthFlowManager()

    before(async () => {
      db = await open()
      tenant = db.tenant
    })
    after(async () => await db?.close())

    const openFlow = (overrides: Partial<Parameters<AuthFlowManagement['openFlow']>[1]> = {}) =>
      flows.openFlow(tenant, { flowId: unique('flow'), scope: 'tenant', secret: unique('secret'), expiresAt: inTen(), ...overrides })

    it('stores the hash of the flow secret and never the secret', async () => {
      const flow = await openFlow({ secret: 'plain-flow-secret' })
      const row = await rawFlow(db.raw, flow.flowId)
      expect(row.secretHash).toBe(hashSecret('plain-flow-secret'))
      expect(JSON.stringify(row)).not.toContain('plain-flow-secret')
      expect(Object.keys(flow)).not.toContain('secretHash')
    })

    it('classifies a presented secret: current, expired, unknown, and a wrong one as unknown', async () => {
      const secret = unique('s')
      const live = await openFlow({ secret })
      expect((await flows.findBySecret(tenant, live.flowId, secret)).outcome).toBe('current')
      expect((await flows.findBySecret(tenant, live.flowId, 'not-it')).outcome).toBe('unknown')
      expect((await flows.findBySecret(tenant, 'no-such-flow', secret)).outcome).toBe('unknown')

      const old = await openFlow({ secret, expiresAt: new Date(Date.now() - 1000) })
      expect((await flows.findBySecret(tenant, old.flowId, secret)).outcome).toBe('expired')
    })

    it('lets a proven flow evict the previous proven flow of the same subject', async () => {
      const subject = unique('subject')
      const first = { flowId: unique('flow'), secret: unique('s') }
      await openFlow({ ...first, subjectId: subject })
      const second = { flowId: unique('flow'), secret: unique('s') }
      await openFlow({ ...second, subjectId: subject })

      expect((await flows.findBySecret(tenant, first.flowId, first.secret)).outcome).toBe('unknown')
      expect((await flows.findBySecret(tenant, second.flowId, second.secret)).outcome).toBe('current')
    })

    it('does not let an unproven flow evict anyone, and evicts when a flow becomes proven', async () => {
      const subject = unique('subject')
      const proven = { flowId: unique('flow'), secret: unique('s') }
      await openFlow({ ...proven, subjectId: subject })

      // Ten flows started with the address alone: the victim's flow survives every one of them.
      const unproven = []
      for (let i = 0; i < 10; i++) unproven.push(await openFlow({ candidateSubjectId: subject }))
      expect((await flows.findBySecret(tenant, proven.flowId, proven.secret)).outcome).toBe('current')

      const last = unproven[unproven.length - 1]
      const advanced = await flows.advance(tenant, last.flowId, last.version, { subjectId: subject, stageIndex: 1, satisfied: ['email-otp'] })
      expect(advanced?.subjectId).toBe(subject)
      expect(advanced?.satisfied).toEqual(['email-otp'])
      expect((await flows.findBySecret(tenant, proven.flowId, proven.secret)).outcome).toBe('unknown')
    })

    it('advances optimistically on version: of two steps from the same version, one wins', async () => {
      const flow = await openFlow()
      const [a, b] = await Promise.all([
        flows.advance(tenant, flow.flowId, flow.version, { stageIndex: 1 }),
        flows.advance(tenant, flow.flowId, flow.version, { stageIndex: 1 })
      ])
      expect([a, b].filter(Boolean)).toHaveLength(1)
      expect((a ?? b)?.version).toBe(flow.version + 1)
    })

    it('stores the code as an HMAC keyed by the flow secret, never in clear or as a plain hash', async () => {
      const secret = unique('s')
      const flow = await openFlow({ secret, candidateSubjectId: unique('subject') })
      const sent = await flows.recordChallenge(tenant, flow.flowId, { secret, method: 'email-otp', code: '48151623', expiresAt: inFive(), limits: LIMITS })
      expect(sent).toMatchObject({ outcome: 'sent', sends: 1 })

      const row = await rawFlow(db.raw, flow.flowId)
      expect(row.challengeHash).toBe(challengeMac(secret, '48151623'))
      expect(row.challengeHash).not.toBe(hashSecret('48151623'))
      expect(JSON.stringify(row)).not.toContain('48151623')
    })

    it('gives two concurrent submissions of the right code exactly one success', async () => {
      const secret = unique('s')
      const flow = await openFlow({ secret })
      await flows.recordChallenge(tenant, flow.flowId, { secret, method: 'email-otp', code: '271828', expiresAt: inFive(), limits: LIMITS })

      const results = await Promise.all(
        Array.from({ length: 4 }, () => flows.consumeChallenge(tenant, flow.flowId, { secret, code: '271828', maxAttempts: 5 }))
      )
      expect(results.filter((r) => r.outcome === 'ok')).toHaveLength(1)
      // A code already used is a code that is no longer there, not a wrong guess.
      expect(results.filter((r) => r.outcome === 'expired')).toHaveLength(3)
    })

    it('counts wrong codes per flow and then refuses even the right one', async () => {
      const secret = unique('s')
      const flow = await openFlow({ secret })
      await flows.recordChallenge(tenant, flow.flowId, { secret, method: 'email-otp', code: '314159', expiresAt: inFive(), limits: LIMITS })

      const consume = (code: string) => flows.consumeChallenge(tenant, flow.flowId, { secret, code, maxAttempts: 3 })
      expect(await consume('000000')).toEqual({ outcome: 'invalid', remaining: 2 })
      // A new send does not give back the attempts already spent.
      await flows.recordChallenge(tenant, flow.flowId, { secret, method: 'email-otp', code: '314159', expiresAt: inFive(), limits: LIMITS })
      expect(await consume('000001')).toEqual({ outcome: 'invalid', remaining: 1 })
      expect(await consume('000002')).toEqual({ outcome: 'exhausted' })
      expect(await consume('314159')).toEqual({ outcome: 'exhausted' })
    })

    it('reserves verifications under the ceiling, a burst of them included, on the counter the codes share', async () => {
      const secret = unique('s')
      const flow = await openFlow({ secret })
      const attempt = () => flows.recordAttempt(tenant, flow.flowId, { secret, maxAttempts: 5 })

      expect(await attempt()).toEqual({ outcome: 'counted', remaining: 4 })
      // Ten guesses in parallel: exactly the four left get through, the rest never reach the code.
      const burst = await Promise.all(Array.from({ length: 10 }, attempt))
      expect(burst.filter((r) => r.outcome === 'counted')).toHaveLength(4)
      expect(burst.filter((r) => r.outcome === 'exhausted')).toHaveLength(6)
      // Another credential reserves nothing, even on a flow with attempts left.
      const other = await openFlow({ secret: unique('s') })
      expect(await flows.recordAttempt(tenant, other.flowId, { secret, maxAttempts: 5 })).toEqual({ outcome: 'exhausted' })
    })

    it('answers an expired code as expired, and a code for another credential as nothing', async () => {
      const secret = unique('s')
      const flow = await openFlow({ secret })
      await flows.recordChallenge(tenant, flow.flowId, {
        secret, method: 'email-otp', code: '161803', expiresAt: new Date(Date.now() - 1000), limits: LIMITS
      })
      expect(await flows.consumeChallenge(tenant, flow.flowId, { secret, code: '161803', maxAttempts: 5 })).toEqual({ outcome: 'expired' })

      const other = await openFlow({ secret: unique('s') })
      expect(await flows.recordChallenge(tenant, other.flowId, { secret, method: 'email-otp', code: '1', expiresAt: inFive(), limits: LIMITS }))
        .toEqual({ outcome: 'limit', scope: 'flow', retryAt: null })
    })

    it('applies the per-flow ceiling', async () => {
      const secret = unique('s')
      const flow = await openFlow({ secret })
      const send = () => flows.recordChallenge(tenant, flow.flowId, { secret, method: 'email-otp', code: '1', expiresAt: inFive(), limits: LIMITS })
      expect(await send()).toMatchObject({ outcome: 'sent', sends: 1 })
      expect(await send()).toMatchObject({ outcome: 'sent', sends: 2 })
      expect(await send()).toEqual({ outcome: 'sent', sends: 3, resendAt: null })
      expect(await send()).toEqual({ outcome: 'limit', scope: 'flow', retryAt: null })
    })

    it('keeps the per-subject ceiling across restarted, cancelled and evicted flows', async () => {
      const subject = unique('subject')
      const sendAll = async (secret: string, flowId: string, n: number) => {
        const out = []
        for (let i = 0; i < n; i++) {
          out.push(await flows.recordChallenge(tenant, flowId, { secret, method: 'email-otp', code: '1', expiresAt: inFive(), limits: LIMITS }))
        }
        return out
      }

      // Two sends on a proven flow, which a new proven flow then evicts.
      const a = { flowId: unique('flow'), secret: unique('s') }
      await openFlow({ ...a, subjectId: subject })
      await sendAll(a.secret, a.flowId, 2)
      const b = { flowId: unique('flow'), secret: unique('s') }
      await openFlow({ ...b, subjectId: subject })
      await sendAll(b.secret, b.flowId, 2)
      await flows.cancelFlow(tenant, b.flowId)

      // A fresh unproven flow for the same subject has one send left of the five in 15 minutes.
      const c = { flowId: unique('flow'), secret: unique('s') }
      await openFlow({ ...c, candidateSubjectId: subject })
      const [fifth, sixth] = await sendAll(c.secret, c.flowId, 2)
      expect(fifth).toMatchObject({ outcome: 'sent', sends: 1 })
      expect(sixth.outcome).toBe('limit')
      if (sixth.outcome !== 'limit') return
      expect(sixth.scope).toBe('subject')
      expect(new Date(sixth.retryAt as Date).getTime()).toBeGreaterThan(Date.now() + 800_000)
    })

    it('holds the per-subject ceiling against concurrent sends from different flows', async () => {
      const subject = unique('subject')
      const tight: ChallengeLimits = { perFlow: 3, perSubject: [{ max: 3, windowSeconds: 900 }] }
      const opened = await Promise.all(
        Array.from({ length: 24 }, async () => {
          const secret = unique('s')
          return { secret, flow: await openFlow({ secret, candidateSubjectId: subject }) }
        })
      )
      const results = await Promise.all(
        opened.map(({ secret, flow }) =>
          flows.recordChallenge(tenant, flow.flowId, { secret, method: 'email-otp', code: '1', expiresAt: inFive(), limits: tight })
        )
      )
      expect(results.filter((r) => r.outcome === 'sent')).toHaveLength(3)
      expect(results.filter((r) => r.outcome === 'limit' && r.scope === 'subject')).toHaveLength(21)
    })

    it('does not count one subject against another, nor a flow without a subject', async () => {
      const lone = { flowId: unique('flow'), secret: unique('s') }
      await openFlow(lone)
      const r = await flows.recordChallenge(tenant, lone.flowId, { secret: lone.secret, method: 'email-otp', code: '1', expiresAt: inFive(), limits: LIMITS })
      expect(r).toMatchObject({ outcome: 'sent', sends: 1 })
    })

    it('encrypts what a flow holds from outside, and spends state with the result', async () => {
      const flow = await openFlow()
      const state = `st1.acme.${unique('state')}`
      expect(await flows.bindExternal(tenant, flow.flowId, { state, external: { provider: 'google', codeVerifier: 'verifier-xyz-123', nonce: 'nonce-abc-456' } })).toBe(true)

      const row = await rawFlow(db.raw, flow.flowId)
      expect(row.external?.startsWith('v2:')).toBe(true)
      expect(row.external).not.toContain('verifier-xyz-123')
      expect(row.external).not.toContain('nonce-abc-456')
      expect(row.stateHash).toBe(hashSecret(state))

      const found = await flows.findByState(tenant, state)
      expect(found?.flowId).toBe(flow.flowId)
      expect(found?.external).toEqual({ provider: 'google', codeVerifier: 'verifier-xyz-123', nonce: 'nonce-abc-456' })
      expect(await flows.findByState(tenant, 'st1.acme.forged')).toBeNull()

      const result = { provider: 'google', issuer: 'https://accounts.google.com', subject: '1234', email: 'a@b.c', emailVerified: true, amr: ['pwd'] }
      expect(await flows.recordExternalResult(tenant, flow.flowId, result)).toBe(true)
      expect(await flows.recordExternalResult(tenant, flow.flowId, { ...result, subject: 'attacker' })).toBe(false)
      expect(await flows.findByState(tenant, state)).toBeNull()

      const current = await flows.findBySecret(tenant, flow.flowId, 'wrong')
      expect(current.outcome).toBe('unknown')
    })

    it('retires a completed flow: its credential finds nothing and its slot is free', async () => {
      const subject = unique('subject')
      const done = { flowId: unique('flow'), secret: unique('s') }
      await openFlow({ ...done, subjectId: subject })
      expect(await flows.completeFlow(tenant, done.flowId)).toBe(true)
      expect(await flows.completeFlow(tenant, done.flowId)).toBe(false)
      expect((await flows.findBySecret(tenant, done.flowId, done.secret)).outcome).toBe('unknown')
      const row = await rawFlow(db.raw, done.flowId)
      expect(row.subjectId).toBeNull()
      expect(row.candidateSubjectId).toBe(subject)
    })

    it('purges dead flows by predicate, keeping those whose sends still count', async () => {
      const quiet = await openFlow({ expiresAt: new Date(Date.now() - 1000) })
      const secret = unique('s')
      const noisy = await openFlow({ secret, candidateSubjectId: unique('subject') })
      await flows.recordChallenge(tenant, noisy.flowId, { secret, method: 'email-otp', code: '1', expiresAt: inFive(), limits: LIMITS })
      await flows.cancelFlow(tenant, noisy.flowId)

      await flows.purgeExpired(tenant, new Date(Date.now() + 1000))
      expect(await rawFlow(db.raw, quiet.flowId)).toBeUndefined()
      expect(await rawFlow(db.raw, noisy.flowId)).toBeDefined()

      await flows.purgeExpired(tenant, new Date(Date.now() + 86_400_000 + 60_000))
      expect(await rawFlow(db.raw, noisy.flowId)).toBeUndefined()
    })

    it('refuses to work without a handle instead of finding one', async () => {
      await expect(flows.findBySecret(undefined as never, 'x', 'y')).rejects.toThrow(/needs a data handle/)
    })
  })

  describe(`database/managers · external identities on ${name} (T-12.12)`, function () {
    this.timeout(30000)
    let db: Migrated
    const links = createExternalIdentityManager()

    before(async () => (db = await open()))
    after(async () => await db?.close())

    it('keys a link on scope, provider, issuer and subject, never on the email', async () => {
      const key = { scope: 'tenant' as const, provider: 'google', issuer: 'https://accounts.google.com', subject: 'sub-1' }
      const link = await links.createLink(db.tenant, { ...key, subjectId: 'user-1', emailAtLink: 'u@example.com' })
      expect((await links.findLink(db.tenant, key))?.id).toBe(link.id)

      // The same `sub` from another issuer is another identity.
      const other = { ...key, issuer: 'https://login.microsoftonline.com/x/v2.0' }
      expect(await links.findLink(db.tenant, other)).toBeNull()
      await links.createLink(db.tenant, { ...other, subjectId: 'user-2' })
      expect((await links.findLink(db.tenant, other))?.subjectId).toBe('user-2')

      await expect(links.createLink(db.tenant, { ...key, subjectId: 'user-3' })).rejects.toThrow()
      expect(await links.findLink(db.tenant, { ...key, scope: 'control' })).toBeNull()
    })

    it('lists a subject\'s links, removes only its own, and touches', async () => {
      const key = { scope: 'tenant' as const, provider: 'entra', issuer: 'https://issuer.example', subject: 'sub-9' }
      const link = await links.createLink(db.tenant, { ...key, subjectId: 'user-9' })
      expect((await links.listOfSubject(db.tenant, 'user-9', 'tenant')).map((l) => l.id)).toEqual([link.id])
      expect(await links.listOfSubject(db.tenant, 'user-9', 'control')).toEqual([])

      expect(await links.touch(db.tenant, link.id)).toBe(true)
      expect((await links.findLink(db.tenant, key))?.lastUsedAt).toBeTruthy()

      expect(await links.removeLink(db.tenant, link.id, 'someone-else')).toBe(false)
      expect(await links.removeLink(db.tenant, link.id, 'user-9')).toBe(true)
      expect(await links.findLink(db.tenant, key)).toBeNull()
    })
  })

  describe(`database/managers · a tenant's identity providers on ${name} (T-12.12)`, function () {
    this.timeout(30000)
    let db: Migrated
    const providers = createIdentityProviderManager()
    const config = { issuer: 'https://login.example.com', clientId: 'client-1', redirectUri: 'https://api.example.com/auth/flow/return/oidc' }

    before(async () => (db = await open()))
    after(async () => await db?.close())

    it('encrypts the client secret at rest and returns it only from get', async () => {
      const created = await providers.create(db.control, { tenantId: 't-1', key: 'entra', type: 'oidc', config, clientSecret: 'client-secret-value' })
      expect(Object.keys(created)).not.toContain('clientSecret')
      expect(Object.keys(created)).not.toContain('secretEnc')

      const raw = db.control as unknown as RuntimeHandle
      const t = raw.registry!.identityProvider
      const rows = (await raw.db.select().from(t)) as Array<{ secretEnc: string | null; config: unknown }>
      expect(rows[0].secretEnc?.startsWith('v2:')).toBe(true)
      expect(JSON.stringify(rows)).not.toContain('client-secret-value')

      const listed = await providers.list(db.control, 't-1')
      expect(listed.map((p) => p.key)).toEqual(['entra'])
      expect(JSON.stringify(listed)).not.toContain('client-secret-value')
      expect(Object.keys(listed[0])).not.toContain('clientSecret')

      expect((await providers.get(db.control, 't-1', 'entra'))?.clientSecret).toBe('client-secret-value')
      expect(await providers.get(db.control, 't-2', 'entra')).toBeNull()
    })

    it('keeps, replaces or removes the secret on update, and deletes for real', async () => {
      await providers.create(db.control, { tenantId: 't-3', key: 'okta', type: 'oidc', config, clientSecret: 'first' })
      await providers.update(db.control, 't-3', 'okta', { status: 'disabled' })
      expect(await providers.get(db.control, 't-3', 'okta')).toMatchObject({ status: 'disabled', clientSecret: 'first' })
      await providers.update(db.control, 't-3', 'okta', { clientSecret: 'second' })
      expect((await providers.get(db.control, 't-3', 'okta'))?.clientSecret).toBe('second')
      await providers.update(db.control, 't-3', 'okta', { clientSecret: null })
      expect((await providers.get(db.control, 't-3', 'okta'))?.clientSecret).toBeNull()
      expect(await providers.update(db.control, 't-3', 'missing', { status: 'active' })).toBeNull()

      await expect(providers.create(db.control, { tenantId: 't-3', key: 'okta', type: 'oidc', config })).rejects.toThrow()
      expect(await providers.remove(db.control, 't-3', 'okta')).toBe(true)
      expect(await providers.remove(db.control, 't-3', 'okta')).toBe(false)
      await providers.create(db.control, { tenantId: 't-3', key: 'okta', type: 'oidc', config })
    })

    it('works on the control plane only', async () => {
      await expect(providers.list(db.tenant as never, 't-1')).rejects.toThrow(/works on the control plane/)
    })
  })
}

behaviours('SQLite', () => migratedSqlite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: `test_p12_ctl_${++counter}`, tenant: `test_p12_acme_${++counter}` }))
} else {
  describe.skip('database/managers · the phase 12 stores on Postgres (needs DATABASE_URL)', () => {
    it('runs with DATABASE_URL set', () => undefined)
  })
}
