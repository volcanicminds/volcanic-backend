//
// T-8.1 / defect D-16: the wildcard is a decision, never a default nobody read.
//
// The tests are on the pure validator rather than on a boot, because the interesting cases
// are the ones that must STOP a boot, and a test that asserts by exiting the process asserts
// nothing.
//
import { expect } from 'expect'
import { corsOriginFromEnv, corsCredentialsFor, isWildcardOrigin, validateCorsOptions } from '../../lib/util/cors.js'

describe('util/cors · the allowlist from the environment (T-8.1)', () => {
  it('reads a comma-separated list, trimming what people actually type', () => {
    expect(corsOriginFromEnv('https://a.example, https://b.example')).toEqual([
      'https://a.example',
      'https://b.example'
    ])
  })

  it('drops empty entries left by a trailing comma', () => {
    expect(corsOriginFromEnv('https://a.example,,')).toEqual(['https://a.example'])
  })

  it('is a wildcard when unset, when blank, and when asked for one', () => {
    expect(corsOriginFromEnv(undefined)).toBe('*')
    expect(corsOriginFromEnv('   ')).toBe('*')
    expect(corsOriginFromEnv('*')).toBe('*')
  })

  it('collapses to a wildcard when one entry is a wildcard: an allowlist containing "any" is not an allowlist', () => {
    expect(corsOriginFromEnv('https://a.example,*')).toBe('*')
  })

  it('grants credentials only against a real allowlist', () => {
    expect(corsCredentialsFor(['https://a.example'])).toBe(true)
    expect(corsCredentialsFor('*')).toBe(false)
    expect(corsCredentialsFor(true)).toBe(false)
  })

  it('recognises every spelling of "any origin"', () => {
    expect(isWildcardOrigin('*')).toBe(true)
    expect(isWildcardOrigin(true)).toBe(true)
    expect(isWildcardOrigin(['https://a.example', '*'])).toBe(true)
    expect(isWildcardOrigin(['https://a.example'])).toBe(false)
    expect(isWildcardOrigin('https://a.example')).toBe(false)
  })
})

describe('util/cors · what refuses the boot (D-16)', () => {
  const prod = { prod: true, configured: true }
  const dev = { prod: false, configured: true }

  it('refuses the v4 default in production: wildcard with credentials', () => {
    const verdict = validateCorsOptions({ origin: '*', credentials: true }, prod)
    expect(verdict.ok).toBe(false)
    expect(verdict.fatal).toBe(true)
    expect(verdict.reason).toMatch(/browser/)
  })

  it('warns about the same pair off production instead of stopping the laptop', () => {
    const verdict = validateCorsOptions({ origin: '*', credentials: true }, dev)
    expect(verdict.ok).toBe(false)
    expect(verdict.fatal).toBe(false)
  })

  it('catches the pair however it is spelled', () => {
    expect(validateCorsOptions({ origin: true, credentials: true }, prod).fatal).toBe(true)
    expect(validateCorsOptions({ origin: ['https://a.example', '*'], credentials: true }, prod).fatal).toBe(true)
  })

  it('refuses a wildcard that arrived by omission in production', () => {
    const verdict = validateCorsOptions({ origin: '*', credentials: false }, { prod: true, configured: false })
    expect(verdict.ok).toBe(false)
    expect(verdict.fatal).toBe(true)
    expect(verdict.reason).toMatch(/CORS_ORIGINS/)
  })

  it('accepts a wildcard that someone wrote down, with no credentials: a public API is allowed to say so', () => {
    expect(validateCorsOptions({ origin: '*', credentials: false }, prod).ok).toBe(true)
  })

  it('accepts an allowlist with credentials, which is the point of the exercise', () => {
    expect(validateCorsOptions({ origin: ['https://a.example'], credentials: true }, prod).ok).toBe(true)
  })

  it('accepts a function origin: the consumer took the decision out of our hands', () => {
    expect(validateCorsOptions({ origin: () => true, credentials: true }, prod).ok).toBe(true)
  })
})
