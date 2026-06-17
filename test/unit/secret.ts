import { expect } from 'expect'
import { validateSecretStrength, MIN_SECRET_LENGTH } from '../../lib/util/secret.js'

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

    it('accepts a strong random secret', () => {
      const strong = 'kJ8$vQ2!mZx7Lp0wRt5Nb3Yc9Df6Hg1Aa' // >= 32 chars, high entropy
      expect(strong.length).toBeGreaterThanOrEqual(MIN_SECRET_LENGTH)
      const r = validateSecretStrength(strong)
      expect(r.ok).toBe(true)
      expect(r.missing).toBe(false)
    })
  })
}
