import crypto from 'crypto'
import type { AuthContext, AuthInput, AuthResult, AuthReturnInput, AuthSubject, Authenticator } from '../../../types/global.js'

//
// Two authenticators written only against the public contract, with no cast anywhere (T-12.2).
//
// Their point is the shapes the framework does not ship yet: an identifier that leaves the site
// with a posted form and comes back through `complete` (the shape of SAML), one that leaves with a
// redirect and comes back on a GET with a `state` the engine built (the shape of a social login
// over plain OAuth 2), and a verifier that sends a code and checks it (the shape of SMS). If the
// contract could not express them, the methods after this phase would each need a change to it.
//

export const FAKE_SUBJECT: AuthSubject = {
  id: 'u-1',
  externalId: 'ext-1',
  email: 'ada@example.test',
  roles: ['admin'],
  factors: ['sms'],
  confirmed: true,
  blocked: false
}

/**
 * SAML-shaped: `initiate` binds a `state` to the flow and answers a form to post, `complete`
 * receives the posted fields under `RelayState`, the name SAML gives the `state`.
 */
export const postReturnIdentifier: Authenticator = {
  id: 'fake-saml',
  kind: 'identifier',
  planes: ['tenant'],
  stateParam: 'RelayState',
  async initiate(ctx: AuthContext): Promise<AuthResult> {
    const relayState = `st1.${ctx.tenant?.id ?? 'ctl'}.${crypto.randomBytes(16).toString('base64url')}`
    if (!ctx.flow) return { outcome: 'fail', reason: 'FAKE_NO_FLOW' }
    await ctx.managers.authFlowManager.bindExternal(ctx.handle, ctx.flow.flowId, { state: relayState, external: { provider: 'fake-saml' } })
    return {
      outcome: 'redirect',
      binding: 'post',
      url: 'https://idp.example.test/sso',
      fields: { SAMLRequest: 'request', RelayState: relayState }
    }
  },
  async verify(ctx: AuthContext): Promise<AuthResult> {
    // The step after the return cashes what `complete` left in the flow.
    const result = ctx.flow?.externalResult
    if (!result) return { outcome: 'pending' }
    return { outcome: 'success', subject: FAKE_SUBJECT, satisfied: ['idp-mfa'] }
  },
  async complete(_ctx: AuthContext, input: AuthReturnInput): Promise<AuthResult> {
    if (input.SAMLResponse !== 'signed') return { outcome: 'fail', reason: 'FAKE_RESPONSE_INVALID' }
    return {
      outcome: 'success',
      subject: FAKE_SUBJECT,
      satisfied: ['idp-mfa'],
      external: { provider: 'fake-saml', issuer: 'https://idp.example.test', subject: FAKE_SUBJECT.externalId }
    }
  }
}

/**
 * Social-shaped, an OAuth 2 login without OpenID Connect: no ID token, only the provider's own
 * account id behind a `code`. `initiate` asks the engine for the round trip, so the `state` carries
 * the routing of the container and only its hash is stored; `complete` receives `code` and `state`
 * on a GET return, under the default parameter name.
 */
export const redirectReturnIdentifier: Authenticator = {
  id: 'fake-social',
  kind: 'identifier',
  planes: ['tenant', 'control'],
  async initiate(ctx: AuthContext): Promise<AuthResult> {
    const state = await ctx.roundTrip?.begin({ provider: 'fake-social', returnTo: '/after' })
    if (!state) return { outcome: 'fail', reason: 'FAKE_NO_FLOW' }
    return { outcome: 'redirect', binding: 'redirect', url: `https://social.example.test/authorize?client_id=app&state=${encodeURIComponent(state)}` }
  },
  async verify(ctx: AuthContext): Promise<AuthResult> {
    const result = ctx.flow?.externalResult
    if (!result) return { outcome: 'pending' }
    return { outcome: 'success', subject: FAKE_SUBJECT }
  },
  async complete(_ctx: AuthContext, input: AuthReturnInput): Promise<AuthResult> {
    if (input.code !== 'granted') return { outcome: 'fail', reason: 'FAKE_ACCESS_DENIED' }
    return {
      outcome: 'success',
      subject: FAKE_SUBJECT,
      external: { provider: 'fake-social', issuer: 'https://social.example.test', subject: 'social-42' }
    }
  }
}

/** SMS-shaped: `initiate` sends a code, `verify` checks it, `isEnrolled` reads the factors. */
export const challengeVerifier: Authenticator = {
  id: 'sms',
  kind: 'verifier',
  planes: ['tenant', 'control'],
  async initiate(): Promise<AuthResult> {
    return {
      outcome: 'challenge',
      challenge: { channel: 'sms', destination: '+39 *** *** 12', expiresAt: '2026-09-18T10:05:00.000Z', resendAt: null }
    }
  },
  async verify(_ctx: AuthContext, input: AuthInput): Promise<AuthResult> {
    return input.code === '123456' ? { outcome: 'success' } : { outcome: 'fail', reason: 'FAKE_CODE_INVALID' }
  },
  isEnrolled: (_ctx: AuthContext, subject: AuthSubject) => subject.factors.includes('sms')
}
