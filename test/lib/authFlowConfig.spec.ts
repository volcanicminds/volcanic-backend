//
// T-12.5 and T-12.6: `config/authFlows.ts`, how it is loaded, and every reason it stops the boot.
//
// One test per cause, each on the text of its message: the message is what an operator reads at
// three in the morning, and a refusal that fires with the wrong sentence sends them to fix the
// wrong thing.
//
import { expect } from 'expect'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AuthFlowsConfig, AuthPlaneFlows, Authenticator, AuthResult } from '../../types/global.js'
import { MfaPolicy } from '../../lib/config/constants.js'
import frameworkFlows from '../../lib/config/authFlows.js'
import { load, resolveAuthFlows } from '../../lib/loader/authFlows.js'
import { buildAuthenticatorRegistry, createAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { passwordAuthenticator, totpAuthenticator } from '../../lib/auth/builtins.js'
import { authFlowProblems, canImport, isImplemented, listsMethod, type AuthFlowCheck } from '../../lib/auth/validate.js'

const PROJECT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'authFlows')
const bag = globalThis as unknown as Record<string, unknown>

const pending = async (): Promise<AuthResult> => ({ outcome: 'pending' })
const emailOtp: Authenticator = { id: 'email-otp', kind: ['identifier', 'verifier'], planes: ['tenant', 'control'], initiate: pending, verify: pending }
const oidc: Authenticator = { id: 'oidc', kind: 'identifier', planes: ['tenant'], initiate: pending, verify: pending }

const OPTIONAL_TOTP = [{ anyOf: ['totp'], optional: true }]
const plane = (over: Partial<AuthPlaneFlows> = {}): AuthPlaneFlows => ({
  identify: ['password'],
  flows: [{ roles: ['*'], stages: OPTIONAL_TOTP }],
  ...over
})

/** The framework defaults, a bare build, and whatever the case changes. */
function check(project: AuthFlowsConfig | null = null, over: Partial<AuthFlowCheck> = {}): string[] {
  return authFlowProblems({
    flows: resolveAuthFlows(frameworkFlows, project),
    registry: buildAuthenticatorRegistry([emailOtp, oidc]),
    roles: { tenant: ['public', 'admin'], control: ['system:admin', 'system:operator', 'system:auditor'] },
    implemented: { mfa: false, challengeDelivery: false, authFlow: false },
    policies: { floor: MfaPolicy.OPTIONAL, control: MfaPolicy.OPTIONAL },
    oidcLibrary: false,
    env: {},
    ...over
  })
}

const oneMatching = (re: RegExp) => expect.arrayContaining([expect.stringMatching(re)])

