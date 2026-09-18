//
// T-12.2 and T-12.3: the authenticator contract and the registry that holds it, plane by plane.
//
import { expect } from 'expect'
import type { AuthContext, Authenticator, AuthResult } from '../../types/global.js'
import { MfaPolicy } from '../../lib/config/constants.js'
import { buildAuthenticatorRegistry, createAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { passwordAuthenticator, totpAuthenticator } from '../../lib/auth/builtins.js'
import { FAKE_SUBJECT, challengeVerifier, postReturnIdentifier } from './fixtures/authenticators.js'

type Globals = { log?: unknown }
const globals = globalThis as unknown as Globals

function captureLog(): string[] {
  const lines: string[] = []
  globals.log = { w: true, warn: (line: string) => lines.push(line) }
  return lines
}

function contextWith(over: Partial<AuthContext> = {}): AuthContext {
  return {
    plane: 'tenant',
    handle: {} as AuthContext['handle'],
    tenant: null,
    subject: null,
    policy: MfaPolicy.OPTIONAL,
    managers: {} as AuthContext['managers'],
    flow: null,
    ...over
  }
}

describe('auth · authenticator contract and registry (T-12.2, T-12.3)', () => {
  let saved: unknown
  beforeEach(() => {
    saved = globals.log
  })
  afterEach(() => {
    globals.log = saved
  })

  it('registers the built-ins on both planes, password as identifier and totp as verifier', () => {
    const registry = buildAuthenticatorRegistry()
    for (const plane of ['tenant', 'control'] as const) {
      expect(registry.get(plane, 'password')?.kind).toBe('identifier')
      expect(registry.get(plane, 'totp')?.kind).toBe('verifier')
      expect(registry.list(plane).map((a) => a.id)).toEqual(['password', 'totp'])
    }
  })

  it('lets an injected authenticator with a built-in id replace it, and says so at log', () => {
    const lines = captureLog()
    const own: Authenticator = { id: 'totp', kind: 'verifier', planes: ['tenant', 'control'], verify: async () => ({ outcome: 'success' }) }

    const registry = buildAuthenticatorRegistry([own])

    expect(registry.get('tenant', 'totp')).toBe(own)
    expect(registry.get('control', 'totp')).toBe(own)
    expect(lines).toEqual([
      "Authenticators: 'totp' replaced on the tenant plane",
      "Authenticators: 'totp' replaced on the control plane"
    ])
  })

  it('keeps a tenant-only authenticator out of the control plane, including a replacement', () => {
    captureLog()
    const tenantTotp: Authenticator = { ...totpAuthenticator, planes: ['tenant'] }
    const registry = buildAuthenticatorRegistry([postReturnIdentifier, tenantTotp])

    expect(registry.get('tenant', 'fake-saml')).toBe(postReturnIdentifier)
    expect(registry.get('control', 'fake-saml')).toBeUndefined()
    expect(registry.list('control').map((a) => a.id)).not.toContain('fake-saml')
    // Replaced where it was declared, untouched where it was not.
    expect(registry.get('tenant', 'totp')).toBe(tenantTotp)
    expect(registry.get('control', 'totp')).toBe(totpAuthenticator)
  })

  it('refuses at registration an authenticator the engine could not call', () => {
    const registry = createAuthenticatorRegistry()
    const verify = async (): Promise<AuthResult> => ({ outcome: 'pending' })
    const broken = (shape: Record<string, unknown>) => () => registry.register(shape as unknown as Authenticator)

    expect(broken({ id: ' ', kind: 'verifier', planes: ['tenant'], verify })).toThrow(/non-empty `id`/)
    expect(broken({ id: 'x', kind: 'second', planes: ['tenant'], verify })).toThrow(/kind must be 'identifier', 'verifier' or both/)
    expect(broken({ id: 'x', kind: [], planes: ['tenant'], verify })).toThrow(/kind must be/)
    expect(broken({ id: 'x', kind: 'verifier', planes: [], verify })).toThrow(/planes must list/)
    expect(broken({ id: 'x', kind: 'verifier', planes: ['everywhere'], verify })).toThrow(/planes must list/)
    expect(broken({ id: 'x', kind: 'verifier', planes: ['tenant'] })).toThrow(/verify must be a function/)
    expect(() => buildAuthenticatorRegistry({ id: 'x' })).toThrow(/expected an array of authenticators/)
  })

  it('expresses a SAML-shaped identifier: a posted form out, the posted fields back', async () => {
    const ctx = contextWith({ tenant: { id: 't-1' } as AuthContext['tenant'] })

    const out = await postReturnIdentifier.initiate!(ctx, {})
    expect(out).toMatchObject({ outcome: 'redirect', binding: 'post', fields: { RelayState: 'st1.t-1.secret' } })

    expect(await postReturnIdentifier.complete!(ctx, { SAMLResponse: 'forged' })).toEqual({ outcome: 'fail', reason: 'FAKE_RESPONSE_INVALID' })
    expect(await postReturnIdentifier.complete!(ctx, { SAMLResponse: 'signed' })).toMatchObject({ outcome: 'success', satisfied: ['idp-mfa'] })

    expect(await postReturnIdentifier.verify(ctx, {})).toEqual({ outcome: 'pending' })
    const returned = contextWith({ flow: { externalResult: { provider: 'p', issuer: 'i', subject: 's' } } as AuthContext['flow'] })
    expect(await postReturnIdentifier.verify(returned, {})).toMatchObject({ outcome: 'success', subject: FAKE_SUBJECT })
  })

  it('expresses an SMS-shaped verifier: a challenge out, a code back, enrolment read from the subject', async () => {
    const ctx = contextWith({ subject: FAKE_SUBJECT })

    expect(await challengeVerifier.initiate!(ctx, {})).toMatchObject({ outcome: 'challenge', challenge: { channel: 'sms' } })
    expect(await challengeVerifier.verify(ctx, { code: '000000' })).toEqual({ outcome: 'fail', reason: 'FAKE_CODE_INVALID' })
    expect(await challengeVerifier.verify(ctx, { code: '123456' })).toEqual({ outcome: 'success' })
    expect(challengeVerifier.isEnrolled!(ctx, FAKE_SUBJECT)).toBe(true)
    expect(challengeVerifier.isEnrolled!(ctx, { ...FAKE_SUBJECT, factors: [] })).toBe(false)
  })

  it('has built-ins that refuse with a code until the engine serves them, and totp enrolment read from the factors', async () => {
    const ctx = contextWith()
    for (const builtin of [passwordAuthenticator, totpAuthenticator]) {
      const result = await builtin.verify(ctx, {})
      expect(result.outcome).toBe('fail')
      expect(result.outcome === 'fail' && /^[A-Z][A-Z0-9_]+$/.test(result.reason)).toBe(true)
    }
    expect(totpAuthenticator.isEnrolled!(ctx, { ...FAKE_SUBJECT, factors: ['totp'] })).toBe(true)
    expect(totpAuthenticator.isEnrolled!(ctx, FAKE_SUBJECT)).toBe(false)
  })
})
