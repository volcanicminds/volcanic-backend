//
// T-12.14: the flow engine, pure with respect to HTTP, on authenticators written for the test.
//
// Each case is a property of the state machine rather than of a method: the AND of stages, the OR
// inside one, an optional stage, the choice of a flow by role, an identifier a role does not
// accept, the MFA floor that adds an enrolment, a subject blocked between two factors, the return
// in POST of an identifier shaped like SAML, the return in GET of one shaped like a social login,
// and the store that must exist for a second step.
//
import { expect } from 'expect'
import type {
  AccessLogEntry,
  AuthFlowManagement,
  AuthManagers,
  AuthPlaneFlows,
  AuthResult,
  AuthSubject,
  Authenticator
} from '../../types/global.js'
import { MfaPolicy } from '../../lib/config/constants.js'
import { createAuthenticatorRegistry } from '../../lib/auth/registry.js'
import * as engine from '../../lib/auth/engine.js'
import type { FlowOutcome, FlowPlane } from '../../lib/auth/engine.js'
import { composeFlowCredential } from '../../lib/util/flowCredential.js'
import { fakeFlowStore } from './fixtures/flowStore.js'
import { challengeVerifier, postReturnIdentifier, redirectReturnIdentifier } from './fixtures/authenticators.js'

;(globalThis as unknown as { log: object }).log = {}

interface User {
  id: string
  externalId: string
  email: string
  roles: string[]
  factors: string[]
  blocked?: boolean
  totpSecret?: string
}

const subjectOf = (u: User): AuthSubject => ({
  id: u.id,
  externalId: u.externalId,
  email: u.email,
  roles: u.roles,
  factors: u.factors,
  confirmed: true,
  blocked: Boolean(u.blocked)
})

/** The fixtures of the whole file, fresh for every case. */
function world() {
  const users: User[] = [
    { id: '1', externalId: 'ext-ada', email: 'ada@x.test', roles: ['admin'], factors: [] },
    { id: '2', externalId: 'ext-bob', email: 'bob@x.test', roles: ['editor', 'admin'], factors: ['code-o'] },
    { id: '3', externalId: 'ext-eve', email: 'eve@x.test', roles: ['editor'], factors: ['totp'] },
    { id: '4', externalId: 'ext-joe', email: 'joe@x.test', roles: ['public'], factors: [] },
    // The subject the SAML-shaped fixture answers with.
    { id: 'u-1', externalId: 'ext-1', email: 'ada@example.test', roles: ['admin'], factors: [] }
  ]
  const byEmail = (email: unknown) => users.find((u) => u.email === email)

  const password: Authenticator = {
    id: 'password',
    kind: 'identifier',
    planes: ['tenant', 'control'],
    async verify(_ctx, input): Promise<AuthResult> {
      const user = byEmail(input.email)
      return user && input.password === 'pw' ? { outcome: 'success', subject: subjectOf(user) } : { outcome: 'fail', reason: 'AUTH_INVALID_CREDENTIALS' }
    }
  }
  const magic: Authenticator = { ...password, id: 'magic' }
  // Verifiers that need no enrolment (`code-a`, `code-b`), and one that does (`code-o`).
  const code = (id: string, expected: string, enrolled = false): Authenticator => ({
    id,
    kind: 'verifier',
    planes: ['tenant', 'control'],
    ...(enrolled ? { isEnrolled: (_ctx, subject) => subject.factors.includes(id) } : {}),
    async verify(_ctx, input) {
      return input.code === expected ? { outcome: 'success' } : { outcome: 'fail', reason: 'FLOW_CODE_INVALID' }
    }
  })
  const totp: Authenticator = {
    id: 'totp',
    kind: 'verifier',
    planes: ['tenant', 'control'],
    isEnrolled: (_ctx, subject) => subject.factors.includes('totp'),
    async enrol() {
      return { secret: 'ENROL-SECRET', uri: 'otpauth://totp/x' }
    },
    async verify(ctx, input) {
      const pending = ctx.flow?.external?.enrolmentSecret
      if (pending && !ctx.subject?.factors.includes('totp')) {
        if (input.code !== `ok:${pending}`) return { outcome: 'fail', reason: 'FLOW_CODE_INVALID' }
        users.find((u) => u.externalId === ctx.subject?.externalId)!.factors.push('totp')
        return { outcome: 'success' }
      }
      return input.code === '123456' ? { outcome: 'success' } : { outcome: 'fail', reason: 'FLOW_CODE_INVALID' }
    }
  }

  const registry = createAuthenticatorRegistry()
  for (const a of [password, magic, code('code-a', 'a'), code('code-b', 'b'), code('code-o', 'o', true), totp, postReturnIdentifier, redirectReturnIdentifier, challengeVerifier]) {
    registry.register(a)
  }

  const store = fakeFlowStore()
  const events: Array<Omit<AccessLogEntry, 'scope'>> = []
  const issued: Array<{ subjectId: string; methods: string[] }> = []

  function plane(flows: Partial<AuthPlaneFlows> = {}, over: Partial<FlowPlane<User>> = {}): FlowPlane<User> {
    return {
      plane: 'tenant',
      handle: { kind: 'tenant', tenantId: 't-1' } as unknown as FlowPlane<User>['handle'],
      tenant: { id: 't-1' } as FlowPlane<User>['tenant'],
      routing: 't-1',
      policy: MfaPolicy.OPTIONAL,
      flows: { identify: ['password', 'magic', 'fake-saml', 'fake-social'], flows: [{ roles: ['*'], stages: [] }], ...flows },
      limits: { flowTtl: 600, otpTtl: 300, otpMaxAttempts: 5, otpMaxSends: 3 },
      registry,
      managers: { authFlowManager: store.manager } as unknown as AuthManagers,
      ip: '192.0.2.1',
      userAgent: 'test',
      async loadSubject(externalId) {
        const user = users.find((u) => u.externalId === externalId)
        return user && !user.blocked ? { record: user, subject: subjectOf(user) } : null
      },
      async issue(user, _subject, methods) {
        issued.push({ subjectId: user.externalId, methods })
        return { body: { externalId: user.externalId, methods }, subjectId: user.externalId }
      },
      async record(entry) {
        events.push(entry)
      },
      ...over
    }
  }

  return { users, store, events, issued, plane }
}

