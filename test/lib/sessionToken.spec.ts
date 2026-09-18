/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-11.6: the shape of the refresh credential, and the clocks around it.
//
// These are the parts that run on a string a stranger chose, so what matters is that every shape
// of input has an outcome and none of them is an exception: a token that throws on the renewal
// route is a 500 that tells the sender something about the inside of the process.
//
import { expect } from 'expect'
import {
  CONTROL_ROUTING,
  SESSION_TOKEN_VERSION,
  composeRefreshCredential,
  newSessionSecret,
  nextIdleExpiry,
  parseRefreshCredential,
  sessionExpiries,
  sessionLifetimes,
  sessionRegistryEnabled
} from '../../lib/util/session.js'

describe('session credential · four segments, one of them a secret (T-11.6)', () => {
  it('composes a token that names its container and its session, and parses back to the same parts', () => {
    const secret = newSessionSecret()
    const credential = composeRefreshCredential('id-acme', 'sid-1', secret)

    expect(credential.raw.startsWith(`${SESSION_TOKEN_VERSION}.id-acme.sid-1.`)).toBe(true)
    expect(parseRefreshCredential(credential.raw)).toEqual({ routing: 'id-acme', sid: 'sid-1', secret, raw: credential.raw })
  })

  it('mints a secret nobody can guess from another one', () => {
    const secrets = new Set(Array.from({ length: 50 }, () => newSessionSecret()))
    expect(secrets.size).toBe(50)
    // 32 bytes, base64url: 43 characters and no padding, so no separator of ours can appear in it.
    for (const secret of secrets) expect(/^[A-Za-z0-9_-]{43}$/.test(secret)).toBe(true)
  })

  it('answers null for everything that is not a credential, instead of throwing', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'short',
      'a.b.c',
      'vs1.tenant.sid',
      'vs2.tenant.sid.secret',
      'vs1..sid.secret',
      'vs1.tenant.sid.',
      'vs1.tenant.sid.secret.extra',
      // A JWT: three segments and a different alphabet in the header.
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature',
      `vs1.tenant.sid.${'x'.repeat(600)}`
    ]) {
      expect(parseRefreshCredential(bad as any)).toBeNull()
    }
  })

  it('reserves a routing segment for the platform, so a control session is addressable too', () => {
    const credential = composeRefreshCredential(CONTROL_ROUTING, 'sid-9', newSessionSecret())
    expect(parseRefreshCredential(credential.raw)?.routing).toBe(CONTROL_ROUTING)
  })
})

describe('session clocks · two deadlines and a tolerance (T-11.12, F23, F24)', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    for (const key of ['SESSION_IDLE_TTL', 'SESSION_ABSOLUTE_TTL', 'SESSION_GRACE_SECONDS', 'JWT_REFRESH']) {
      saved[key] = process.env[key]
      delete process.env[key]
    }
    ;(global as any).config = { options: {} }
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('falls back to thirty days of inactivity, a hundred and eighty of life, ten seconds of grace', () => {
    expect(sessionLifetimes()).toEqual({ idleSeconds: 2592000, absoluteSeconds: 15552000, graceSeconds: 10 })
  })

  it('reads the configuration block, and lets the environment override it', () => {
    ;(global as any).config = { options: { sessions: { idleTtl: 600, absoluteTtl: 7200, graceSeconds: 3 } } }
    expect(sessionLifetimes()).toEqual({ idleSeconds: 600, absoluteSeconds: 7200, graceSeconds: 3 })

    process.env.SESSION_IDLE_TTL = '120'
    expect(sessionLifetimes().idleSeconds).toBe(120)
  })

  it('accepts a grace of zero, which is a choice, and refuses a negative one, which is a typo', () => {
    process.env.SESSION_GRACE_SECONDS = '0'
    expect(sessionLifetimes().graceSeconds).toBe(0)
    process.env.SESSION_GRACE_SECONDS = '-5'
    expect(sessionLifetimes().graceSeconds).toBe(10)
  })

  it('never pushes the idle clock past the absolute one, or a session renewed often would never end', () => {
    const absolute = new Date(Date.now() + 60_000)
    expect(nextIdleExpiry(absolute).getTime()).toBe(absolute.getTime())

    const faraway = new Date(Date.now() + 400 * 86400 * 1000)
    expect(nextIdleExpiry(faraway).getTime()).toBeLessThan(faraway.getTime())
  })

  it('opens a session with both deadlines set from now', () => {
    const { idleExpiresAt, absoluteExpiresAt } = sessionExpiries(new Date(0))
    expect(idleExpiresAt.getTime()).toBe(2592000 * 1000)
    expect(absoluteExpiresAt.getTime()).toBe(15552000 * 1000)
  })
})

describe('session registry · when renewal exists at all (F28)', () => {
  afterEach(() => {
    delete process.env.JWT_REFRESH
    ;(global as any).config = { options: {} }
  })

  it('is off without a manager, because there is nowhere to write the row', () => {
    ;(global as any).config = { options: {} }
    expect(sessionRegistryEnabled(undefined)).toBe(false)
    expect(sessionRegistryEnabled({ isImplemented: () => false })).toBe(false)
    expect(sessionRegistryEnabled({ isImplemented: () => true })).toBe(true)
  })

  it('stays off when the deployment turned refresh tokens off, whatever the manager says', () => {
    process.env.JWT_REFRESH = 'false'
    expect(sessionRegistryEnabled({ isImplemented: () => true })).toBe(false)
  })

  it('stays off when the configuration block says so', () => {
    ;(global as any).config = { options: { sessions: { enabled: false } } }
    expect(sessionRegistryEnabled({ isImplemented: () => true })).toBe(false)
  })
})
