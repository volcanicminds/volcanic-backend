import { expect } from 'expect'
import * as regExp from '../../lib/util/regexp.js'

// Input validators used by auth (login/register/forgot/reset).
export default () => {
  describe('Validators (regexp)', () => {
    it('validates emails', () => {
      for (const ok of ['a@b.co', 'john.doe@example.com', 'user+tag@sub.domain.io']) {
        expect(regExp.email.test(ok)).toBe(true)
      }
      for (const bad of ['plainaddress', 'a@b', 'a@@b.com', 'a b@c.com', '@no-local.com']) {
        expect(regExp.email.test(bad)).toBe(false)
      }
    })

    it('enforces the password policy (>=8, upper/lower/digit/special)', () => {
      for (const ok of ['Aa1!aaaa', 'StrongP@ss1', 'xY9#weR2tq']) {
        expect(regExp.password.test(ok)).toBe(true)
      }
      for (const bad of ['Aa1!', 'alllowercase1!', 'NOLOWER1!', 'NoDigits!!']) {
        // each lacks at least one required class or is shorter than 8
        expect(regExp.password.test(bad)).toBe(false)
      }
    })

    // KNOWN BUG (not yet fixed — tightening it could lock out existing users at login):
    // the "special char" class `[...()-_=...]` contains an unintended range `)-_`
    // (0x29..0x5F), so letters/digits satisfy the "1 special char" rule.
    // e.g. 'NoSpecial1A' wrongly passes. Enable this once the regex is corrected.
    it('should require a real special character (KNOWN BUG: char-class range )-_)')

    it('validates usernames', () => {
      for (const ok of ['john', 'jo_hn', 'a1b2c3', 'mario-rossi']) {
        expect(regExp.username.test(ok)).toBe(true)
      }
      for (const bad of ['ab', '1user', '.dot', 'with space']) {
        expect(regExp.username.test(bad)).toBe(false)
      }
    })

    it('username regex is stateless across repeated calls (Q1 regression)', () => {
      // With a stray `g` flag, .test() would alternate true/false on the same input.
      for (let i = 0; i < 4; i++) {
        expect(regExp.username.test('john')).toBe(true)
      }
    })
  })
}