const login = (p: FlowPlane<User>, email: string, method = 'password') => engine.start(p, method, { email, password: 'pw' })

function partial(outcome: FlowOutcome) {
  if (outcome.kind !== 'partial') throw new Error(`expected a partial answer, got ${JSON.stringify(outcome)}`)
  return outcome
}
function body(outcome: FlowOutcome) {
  if (outcome.kind !== 'complete') throw new Error(`expected a session, got ${JSON.stringify(outcome)}`)
  return outcome.body
}
const optionIds = (outcome: FlowOutcome) => partial(outcome).stage.options.map((o) => o.id)
const credentialOf = (outcome: FlowOutcome) => partial(outcome).credential.raw
const refusalOf = (outcome: FlowOutcome) => (outcome.kind === 'refused' ? outcome.refusal.code : `not refused: ${outcome.kind}`)

describe('auth · the flow engine (T-12.14)', () => {
  it('runs the stages of a flow as an AND, and closes with one session carrying every method', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-a'] }, { anyOf: ['code-b'] }] }] })

    const first = await login(p, 'ada@x.test')
    expect(optionIds(first)).toEqual(['code-a'])
    const credential = credentialOf(first)

    // The second stage is not on offer before the first is passed.
    expect(refusalOf(await engine.step(p, credential, 'code-b', { code: 'b' }))).toBe('FLOW_METHOD_NOT_ALLOWED')
    expect(optionIds(await engine.step(p, credential, 'code-a', { code: 'a' }))).toEqual(['code-b'])
    expect(body(await engine.step(p, credential, 'code-b', { code: 'b' }))).toEqual({ externalId: 'ext-ada', methods: ['password', 'code-a', 'code-b'] })
    expect(w.issued).toHaveLength(1)
    // Spent: the same credential finds no flow any more.
    expect(refusalOf(await engine.step(p, credential, 'code-b', { code: 'b' }))).toBe('FLOW_REQUIRED')
    expect(w.events.map((e) => e.event)).toEqual(['flow.started', 'stage.passed', 'stage.passed', 'login.succeeded'])
    expect(w.events[0]).toMatchObject({ subjectId: 'ext-ada', methods: ['password'] })
  })

  it('offers the methods of one stage as an OR: any of them passes it', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-a', 'code-b'] }] }] })
    const first = await login(p, 'ada@x.test')
    expect(optionIds(first)).toEqual(['code-a', 'code-b'])
    expect(body(await engine.step(p, credentialOf(first), 'code-b', { code: 'b' }))).toMatchObject({ methods: ['password', 'code-b'] })
  })

  it('applies an optional stage only to a subject enrolled in one of its methods', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-o'], optional: true }] }] })

    // Not enrolled: the password closes the login in one request, and no flow row is written.
    expect(body(await login(p, 'ada@x.test'))).toMatchObject({ methods: ['password'] })
    expect(w.store.rows.size).toBe(0)

    const bob = await login(p, 'bob@x.test')
    expect(optionIds(bob)).toEqual(['code-o'])
    expect(body(await engine.step(p, credentialOf(bob), 'code-o', { code: 'o' }))).toMatchObject({ methods: ['password', 'code-o'] })
  })

  it('chooses the first flow whose roles meet the subject, for a subject with more than one role', async () => {
    const w = world()
    const p = w.plane({
      flows: [
        { roles: ['admin'], stages: [{ anyOf: ['code-a'] }] },
        { roles: ['editor'], stages: [{ anyOf: ['code-b'] }] },
        { roles: ['*'], stages: [] }
      ]
    })
    // bob is editor AND admin: the admin flow comes first, so it is the one that applies.
    expect(optionIds(await login(p, 'bob@x.test'))).toEqual(['code-a'])
    expect(optionIds(await login(p, 'eve@x.test'))).toEqual(['code-b'])
    expect(body(await login(p, 'joe@x.test'))).toMatchObject({ methods: ['password'] })
  })

  it('refuses an identifier the chosen flow does not accept for that role, after the fact and with a code', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['admin'], identifiers: ['magic'], stages: [] }, { roles: ['*'], stages: [] }] })

    expect(refusalOf(await login(p, 'ada@x.test'))).toBe('FLOW_METHOD_NOT_ALLOWED')
    expect(w.events.at(-1)).toMatchObject({ event: 'login.failed', code: 'FLOW_METHOD_NOT_ALLOWED', subjectId: 'ext-ada' })
    expect(body(await login(p, 'ada@x.test', 'magic'))).toMatchObject({ methods: ['magic'] })
    // The identifier that is not in `identify` at all is not a login method of the plane.
    expect(refusalOf(await engine.start(p, 'code-a', {}))).toBe('FLOW_METHOD_NOT_ALLOWED')
  })

  it('applies the MANDATORY floor whatever the flow says, enrolling a subject with no factor inside the flow', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [] }] }, { policy: MfaPolicy.MANDATORY })

    const first = await login(p, 'ada@x.test')
    expect(partial(first).stage.options).toEqual([{ id: 'totp', kind: 'verifier', enrol: true }])
    const credential = credentialOf(first)

    // A code before the enrolment has started is not an answer to this stage.
    expect(refusalOf(await engine.step(p, credential, 'totp', { code: '123456' }))).toBe('FLOW_METHOD_NOT_ALLOWED')
    const started = await engine.step(p, credential, 'totp', {}, 'enrol')
    expect(partial(started).stage.options).toEqual([{ id: 'totp', kind: 'verifier', enrol: { secret: 'ENROL-SECRET', uri: 'otpauth://totp/x' } }])

    expect(body(await engine.step(p, credential, 'totp', { code: 'ok:ENROL-SECRET' }))).toMatchObject({ methods: ['password', 'totp'] })
    expect(w.users[0].factors).toEqual(['totp'])
    expect(w.events.map((e) => e.event)).toContain('mfa.enrolled')

    // A subject that already has a factor is asked for it, even by a flow with no stage.
    const eve = await login(p, 'eve@x.test')
    expect(partial(eve).stage.options).toEqual([{ id: 'totp', kind: 'verifier' }])
    // ...and cannot enrol another one inside the flow: the rule of the 409 of T-12.1.
    expect(refusalOf(await engine.step(p, credentialOf(eve), 'totp', {}, 'enrol'))).toBe('FLOW_ENROLMENT_REFUSED')
  })

  it('refuses a subject blocked between the first factor and the second, and retires the flow', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-a'] }] }] })
    const first = await login(p, 'ada@x.test')
    w.users[0].blocked = true

    const refused = await engine.step(p, credentialOf(first), 'code-a', { code: 'a' })
    expect(refused).toMatchObject({ kind: 'refused', endsFlow: true, refusal: { status: 401, code: 'AUTH_INVALID_CREDENTIALS' } })
    expect(w.issued).toHaveLength(0)
    w.users[0].blocked = false
    expect(refusalOf(await engine.step(p, credentialOf(first), 'code-a', { code: 'a' }))).toBe('FLOW_REQUIRED')
  })

  it('checks the subject again after the factor, before the session', async () => {
    const w = world()
    // Blocked while its second factor is being verified: the verification passes, the session does not.
    const blocking: Authenticator = {
      id: 'code-x',
      kind: 'verifier',
      planes: ['tenant'],
      verify: async () => {
        w.users[0].blocked = true
        return { outcome: 'success' }
      }
    }
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-x'] }] }] })
    p.registry.register(blocking)
    const first = await login(p, 'ada@x.test')
    expect(refusalOf(await engine.step(p, credentialOf(first), 'code-x', {}))).toBe('AUTH_INVALID_CREDENTIALS')
    expect(w.issued).toHaveLength(0)
  })

  it('counts the attempts of a verifier before it runs, and ends the flow at the ceiling', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-a'] }] }] }, { limits: { flowTtl: 600, otpTtl: 300, otpMaxAttempts: 2, otpMaxSends: 3 } })
    const credential = credentialOf(await login(p, 'ada@x.test'))

    expect(await engine.step(p, credential, 'code-a', { code: 'x' })).toMatchObject({ kind: 'refused', remaining: 1, refusal: { code: 'FLOW_CODE_INVALID' } })
    expect(await engine.step(p, credential, 'code-a', { code: 'y' })).toMatchObject({ kind: 'refused', endsFlow: true, refusal: { code: 'FLOW_ATTEMPTS_EXHAUSTED' } })
    expect(w.events.at(-1)).toMatchObject({ event: 'flow.exhausted', subjectId: 'ext-ada' })
    // The right code comes too late: the flow is gone, and a new login starts over.
    expect(refusalOf(await engine.step(p, credential, 'code-a', { code: 'a' }))).toBe('FLOW_REQUIRED')
  })

  it('lets one of two racing steps win, and gives the other nothing', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-a'] }] }] })
    const credential = credentialOf(await login(p, 'ada@x.test'))
    const results = await Promise.all([engine.step(p, credential, 'code-a', { code: 'a' }), engine.step(p, credential, 'code-a', { code: 'a' })])
    expect(results.map((r) => r.kind).sort()).toEqual(['complete', 'refused'])
    expect(w.issued).toHaveLength(1)
  })

  it('reads a flow credential as addressing: another routing, another plane, a malformed one or an expired one', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['code-a'] }] }] })
    const first = partial(await login(p, 'ada@x.test'))

    const elsewhere = composeFlowCredential('t-2', first.credential.flowId, first.credential.secret).raw
    expect(refusalOf(await engine.step(p, elsewhere, 'code-a', { code: 'a' }))).toBe('TENANT_MISMATCH')
    expect(refusalOf(await engine.step({ ...p, plane: 'control' }, first.credential.raw, 'code-a', { code: 'a' }))).toBe('FLOW_REQUIRED')
    expect(refusalOf(await engine.step(p, 'vf1.t-1.not a flow', 'code-a', {}))).toBe('FLOW_REQUIRED')
    expect(refusalOf(await engine.step(p, undefined, 'code-a', {}))).toBe('FLOW_REQUIRED')

    w.store.rows.get(first.credential.flowId)!.expiresAt = new Date(Date.now() - 1000)
    expect(refusalOf(await engine.step(p, first.credential.raw, 'code-a', { code: 'a' }))).toBe('FLOW_EXPIRED')
    expect(w.events.at(-1)).toMatchObject({ event: 'flow.expired', subjectId: 'ext-ada' })
  })

  it('needs a flow store for a second step, and closes a password login without one (F46)', async () => {
    const w = world()
    const none = { isImplemented: () => false } as unknown as AuthFlowManagement
    const p = w.plane(
      { flows: [{ roles: ['*'], stages: [{ anyOf: ['code-o'], optional: true }] }] },
      { managers: { authFlowManager: none } as unknown as AuthManagers }
    )
    expect(body(await login(p, 'ada@x.test'))).toMatchObject({ methods: ['password'] })
    expect(refusalOf(await login(p, 'bob@x.test'))).toBe('AUTH_FLOW_NOT_AVAILABLE')
    expect(refusalOf(await engine.step(p, 'vf1.t-1.flow.secret', 'code-o', {}))).toBe('AUTH_FLOW_NOT_AVAILABLE')
  })

  it('sends a code through `initiate` and verifies it with the next step, for an SMS-shaped verifier', async () => {
    const w = world()
    const p = w.plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['sms'] }] }] })
    const bob = { ...w.users[1], factors: ['sms'] }
    w.users[1] = bob
    const credential = credentialOf(await login(p, 'bob@x.test'))

    const sent = await engine.challenge(p, credential, 'sms', {})
    expect(partial(sent).stage.options[0]).toMatchObject({ id: 'sms', challenge: { channel: 'sms', destination: '+39 *** *** 12' } })
    expect(refusalOf(await engine.challenge(p, credential, 'code-a', {}))).toBe('FLOW_METHOD_NOT_ALLOWED')
    expect(body(await engine.step(p, credential, 'sms', { code: '123456' }))).toMatchObject({ methods: ['password', 'sms'] })
  })

  it('carries a SAML-shaped identifier out with a posted form and back through a return that issues nothing', async () => {
    const w = world()
    const p = w.plane()
    const out = partial(await engine.start(p, 'fake-saml', {}))
    const action = out.stage.options[0].action
    expect(action).toMatchObject({ type: 'post', url: 'https://idp.example.test/sso' })
    const relayState = action?.type === 'post' ? action.fields.RelayState : ''

    // A forged answer ends the flow; the return itself never opens a session.
    const forged = await engine.returnFrom(p, 'fake-saml', { SAMLResponse: 'forged', RelayState: relayState })
    expect(forged).toEqual({ kind: 'returned', ok: false })
    expect(refusalOf(await engine.step(p, out.credential.raw, 'fake-saml', {}))).toBe('FLOW_REQUIRED')

    const again = partial(await engine.start(p, 'fake-saml', {}))
    const state = again.stage.options[0].action?.type === 'post' ? again.stage.options[0].action.fields.RelayState : ''
    expect(await engine.returnFrom(p, 'fake-saml', { SAMLResponse: 'signed', RelayState: state })).toEqual({ kind: 'returned', ok: true })
    expect(w.issued).toHaveLength(0)
    // The state is spent with the answer: a replayed return finds nothing.
    expect(refusalOf(await engine.returnFrom(p, 'fake-saml', { SAMLResponse: 'signed', RelayState: state }))).toBe('FLOW_REQUIRED')
    // Another tenant's routing in the state is refused before any row is read.
    expect(refusalOf(await engine.returnFrom(p, 'fake-saml', { SAMLResponse: 'signed', RelayState: state.replace('st1.t-1.', 'st1.t-2.') }))).toBe('TENANT_MISMATCH')

    // Only the credential of the browser that started the flow cashes it.
    expect(body(await engine.step(p, again.credential.raw, 'fake-saml', {}))).toMatchObject({ externalId: 'ext-1', methods: ['fake-saml', 'idp-mfa'] })
  })

  it('carries a social-shaped identifier out with a redirect and back through a GET return, on the state the engine built', async () => {
    const w = world()
    const p = w.plane()
    const out = partial(await engine.start(p, 'fake-social', {}))
    const action = out.stage.options[0].action
    expect(action?.type).toBe('redirect')
    const state = new URL(action?.url ?? 'x:').searchParams.get('state') ?? ''
    // The engine's own shape: the routing of this container, then a secret the row keeps only hashed.
    expect(state).toMatch(/^st1\.t-1\./)
    expect(JSON.stringify([...w.store.rows.values()])).not.toContain(state.split('.').at(-1))

    // The provider said no: the flow ends and nothing is issued, and the console still lands where
    // it asked to, to read the refusal from its next step.
    expect(await engine.returnFrom(p, 'fake-social', { error: 'access_denied', state })).toEqual({ kind: 'returned', ok: false, returnTo: '/after' })
    expect(refusalOf(await engine.step(p, out.credential.raw, 'fake-social', {}))).toBe('FLOW_REQUIRED')

    const again = partial(await engine.start(p, 'fake-social', {}))
    const next = new URL(again.stage.options[0].action?.url ?? 'x:').searchParams.get('state') ?? ''
    // The step that arrives before the browser is answered with the same stage: the flow stays.
    expect(optionIds(await engine.step(p, again.credential.raw, 'fake-social', {}))).toEqual(['fake-social'])
    expect(await engine.returnFrom(p, 'fake-social', { code: 'granted', state: next })).toEqual({ kind: 'returned', ok: true, returnTo: '/after' })
    expect(w.issued).toHaveLength(0)
    expect(body(await engine.step(p, again.credential.raw, 'fake-social', {}))).toMatchObject({ externalId: 'ext-1', methods: ['fake-social'] })
  })
})
