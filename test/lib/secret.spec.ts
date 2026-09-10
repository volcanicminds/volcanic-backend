/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: the startup check on cryptographic secrets, which had no test at all.
//
// This is the gate that decides whether an instance with a forgeable signing key reaches
// production, and until now nothing had ever exercised it. `@fastify/jwt` refuses only a
// FALSY secret (`assert(options.secret, 'missing secret')`) and accepts a weak one happily, so
// this validator is the entire difference between "tokens are signed" and "tokens are signed
// with something an attacker can guess".
//
// The pure validator is tested directly and the policy through its verdict, because the
// enforcement half calls `process.exit` — a test that asserted by exiting the process would
// assert nothing, and would take the rest of the suite with it.
//
import { expect } from 'expect'
import { validateSecretStrength, MIN_SECRET_LENGTH } from '../../lib/util/secret.js'

;(global as any).log = {}

const STRONG = 'k7Qx9vLm2ZpR4tNwJ8cYb3HdF6sAeG5u' // 32 chars, plenty of distinct ones

describe('util/secret · what counts as a signing key (T-9.5)', () => {
  it('accepts a long, varied, unremarkable secret', () => {
    const { ok, missing, reason } = validateSecretStrength(STRONG)
    expect(ok).toBe(true)
    expect(missing).toBe(false)
    expect(reason).toBeUndefined()
  })

  it('separates missing from weak, because the two are enforced differently', () => {
    // Missing is fatal everywhere; weak is fatal in production and a warning otherwise. The
    // caller can only make that distinction if the verdict carries it.
    for (const value of [undefined, '', '    ']) {
      const verdict = validateSecretStrength(value)
      expect(verdict.ok).toBe(false)
      expect(verdict.missing).toBe(true)
    }

    const weak = validateSecretStrength('short')
    expect(weak.ok).toBe(false)
    expect(weak.missing).toBe(false)
  })

  it('refuses a secret shorter than the minimum, and says how short', () => {
    const verdict = validateSecretStrength('a1B2c3D4e5F6g7H8')
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('too short')
    // The number is in the message on purpose: "too short" without it sends the operator
    // guessing at the target.
    expect(verdict.reason).toContain(String(MIN_SECRET_LENGTH))
  })

  it('refuses a well-known value even when it has been padded to the right length', () => {
    // This is why the denylist is checked BEFORE the length, and by substring: every
    // placeholder is shorter than the minimum, so an exact match after a length check would
    // be dead code — and `changeme` plus filler is exactly what a hurried deployment ships.
    const padded = 'changeme' + 'x'.repeat(MIN_SECRET_LENGTH)
    expect(padded.length).toBeGreaterThan(MIN_SECRET_LENGTH)

    const verdict = validateSecretStrength(padded)
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('well-known')
    expect(verdict.reason).toContain('changeme')
  })

  it('catches the placeholders people actually leave behind', () => {
    for (const weak of ['your-secret-key', 'jwt_secret', 'supersecret', 'volcanic', 'letmein', 'passw0rd']) {
      const verdict = validateSecretStrength(weak.padEnd(MIN_SECRET_LENGTH + 8, 'Z9'))
      expect(verdict.ok).toBe(false)
      expect(verdict.reason).toContain('well-known')
    }
  })

  it('refuses a long secret made of almost no distinct characters', () => {
    // Length is not entropy. `abababab…` is 64 characters and two symbols, and a check that
    // only counted length would call it strong.
    const verdict = validateSecretStrength('ab'.repeat(32))
    expect(verdict.ok).toBe(false)
    expect(verdict.reason).toContain('low entropy')
  })

  it('ignores surrounding whitespace rather than counting it as strength', () => {
    // `JWT_SECRET=" abc "` in a .env file is a nine-character secret with padding, and
    // trimming is what stops the padding from paying for the length requirement.
    expect(validateSecretStrength(`   ${STRONG}   `).ok).toBe(true)
    expect(validateSecretStrength(`   short   `).ok).toBe(false)
  })
})
