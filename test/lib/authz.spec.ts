/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { roleCodes, includesRole, isFounderEmail } from '../../lib/util/authz.js'

describe('util/authz', () => {
  it('normalizes string codes', () => {
    expect(roleCodes(['admin', 'public'])).toEqual(['admin', 'public'])
  })

  it('normalizes { code } objects', () => {
    expect(roleCodes([{ code: 'admin' }, { code: 'editor' }])).toEqual(['admin', 'editor'])
  })

  it('mixes forms and dedupes', () => {
    expect(roleCodes(['admin', { code: 'admin' }, 'editor'])).toEqual(['admin', 'editor'])
  })

  it('returns [] for non-array or empty inputs', () => {
    expect(roleCodes(undefined)).toEqual([])
    expect(roleCodes(null)).toEqual([])
    expect(roleCodes('admin' as any)).toEqual([])
  })

  it('includesRole detects a code in either form', () => {
    expect(includesRole(['a', 'admin'], 'admin')).toBe(true)
    expect(includesRole([{ code: 'admin' }], 'admin')).toBe(true)
    expect(includesRole(['a'], 'admin')).toBe(false)
    expect(includesRole(undefined, 'admin')).toBe(false)
  })

  describe('isFounderEmail', () => {
    const saved = process.env.ADMIN_EMAIL
    afterEach(() => {
      if (saved === undefined) delete process.env.ADMIN_EMAIL
      else process.env.ADMIN_EMAIL = saved
    })

    it('is false when ADMIN_EMAIL is unset', () => {
      delete process.env.ADMIN_EMAIL
      expect(isFounderEmail('a@b.com')).toBe(false)
    })

    it('matches case- and whitespace-insensitively', () => {
      process.env.ADMIN_EMAIL = 'Founder@X.com'
      expect(isFounderEmail('founder@x.com')).toBe(true)
      expect(isFounderEmail('  FOUNDER@X.COM ')).toBe(true)
      expect(isFounderEmail('other@x.com')).toBe(false)
    })

    it('is false for non-string input', () => {
      process.env.ADMIN_EMAIL = 'f@x.com'
      expect(isFounderEmail(undefined)).toBe(false)
      expect(isFounderEmail(null)).toBe(false)
    })
  })
})
