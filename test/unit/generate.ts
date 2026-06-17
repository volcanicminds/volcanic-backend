import { expect } from 'expect'
import { newAuthCode } from '../../lib/util/generate.js'

// Auth code generation (nanoid, alphanumeric). Size driven by AUTH_CODE_SIZE.
export default () => {
  describe('newAuthCode (generate)', () => {
    it('defaults to a 10-char alphanumeric code', () => {
      const code = newAuthCode()
      expect(code).toHaveLength(10)
      expect(code).toMatch(/^[0-9A-Za-z]+$/)
    })

    it('honors AUTH_CODE_SIZE', () => {
      const prev = process.env.AUTH_CODE_SIZE
      process.env.AUTH_CODE_SIZE = '16'
      try {
        expect(newAuthCode()).toHaveLength(16)
      } finally {
        if (prev === undefined) delete process.env.AUTH_CODE_SIZE
        else process.env.AUTH_CODE_SIZE = prev
      }
    })

    it('produces distinct codes across calls (no shared state)', () => {
      const codes = new Set(Array.from({ length: 50 }, () => newAuthCode()))
      // Collisions on a 10-char/62-alphabet code are astronomically unlikely.
      expect(codes.size).toBe(50)
    })
  })
}