describe('auth · the flows configuration and its loader (T-12.5)', () => {
  let savedLog: unknown
  const cwd = process.cwd()
  const savedTtl = process.env.AUTH_OTP_TTL

  before(() => {
    savedLog = bag.log
    bag.log = {}
  })
  after(() => {
    bag.log = savedLog
    process.chdir(cwd)
    if (savedTtl === undefined) delete process.env.AUTH_OTP_TTL
    else process.env.AUTH_OTP_TTL = savedTtl
  })

  it('reproduces today on both planes: password, then TOTP for whoever has it', () => {
    const resolved = resolveAuthFlows(frameworkFlows)
    for (const p of ['tenant', 'control'] as const) {
      expect(resolved[p]).toEqual({ identify: ['password'], flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'], optional: true }] }] })
    }
    expect(resolved.limits).toEqual({ flowTtl: 600, otpTtl: 300, otpMaxAttempts: 5, otpMaxSends: 3 })
  })

  it('lets a project that declares only `tenant` inherit `control`, and replaces the tenant block whole', async () => {
    process.chdir(PROJECT)
    let resolved
    try {
      resolved = await load()
    } finally {
      process.chdir(cwd)
    }

    expect(resolved.control).toEqual(frameworkFlows.control)
    // Replaced, not merged: the framework's optional TOTP stage does not reappear in the '*' flow,
    // and the admin flow keeps only the stage the project wrote.
    expect(resolved.tenant.flows).toEqual([
      { roles: ['admin'], stages: [{ anyOf: ['sms'] }] },
      { roles: ['*'], stages: [] }
    ])
    expect(resolved.limits.flowTtl).toBe(900)
    expect(resolved.limits.otpTtl).toBe(300)
  })

  it('reads the framework file alone where the project has none', async () => {
    const resolved = await load()
    expect(resolved.tenant).toEqual(frameworkFlows.tenant)
  })

  it('lets the environment win over both files for a limit', () => {
    process.env.AUTH_OTP_TTL = '120'
    try {
      expect(resolveAuthFlows(frameworkFlows, { limits: { otpTtl: 60 } }).limits.otpTtl).toBe(120)
    } finally {
      delete process.env.AUTH_OTP_TTL
    }
  })

  it('freezes what it hands out, and leaves the module it read untouched', () => {
    const resolved = resolveAuthFlows(frameworkFlows)
    expect(Object.isFrozen(resolved.tenant.flows[0].stages[0].anyOf)).toBe(true)
    expect(Object.isFrozen(frameworkFlows.tenant)).toBe(false)
  })
})

describe('auth · what refuses the boot (T-12.6)', () => {
  let savedLog: unknown
  before(() => {
    savedLog = bag.log
    bag.log = {}
  })
  after(() => {
    bag.log = savedLog
  })

  it('accepts the framework defaults on a bare build: no MFA manager, no flow store, no delivery', () => {
    expect(check()).toEqual([])
    expect(check(null, { implemented: { mfa: true, challengeDelivery: true, authFlow: true } })).toEqual([])
  })

  it("refuses a plane whose last flow is not '*'", () => {
    const problems = check({ tenant: plane({ flows: [{ roles: ['admin'], stages: [] }] }) })
    expect(problems).toEqual(["authFlows.tenant: the last flow must have roles ['*'], or a subject whose roles meet no flow cannot log in: add { roles: ['*'], stages: [] } at the end"])
    expect(check({ tenant: plane({ flows: [] }) })).toEqual(oneMatching(/the last flow must have roles \['\*'\]/))
  })

  it("refuses a '*' flow that is not the last", () => {
    const problems = check({ tenant: plane({ flows: [{ roles: ['*'], stages: [] }, { roles: ['admin', '*'], stages: [] }] }) })
    expect(problems).toEqual(["authFlows.tenant: flow 1 has roles ['*'] and is not the last: the flows after it can never be chosen, move it to the end"])
  })

  it('refuses a method the registry of that plane does not have, including one registered on the other plane', () => {
    expect(check({ tenant: plane({ identify: ['password', 'magic-link'] }) })).toEqual([
      "authFlows.tenant: `identify` names 'magic-link', which is not an authenticator of the tenant plane: register it through start({ authenticators }) or remove it"
    ])
    // `oidc` is registered for the tenant plane only.
    expect(check({ control: plane({ identify: ['password', 'oidc'] }) }, { oidcLibrary: true })).toEqual([
      "authFlows.control: `identify` names 'oidc', which is not an authenticator of the control plane: register it through start({ authenticators }) or remove it"
    ])
    expect(check({ tenant: plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['sms'], optional: true }] }] }) })).toEqual(
      oneMatching(/flow 1, stage 1 names 'sms', which is not an authenticator of the tenant plane/)
    )
  })

  it('refuses a verifier in `identify`', () => {
    expect(check({ tenant: plane({ identify: ['totp'] }) })).toEqual(
      oneMatching(/`identify` names 'totp', a verifier: it proves something about a known subject, move it into a stage/)
    )
  })

  it('refuses an identifier in a stage, and accepts a method that plays both roles in either place', () => {
    expect(check({ tenant: plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['password'], optional: true }] }] }) })).toEqual([
      "authFlows.tenant: flow 1, stage 1 names 'password', an identifier: a stage after `identify` takes verifiers only"
    ])
    const both = check(
      { tenant: plane({ identify: ['password', 'email-otp'], flows: [{ roles: ['*'], stages: [{ anyOf: ['email-otp'] }] }] }) },
      { implemented: { mfa: false, challengeDelivery: true, authFlow: true } }
    )
    expect(both).toEqual([])
  })

  it('refuses an empty `anyOf` and an empty `identify`', () => {
    expect(check({ tenant: plane({ flows: [{ roles: ['*'], stages: [{ anyOf: [] }] }] }) }, { implemented: { mfa: false, challengeDelivery: false, authFlow: true } })).toEqual([
      'authFlows.tenant: flow 1, stage 1 has an empty `anyOf`: list at least one verifier'
    ])
    expect(check({ control: plane({ identify: [] }) })).toEqual([
      "authFlows.control: `identify` is empty: list at least one identifier, e.g. ['password']"
    ])
  })

  it('refuses a role outside the catalogue of its plane, and a flow with no roles', () => {
    expect(check({ tenant: plane({ flows: [{ roles: ['editor'], stages: [] }, { roles: ['*'], stages: [] }] }) })).toEqual([
      "authFlows.tenant: flow 1 names role 'editor', which is not in the tenant catalogue: declare it in config/roles.ts"
    ])
    // A tenant role is not a control role, even when both catalogues are loaded.
    expect(check({ control: plane({ flows: [{ roles: ['admin'], stages: [] }, { roles: ['*'], stages: [] }] }) })).toEqual([
      "authFlows.control: flow 1 names role 'admin', which is not in the control catalogue: declare it in config/systemRoles.ts"
    ])
    expect(check({ tenant: plane({ flows: [{ roles: [], stages: [] }, { roles: ['*'], stages: [] }] }) })).toEqual([
      "authFlows.tenant: flow 1 has no roles: name role codes, or '*' for everyone"
    ])
  })

  it('refuses `identifiers` that `identify` does not list', () => {
    const flows = [{ roles: ['admin'], identifiers: ['oidc'], stages: [] }, { roles: ['*'], stages: [] }]
    expect(check({ tenant: plane({ flows }) })).toEqual([
      "authFlows.tenant: flow 1 accepts identifier 'oidc', which `identify` does not list: add it there or drop it here"
    ])
  })

  it('refuses a deployment provider missing a required field, or naming an empty variable', () => {
    const google = { type: 'oidc' as const, issuer: 'https://accounts.google.com', clientId: 'id', redirectUri: 'https://api.test/auth/flow/return/oidc', clientSecretEnv: 'GOOGLE_CLIENT_SECRET' }
    const partial = { ...google, issuer: '', redirectUri: undefined } as unknown as typeof google

    expect(check({ tenant: plane({ providers: { google: partial } }) })).toEqual(["authFlows.tenant: provider 'google' is missing issuer, redirectUri"])
    expect(check({ tenant: plane({ providers: { google: { ...google, type: 'saml' } as unknown as typeof google } }) })).toEqual([
      "authFlows.tenant: provider 'google' is missing type: 'oidc'"
    ])
    expect(check({ tenant: plane({ providers: { google } }) }, { env: { GOOGLE_CLIENT_SECRET: '  ' } })).toEqual([
      "authFlows.tenant: provider 'google' reads its client secret from GOOGLE_CLIENT_SECRET, which is empty: set that variable"
    ])
    expect(check({ tenant: plane({ providers: { google } }) }, { env: { GOOGLE_CLIENT_SECRET: 'set' } })).toEqual([])
  })

  it('refuses `email-otp` without a challenge delivery', () => {
    const project = { tenant: plane({ identify: ['password', 'email-otp'] }) }
    expect(check(project, { implemented: { mfa: false, challengeDelivery: false, authFlow: true } })).toEqual([
      "authFlows.tenant: lists 'email-otp' and no challenge delivery is injected: pass challengeDeliveryManager to start(), wired to a mailer"
    ])
  })

  it('refuses a required `totp` stage without an MFA manager, and accepts the optional one of the defaults', () => {
    const project = { control: plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'] }] }] }) }
    expect(check(project, { implemented: { mfa: false, challengeDelivery: false, authFlow: true } })).toEqual([
      "authFlows.control: requires 'totp' in a stage that is not optional and this build has no MFA manager: inject mfaManager through start(decorators), or mark the stage optional"
    ])
  })

  it('refuses MANDATORY without an MFA manager, with the message of the policy check it extends', () => {
    expect(check(null, { policies: { floor: MfaPolicy.MANDATORY, control: MfaPolicy.MANDATORY } })).toEqual([
      'MFA_POLICY=MANDATORY demands a second factor and this build has no MFA manager: inject one through start(decorators), or lower the policy'
    ])
  })

  it('refuses MANDATORY on a plane where nobody could enrol, because the enrolment method is not registered there', () => {
    // A registry built by hand: the built-ins cannot be taken away, only replaced plane by plane.
    const registry = createAuthenticatorRegistry()
    for (const a of [passwordAuthenticator, { ...totpAuthenticator, planes: ['tenant'] as const }, emailOtp, oidc]) registry.register(a)
    const problems = check(null, {
      registry,
      implemented: { mfa: true, challengeDelivery: false, authFlow: false },
      policies: { floor: MfaPolicy.OPTIONAL, control: MfaPolicy.MANDATORY }
    })
    expect(problems).toEqual(oneMatching(/authFlows\.control: the control policy is MANDATORY, and a subject with no factor enrols in 'totp', which is not an authenticator of the control plane/))
  })

  it('refuses a flow that needs a second request without a flow store (F46)', () => {
    const required = { tenant: plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'] }] }] }) }
    expect(check(required, { implemented: { mfa: true, challengeDelivery: false, authFlow: false } })).toEqual([
      'authFlows.tenant: flow 1 has a stage that is not optional, and no flow store is injected: load the data layer or inject authFlowManager. Without one, only a password login with optional stages can run'
    ])
    // A method that starts something can never close in one request, even in an optional stage.
    const optionalOtp = { control: plane({ flows: [{ roles: ['*'], stages: [{ anyOf: ['email-otp'], optional: true }] }] }) }
    expect(check(optionalOtp, { implemented: { mfa: false, challengeDelivery: true, authFlow: false } })).toEqual([
      "authFlows.control: 'email-otp' starts a challenge or a redirect, and no flow store is injected: load the data layer or inject authFlowManager. Without one, only a password login with optional stages can run"
    ])
  })

  it('refuses `oidc` when openid-client cannot be imported, with the command that fixes it', async () => {
    const project = { tenant: plane({ identify: ['password', 'oidc'] }) }
    const implemented = { mfa: false, challengeDelivery: false, authFlow: true }
    expect(check(project, { implemented })).toEqual([
      "authFlows.tenant: lists 'oidc' and the openid-client library cannot be imported: npm i openid-client@^6"
    ])
    expect(check(project, { implemented, oidcLibrary: true })).toEqual([])

    // What the boot asks: only when a plane lists the method, and the answer is a boolean.
    expect(listsMethod(resolveAuthFlows(frameworkFlows, project), 'oidc')).toBe(true)
    expect(listsMethod(resolveAuthFlows(frameworkFlows), 'oidc')).toBe(false)
    expect(await canImport('node:crypto')).toBe(true)
    expect(await canImport('a-package-nobody-installed-for-this-test')).toBe(false)
  })

  it('refuses a limit that is not a positive integer', () => {
    expect(check({ limits: { otpMaxAttempts: 0, otpTtl: 1.5 } })).toEqual([
      'authFlows.limits.otpTtl must be a positive integer, got 1.5',
      'authFlows.limits.otpMaxAttempts must be a positive integer, got 0'
    ])
  })

  it('refuses a block of the wrong shape with a message, not a TypeError', () => {
    const malformed = (block: unknown) => check({ tenant: block as AuthPlaneFlows })
    expect(malformed('password')).toEqual(['authFlows.tenant: is not an object with `identify` and `flows`'])
    expect(malformed({ identify: 'password', flows: [] })).toEqual(['authFlows.tenant: `identify` must be a list of method ids'])
    expect(malformed({ identify: ['password'] })).toEqual(['authFlows.tenant: `flows` must be a list'])
    expect(malformed({ identify: ['password'], flows: [], providers: [] })).toEqual(['authFlows.tenant: `providers` must be an object keyed by provider name'])
    expect(malformed({ identify: ['password'], flows: [{ roles: '*' }] })).toEqual([
      'authFlows.tenant: flow 1 must have `roles` (a list of role codes) and `stages` (a list, possibly empty)'
    ])
    expect(malformed({ identify: ['password'], flows: [{ roles: ['*'], stages: [], identifiers: 'password' }] })).toEqual([
      'authFlows.tenant: flow 1: `identifiers` must be a list'
    ])
    expect(malformed({ identify: ['password'], flows: [{ roles: ['*'], stages: [{ anyOf: 'totp' }] }] })).toEqual([
      'authFlows.tenant: flow 1, stage 1: `anyOf` must be a list of method ids'
    ])
    expect(listsMethod({ ...resolveAuthFlows(frameworkFlows), tenant: 'broken' as unknown as AuthPlaneFlows }, 'totp')).toBe(true)
  })

  it('reads a manager the way the MFA one is read', () => {
    expect(isImplemented({ isImplemented: () => false })).toBe(false)
    expect(isImplemented({ isImplemented: () => true })).toBe(true)
    expect(isImplemented(undefined)).toBe(false)
  })
})
