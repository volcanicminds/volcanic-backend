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
      for (const bad of ['Aa1!', 'alllowercase1!', 'NOLOWER1!', 'NoDigits!!', 'NoSpecial1A']) {
        // each lacks at least one required class or is shorter than 8
        expect(regExp.password.test(bad)).toBe(false)
      }
    })

    it('actually requires a special character (T3: char-class range )-_ fixed)', () => {
      // Without a real special char these must fail (previously passed via the )-_ range bug).
      expect(regExp.password.test('NoSpecial1A')).toBe(false)
      expect(regExp.password.test('Abcdefg1')).toBe(false)
      // With a real special char (including the literal '-') they pass.
      expect(regExp.password.test('NoSpecial1A!')).toBe(true)
      expect(regExp.password.test('Abcdefg1-')).toBe(true)
    })

    it('isEmail enforces a length bound (RFC 5321: 254) before matching', () => {
      const longLocal = 'a'.repeat(300) + '@b.co'
      expect(longLocal.length).toBeGreaterThan(regExp.MAX_EMAIL_LENGTH)
      expect(regExp.isEmail(longLocal)).toBe(false)
      expect(regExp.isEmail('')).toBe(false)
      expect(regExp.isEmail(undefined)).toBe(false)
      expect(regExp.isEmail('john.doe@example.com')).toBe(true)
    })

    it('email regex is linear on adversarial input (S10: no catastrophic backtracking)', () => {
      // Pre-fix, `\w+([.+-]?\w+)*` partitioned a run of word-chars exponentially:
      // ~34 chars took 20s. The required-separator form is linear; this must
      // complete in well under a second even with the regex tested directly.
      const evil = 'a'.repeat(60) + '!' // word-chars then a non-matching char, no `@`
      const start = process.hrtime.bigint()
      expect(regExp.email.test(evil)).toBe(false)
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
      expect(elapsedMs).toBeLessThan(100)
    })

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

    it('validates ZIP codes (5 digits, optional +4)', () => {
      for (const ok of ['00100', '12345', '12345-6789']) expect(regExp.zipCode.test(ok)).toBe(true)
      for (const bad of ['1234', '123456', 'abcde', '12345-67']) expect(regExp.zipCode.test(bad)).toBe(false)
    })

    it('validates company tax codes (optional 2-letter prefix + 11 digits)', () => {
      for (const ok of ['IT12345678901', '12345678901']) expect(regExp.taxCodeCompany.test(ok)).toBe(true)
      for (const bad of ['it12345678901', '1234567890', 'IT1234567890A']) {
        expect(regExp.taxCodeCompany.test(bad)).toBe(false)
      }
    })

    it('validates personal tax codes (Italian codice fiscale)', () => {
      expect(regExp.taxCodePersona.test('RSSMRA85T10A562S')).toBe(true)
      // invalid month letter (Z is not in the allowed set)
      expect(regExp.taxCodePersona.test('RSSMRA85Z10A562S')).toBe(false)
      expect(regExp.taxCodePersona.test('RSSMRA85T10A562')).toBe(false)
    })

    it('validates IBANs', () => {
      for (const ok of ['IT60X0542811101000000123456', 'GB29NWBK60161331926819']) {
        expect(regExp.iban.test(ok)).toBe(true)
      }
      for (const bad of ['XX', '1234', 'IT']) expect(regExp.iban.test(bad)).toBe(false)
    })

    it('validates Italian phone numbers', () => {
      expect(regExp.mobilePhone.test('3331234567')).toBe(true)
      expect(regExp.mobilePhone.test('+393331234567')).toBe(true)
      expect(regExp.mobilePhone.test('1234567890')).toBe(false)

      expect(regExp.landLinePhone.test('06 123456')).toBe(true)
      expect(regExp.landLinePhone.test('+39 06 12345')).toBe(true)
      expect(regExp.landLinePhone.test('333')).toBe(false)

      expect(regExp.tollFreePhone.test('800123456')).toBe(true)
      expect(regExp.tollFreePhone.test('+39800123456')).toBe(true)
      expect(regExp.tollFreePhone.test('12345')).toBe(false)
    })
  })
}
