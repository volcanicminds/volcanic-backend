import { expect } from 'expect'
import yn from '../../lib/util/yn.js'

// Boolean env/config coercion used across the framework (yn = "yes/no").
export default () => {
  describe('yn (boolean coercion)', () => {
    it('coerces truthy spellings to true', () => {
      for (const v of ['y', 'Y', 'yes', 'YES', 'true', 'TRUE', '1', 'on', 'ON', ' true ']) {
        expect(yn(v, false)).toBe(true)
      }
    })

    it('coerces falsy spellings to false', () => {
      for (const v of ['n', 'N', 'no', 'NO', 'false', 'FALSE', '0', 'off', 'OFF', ' false ']) {
        expect(yn(v, true)).toBe(false)
      }
    })

    it('returns the default for nullish input', () => {
      expect(yn(undefined, true)).toBe(true)
      expect(yn(undefined, false)).toBe(false)
      expect(yn(null, true)).toBe(true)
      expect(yn(null, false)).toBe(false)
    })

    it('returns the default (or false) for unrecognized input', () => {
      expect(yn('maybe', true)).toBe(true)
      expect(yn('maybe', false)).toBe(false)
      // default coalesces to false when falsy
      expect(yn('whatever', undefined as unknown as boolean)).toBe(false)
    })

    it('accepts non-string truthy/falsy values via String() coercion', () => {
      expect(yn(1, false)).toBe(true)
      expect(yn(0, true)).toBe(false)
    })
  })
}
