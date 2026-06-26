import { expect } from 'expect'
import { validateSecretStrength, assertSecretStrength, MIN_SECRET_LENGTH } from '../../lib/util/secret.js'

// Run `fn` capturing any process.exit() call; returns the exit code or null.
function captureExit(fn: () => void): number | null {
  const original = process.exit
  let code: number | null = null
   
  process.exit = ((c?: number) => {
    code = c ?? 0
    throw new Error('__exit__')
  }) as any
  try {
    fn()
  } catch (err) {
    if ((err as Error).message !== '__exit__') throw err
  } finally {
    process.exit = original
  }
  return code
}

// S2 — fail-fast on missing/weak signing secrets.
export default () => {
  describe('Secret strength (S2)', () => {
    it('flags a missing/empty secret as missing', () => {
      for (const v of [undefined, '', '   ']) {
        const r = validateSecretStrength(v as string | undefined)
        expect(r.ok).toBe(false)
        expect(r.missing).toBe(true)
      }
    })

    it('rejects secrets shorter than the minimum length', () => {
      const short = 'aB3$' + 'x'.repeat(MIN_SECRET_LENGTH - 5) // length = MIN - 1
      const r = validateSecretStrength(short)
      expect(r.ok).toBe(false)
      expect(r.missing).toBe(false)
      expect(r.reason).toMatch(/too short/)
    })

    it('rejects long but low-entropy secrets', () => {
      const r = validateSecretStrength('a'.repeat(MIN_SECRET_LENGTH + 8))
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/low entropy/)
    })

    it('rejects well-known/default values even when padded to the minimum length', () => {
      // A weak token padded to >= 32 chars must still be caught (substring match,
      // checked before the length rule — otherwise this would be dead code).
      const padded = 'changeme'.padEnd(MIN_SECRET_LENGTH + 8, 'x')
      const r = validateSecretStrength(padded)
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/well-known\/default/)

      const containsToken = 'MyVeryLongPassphraseWith-token-inside-xyz1'
      expect(validateSecretStrength(containsToken).ok).toBe(false)
    })

    it('accepts a strong random secret', () => {
      const strong = 'kJ8$vQ2!mZx7Lp0wRt5Nb3Yc9Df6Hg1Aa' // >= 32 chars, high entropy
      expect(strong.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH)
      const r = validateSecretStrength(strong)
      expect(r.ok).toBe(true)
      expect(r.missing).toBe(false)
    })

    const STRONG = 'kJ8$vQ2!mZx7Lp0wRt5Nb3Yc9Df6Hg1Aa'
    const WEAK = 'a'.repeat(MIN_SECRET_LENGTH + 8) // long but low entropy

    it('assertSecretStrength: a missing secret is always fatal (even in dev)', () => {
      expect(captureExit(() => assertSecretStrength('JWT_SECRET', undefined, { prod: false }))).toBe(1)
      expect(captureExit(() => assertSecretStrength('JWT_SECRET', '', { prod: true }))).toBe(1)
    })

    it('assertSecretStrength: a weak secret is fatal only in production', () => {
      expect(captureExit(() => assertSecretStrength('JWT_SECRET', WEAK, { prod: true }))).toBe(1)
      // non-production: tolerated (warning), no exit
      expect(captureExit(() => assertSecretStrength('JWT_SECRET', WEAK, { prod: false }))).toBeNull()
    })

    it('assertSecretStrength: a strong secret never exits', () => {
      expect(captureExit(() => assertSecretStrength('JWT_SECRET', STRONG, { prod: true }))).toBeNull()
      expect(captureExit(() => assertSecretStrength('JWT_SECRET', STRONG, { prod: false }))).toBeNull()
    })
  })
}
