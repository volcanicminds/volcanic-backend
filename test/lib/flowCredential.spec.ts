/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.13: the flow credential and the return `state`.
//
// Both are strings a stranger chooses, so the property under test is that a malformed one is a
// refusal the caller writes and never an exception that becomes a 500. The size of `state` is the
// other one: it is dimensioned on the 80 bytes SAML allows `RelayState`, so the method deferred to
// a later phase can use the same format without a second rule.
//
import { expect } from 'expect'
import crypto from 'crypto'
import {
  composeFlowCredential,
  newFlowSecret,
  newFlowState,
  parseFlowCredential,
  parseFlowState,
  presentedFlow
} from '../../lib/util/flowCredential.js'

const request = (over: any = {}): any => ({
  cookies: {},
  unsignCookie: (value: string) => ({ valid: true, value }),
  body: {},
  ...over
})

describe('auth · the flow credential and the return state (T-12.13)', () => {
  let saved: string | undefined
  before(() => {
    saved = process.env.AUTH_MODE
  })
  after(() => {
    if (saved === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = saved
  })

  it('composes and reads back the four segments, and only the secret is a credential', () => {
    const secret = newFlowSecret()
    const credential = composeFlowCredential('id-acme', 'flow-1', secret)
    expect(credential.raw).toBe(`vf1.id-acme.flow-1.${secret}`)
    expect(parseFlowCredential(credential.raw)).toEqual(credential)
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('answers null for anything that is not a credential, instead of throwing', () => {
    const malformed = [
      undefined,
      null,
      42,
      '',
      'vf1.id-acme.flow-1',
      'vf1.id-acme.flow-1.secret.extra',
      'vs1.id-acme.flow-1.secret',
      'vf1..flow-1.secret',
      'vf1.id-acme.flow 1.secret',
      `vf1.id-acme.flow-1.${'x'.repeat(600)}`
    ]
    for (const raw of malformed) expect(parseFlowCredential(raw)).toBeNull()
  })

  it('mints a state that fits the 80 bytes of a SAML RelayState, with a UUID routing', () => {
    const state = newFlowState(crypto.randomUUID())
    expect(Buffer.byteLength(state.raw)).toBeLessThanOrEqual(80)
    expect(parseFlowState(state.raw)).toEqual(state)
    // Two states of one flow never coincide: the secret is 128 bits from the CSPRNG.
    expect(newFlowState('ctl').secret).not.toBe(newFlowState('ctl').secret)
    for (const raw of ['st1.ctl', 'vf1.ctl.secret', 'st1..secret', 7, undefined]) expect(parseFlowState(raw)).toBeNull()
  })

  it('reads the credential from the cookie in cookie mode and from the body in bearer mode, never the other', () => {
    const inCookie = request({ cookies: { auth_flow: 'from-cookie', control_flow: 'control-cookie' }, body: { flow: 'from-body' } })

    process.env.AUTH_MODE = 'COOKIE'
    expect(presentedFlow(inCookie, 'tenant')).toBe('from-cookie')
    expect(presentedFlow(inCookie, 'control')).toBe('control-cookie')
    expect(presentedFlow(request({ body: { flow: 'from-body' } }), 'tenant')).toBeUndefined()

    process.env.AUTH_MODE = 'BEARER'
    expect(presentedFlow(inCookie, 'tenant')).toBe('from-body')
    expect(presentedFlow(request({ body: { flow: 7 } }), 'tenant')).toBeUndefined()
    // The header is never a channel for it: the tenant resolution and the hook both read that one.
    expect(presentedFlow(request({ headers: { authorization: 'Bearer vf1.ctl.f.s' } }), 'tenant')).toBeUndefined()
  })
})
