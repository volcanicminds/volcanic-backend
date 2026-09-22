/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.22 to T-12.24: `email-otp` through the flow engine, on the real flow store of a migrated
// container. The store is not faked here because the properties in doubt are its own: the ceiling
// per subject that a restarted flow must not reset, the conditional consumption of a code, and an
// unproven flow that must not evict a proven one. SQLite always, Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import { eq } from 'drizzle-orm'
import type { AuthPlaneFlows } from '../../types/global.js'
import * as engine from '../../lib/auth/engine.js'
import type { FlowOutcome, FlowPlane } from '../../lib/auth/engine.js'
import { buildAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { toSubject } from '../../lib/auth/subjects.js'
import { maskEmail, newCode } from '../../lib/auth/authenticators/emailOtp.js'
import { createAuthFlowManager } from '../../lib/database/managers/authFlow.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { column } from '../../lib/database/managers/runtime.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from './fixtures/migrated.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'
;(global as any).log = {}

const LIMITS = { flowTtl: 600, otpTtl: 300, otpMaxAttempts: 5, otpMaxSends: 3 }

/** Identify by address or by password, then an optional second factor by app or by mail. */
const FLOWS: AuthPlaneFlows = {
  identify: ['password', 'email-otp'],
  flows: [{ roles: ['*'], stages: [{ anyOf: ['totp', 'email-otp'], optional: true }] }]
}

/** The code, as a stage of its own, after the password: the verifier role. */
const VERIFY_FLOWS: AuthPlaneFlows = { identify: ['password'], flows: [{ roles: ['*'], stages: [{ anyOf: ['email-otp'] }] }] }

const tick = () => new Promise((resolve) => setImmediate(resolve))
const settle = async () => {
  for (let i = 0; i < 5; i++) await tick()
}

/** An outcome with the parts that differ by construction (the credential, the clock) taken out. */
function shape(outcome: FlowOutcome) {
  const copy: any = JSON.parse(JSON.stringify(outcome))
  delete copy.credential
  delete copy.expiresAt
  for (const option of copy.stage?.options ?? []) {
    if (option.challenge) {
      option.challenge.expiresAt = typeof option.challenge.expiresAt
      option.challenge.resendAt = option.challenge.resendAt === null ? null : typeof option.challenge.resendAt
    }
  }
  return copy
}

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`auth · email-otp on the real flow store, ${name} (T-12.22 to T-12.24)`, function () {
    this.timeout(30000)
    let db: Migrated
    const users = createUserManager()
    const store = createAuthFlowManager()
    let seq = 0

    before(async () => (db = await open()))
    after(async () => await db?.close())

    async function person(over: Record<string, unknown> = {}) {
      seq += 1
      const email = `anna${seq}@acme.test`
      const row: any = await users.createUser(db.tenant, { email, password: 'Acme-pw-123456', confirmed: true, roles: ['admin'], ...over })
      return { ...row, email }
    }

    function plane(options: { flows?: AuthPlaneFlows; deliver?: (m: any) => Promise<void> } = {}) {
      const deliveries: any[] = []
      const accesses: any[] = []
      const p: FlowPlane<any> = {
        plane: 'tenant',
        handle: db.tenant,
        tenant: null,
        routing: 'ctl',
        policy: 'OPTIONAL' as never,
        flows: options.flows ?? FLOWS,
        limits: LIMITS,
        registry: buildAuthenticatorRegistry(),
        managers: {
          userManager: users,
          authFlowManager: store,
          mfaManager: { verify: (code: string, secret: string) => (code === `${secret}-ok` ? 0 : null), generateSetup: async () => ({}) },
          challengeDeliveryManager: {
            isImplemented: () => true,
            deliver: options.deliver ?? (async (message: any) => void deliveries.push(message))
          }
        } as any,
        ip: '203.0.113.7',
        userAgent: null,
        loadSubject: async (externalId) => {
          const user: any = await users.retrieveUserByExternalId(db.tenant, externalId)
          if (!user || user.confirmed !== true || user.blocked) return null
          return { record: user, subject: toSubject('tenant', user) }
        },
        issue: async (user: any, _subject, methods) => ({ body: { sub: user.externalId, methods }, subjectId: user.externalId }),
        record: async (entry) => void accesses.push(entry)
      }
      return { p, deliveries, accesses }
    }

    const raw = (o: FlowOutcome) => (o.kind === 'partial' ? o.credential.raw : undefined)
    const refusal = (o: FlowOutcome) => (o.kind === 'refused' ? o.refusal.code : o.kind)

    describe('the identifier (T-12.22)', () => {
      it('sends eight digits to the address on file and logs in with them alone', async () => {
        const anna = await person()
        const { p, deliveries, accesses } = plane()
        const started = await engine.start(p, 'email-otp', { email: anna.email.toUpperCase() })
        expect(started.kind).toBe('partial')
        await settle()
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0]).toMatchObject({ channel: 'email', to: anna.email, purpose: 'identify', subjectId: anna.externalId, plane: 'tenant' })
        expect(deliveries[0].code).toMatch(/^\d{8}$/)

        const done = await engine.step(p, raw(started), 'email-otp', { code: deliveries[0].code })
        expect(done).toEqual({ kind: 'complete', body: { sub: anna.externalId, methods: ['email-otp'] } })
        expect(accesses.map((a) => a.event)).toEqual(['flow.started', 'challenge.sent', 'stage.passed', 'login.succeeded'])
        // The code travels to the port and nowhere else: not in a row of the access log.
        expect(JSON.stringify(accesses)).not.toContain(deliveries[0].code)
      })

      it('answers an unknown address exactly as a known one, and sends nothing', async () => {
        const anna = await person()
        const known = plane()
        const unknown = plane()
        // Same mask by construction: `a***@a***.test`.
        const a = await engine.start(known.p, 'email-otp', { email: anna.email })
        const b = await engine.start(unknown.p, 'email-otp', { email: `amelia-${seq}@acme.test` })
        expect(shape(b)).toEqual(shape(a))
        expect((a as any).stage.options[0].challenge.destination).toBe(maskEmail(anna.email))
        await settle()
        expect(known.deliveries).toHaveLength(1)
        expect(unknown.deliveries).toHaveLength(0)

        // And the unknown flow behaves as a real one on every code: wrong, with the same count.
        const wrongA = await engine.step(known.p, raw(a), 'email-otp', { code: '00000000' })
        const wrongB = await engine.step(unknown.p, raw(b), 'email-otp', { code: '00000000' })
        expect(shape(wrongB)).toEqual(shape(wrongA))
        expect(wrongA).toMatchObject({ kind: 'refused', endsFlow: false, remaining: 4, refusal: { code: 'FLOW_CODE_INVALID' } })
      })

      it('keeps the flow alive on a wrong code, and ends it on the fifth', async () => {
        const anna = await person()
        const { p, deliveries } = plane()
        const started = await engine.start(p, 'email-otp', { email: anna.email })
        await settle()
        const wrong = await engine.step(p, raw(started), 'email-otp', { code: '12345678' === deliveries[0].code ? '87654321' : '12345678' })
        expect(wrong).toMatchObject({ kind: 'refused', endsFlow: false, remaining: 4 })
        // The right code still works after a wrong one.
        expect((await engine.step(p, raw(started), 'email-otp', { code: deliveries[0].code })).kind).toBe('complete')

        const second = await engine.start(p, 'email-otp', { email: anna.email })
        await settle()
        const bad = deliveries[1].code === '11111111' ? '22222222' : '11111111'
        for (let i = 0; i < 4; i++) await engine.step(p, raw(second), 'email-otp', { code: bad })
        const last = await engine.step(p, raw(second), 'email-otp', { code: bad })
        expect(last).toMatchObject({ kind: 'refused', endsFlow: true, refusal: { code: 'FLOW_ATTEMPTS_EXHAUSTED' } })
        expect(refusal(await engine.step(p, raw(second), 'email-otp', { code: deliveries[1].code }))).toBe('FLOW_REQUIRED')
      })

      it('refuses an expired code without ending the flow, and a new one then works', async () => {
        const anna = await person()
        const { p, deliveries } = plane()
        const started = await engine.start(p, 'email-otp', { email: anna.email })
        await settle()
        const flowId = (started as any).credential.flowId
        const t = (db.raw.tables as any).authFlow
        await db.raw.db
          .update(t)
          .set({ challengeExpiresAt: new Date(Date.now() - 1000) })
          .where(eq(column(t, 'flowId'), flowId as never))

        const expired = await engine.step(p, raw(started), 'email-otp', { code: deliveries[0].code })
        expect(expired).toMatchObject({ kind: 'refused', endsFlow: false, refusal: { code: 'FLOW_CODE_EXPIRED', status: 401 } })

        const again = await engine.challenge(p, raw(started), 'email-otp', { email: anna.email })
        expect(again.kind).toBe('partial')
        await settle()
        expect(deliveries).toHaveLength(2)
        expect((await engine.step(p, raw(started), 'email-otp', { code: deliveries[1].code })).kind).toBe('complete')
      })

      it('does not take a code twice', async () => {
        const anna = await person()
        const { p, deliveries } = plane({ flows: { identify: ['email-otp'], flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'] }] }] } })
        await users.saveMfaSecret(db.tenant, anna.id, 'SECRET-A')
        await users.enableMfa(db.tenant, anna.id)
        const started = await engine.start(p, 'email-otp', { email: anna.email })
        await settle()
        const identified = await engine.step(p, raw(started), 'email-otp', { code: deliveries[0].code })
        expect(identified.kind).toBe('partial')
        // The flow is proven now and waits on the app: the same code for the same method is not an
        // option of this stage, and the store would not take it again anyway.
        expect(refusal(await engine.step(p, raw(started), 'email-otp', { code: deliveries[0].code }))).toBe('FLOW_METHOD_NOT_ALLOWED')
        const consumed = await store.consumeChallenge(db.tenant, (started as any).credential.flowId, {
          secret: (started as any).credential.secret,
          code: deliveries[0].code,
          maxAttempts: 5
        })
        expect(consumed.outcome).toBe('expired')
      })
    })

    describe('the verifier (T-12.22)', () => {
      it('sends six digits to the address on file, never to one in the body, and closes the stage', async () => {
        const anna = await person()
        const { p, deliveries } = plane({ flows: VERIFY_FLOWS })
        const started = await engine.start(p, 'password', { email: anna.email, password: 'Acme-pw-123456' })
        expect((started as any).stage.options).toEqual([{ id: 'email-otp', kind: 'verifier' }])
        // Offered, not sent: the first send is asked for, as the resend is.
        await settle()
        expect(deliveries).toHaveLength(0)

        const sent = await engine.challenge(p, raw(started), 'email-otp', { email: 'attacker@evil.test' })
        expect((sent as any).stage.options[0].challenge).toMatchObject({ channel: 'email', destination: maskEmail(anna.email) })
        await settle()
        expect(deliveries).toHaveLength(1)
        expect(deliveries[0]).toMatchObject({ to: anna.email, purpose: 'verify' })
        expect(deliveries[0].code).toMatch(/^\d{6}$/)

        const done = await engine.step(p, raw(started), 'email-otp', { code: deliveries[0].code })
        expect(done).toEqual({ kind: 'complete', body: { sub: anna.externalId, methods: ['password', 'email-otp'] } })
      })
    })

    describe('sending and sending again (T-12.23)', () => {
      it('allows three sends per flow, says when the last one went, then refuses with FLOW_SEND_LIMIT', async () => {
        const anna = await person()
        const { p } = plane()
        const started = await engine.start(p, 'email-otp', { email: anna.email })
        const second = await engine.challenge(p, raw(started), 'email-otp', { email: anna.email })
        const third = await engine.challenge(p, raw(started), 'email-otp', { email: anna.email })
        expect((started as any).stage.options[0].challenge.resendAt).not.toBeNull()
        expect((second as any).stage.options[0].challenge.resendAt).not.toBeNull()
        expect((third as any).stage.options[0].challenge.resendAt).toBeNull()
        const fourth = await engine.challenge(p, raw(started), 'email-otp', { email: anna.email })
        expect(fourth).toMatchObject({ kind: 'refused', endsFlow: false, refusal: { code: 'FLOW_SEND_LIMIT', status: 429 } })
      })

      it('does not reset the count per subject when the flow starts again', async () => {
        const anna = await person()
        const { p, deliveries } = plane()
        const answers: FlowOutcome[] = []
        for (let i = 0; i < 7; i++) answers.push(await engine.start(p, 'email-otp', { email: anna.email }))
        await settle()
        // Five in fifteen minutes, across every flow of the subject; the other two are answered as
        // sends, because as an identifier a refusal would say the address is somebody's.
        expect(deliveries).toHaveLength(5)
        expect(answers.every((a) => a.kind === 'partial')).toBe(true)
        expect(new Set(answers.map((a) => JSON.stringify(shape(a)))).size).toBe(1)

        // The same subject as a verifier, where the subject is proven: the ceiling is said.
        const verifier = plane({ flows: VERIFY_FLOWS })
        const started = await engine.start(verifier.p, 'password', { email: anna.email, password: 'Acme-pw-123456' })
        const refused: any = await engine.challenge(verifier.p, raw(started), 'email-otp', {})
        expect(refused).toMatchObject({ kind: 'refused', endsFlow: false, refusal: { code: 'FLOW_SEND_LIMIT' } })
        expect(refused.retryAt.getTime()).toBeGreaterThan(Date.now())
      })

      it('logs a failing delivery and answers as if it had worked', async () => {
        const anna = await person()
        const working = plane()
        const broken = plane({ deliver: async () => Promise.reject(new Error('smtp down')) })
        const warnings: string[] = []
        ;(global as any).log = { w: true, warn: (m: string) => warnings.push(m) }
        try {
          const a = await engine.start(working.p, 'email-otp', { email: anna.email })
          const b = await engine.start(broken.p, 'email-otp', { email: anna.email })
          expect(shape(b)).toEqual(shape(a))
          await settle()
          expect(warnings.some((w) => w.includes('smtp down'))).toBe(true)
        } finally {
          ;(global as any).log = {}
        }
      })
    })

    describe('an unproven flow evicts nobody (T-12.24)', () => {
      it('lets a password and TOTP login half way through finish after ten email-otp starts on the same address', async () => {
        const anna = await person()
        await users.saveMfaSecret(db.tenant, anna.id, 'SECRET-V')
        await users.enableMfa(db.tenant, anna.id)
        const { p } = plane()

        const victim = await engine.start(p, 'password', { email: anna.email, password: 'Acme-pw-123456' })
        expect(victim.kind).toBe('partial')
        for (let i = 0; i < 10; i++) expect((await engine.start(p, 'email-otp', { email: anna.email })).kind).toBe('partial')

        const done = await engine.step(p, raw(victim), 'totp', { code: 'SECRET-V-ok' })
        expect(done).toEqual({ kind: 'complete', body: { sub: anna.externalId, methods: ['password', 'totp'] } })
      })
    })
  })
}

describe('auth · email-otp helpers', () => {
  it('draws codes of the length of their purpose from the whole range', () => {
    for (let i = 0; i < 200; i++) {
      expect(newCode('verify')).toMatch(/^\d{6}$/)
      expect(newCode('identify')).toMatch(/^\d{8}$/)
    }
  })

  it('masks an address down to its first letters and its top-level domain', () => {
    expect(maskEmail('davide@acme.example.com')).toBe('d***@a***.com')
    expect(maskEmail('x@localhost')).toBe('x***@l***')
    expect(maskEmail('broken')).toBe('***')
  })
})

behaviours('SQLite', () => migratedSqlite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_p12_otp_ctl', tenant: 'test_p12_otp_acme' }))
}
