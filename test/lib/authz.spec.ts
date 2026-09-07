/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { roleCodes, includesRole, isFounder } from '../../lib/util/authz.js'

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

  // T-4.3: the founder is a property of the row, in its own container. v4 asked the process
  // environment, so in multi-tenant the same address was sovereign inside EVERY tenant and
  // one customer's admin inherited another's protections (defect D-27).
  describe('isFounder', () => {
    const saved = process.env.ADMIN_EMAIL
    afterEach(() => {
      if (saved === undefined) delete process.env.ADMIN_EMAIL
      else process.env.ADMIN_EMAIL = saved
    })

    it('reads the column, and only the column', () => {
      expect(isFounder({ email: 'a@b.com', isFounder: true })).toBe(true)
      expect(isFounder({ email: 'a@b.com', isFounder: false })).toBe(false)
      expect(isFounder({ email: 'a@b.com' })).toBe(false)
    })

    it('does not consult the environment, whatever it says', () => {
      process.env.ADMIN_EMAIL = 'founder@x.com'
      // The address matches the variable and the row does not carry the flag: in v4 this
      // returned true, and in every tenant at once.
      expect(isFounder({ email: 'founder@x.com' })).toBe(false)
      // And the flag is enough without the variable.
      delete process.env.ADMIN_EMAIL
      expect(isFounder({ email: 'someone@else.com', isFounder: true })).toBe(true)
    })

    it('is false for anything that is not a row', () => {
      expect(isFounder(undefined)).toBe(false)
      expect(isFounder(null)).toBe(false)
      expect(isFounder('founder@x.com')).toBe(false)
      // Not truthiness: a string is not a flag.
      expect(isFounder({ isFounder: 'yes' })).toBe(false)
    })
  })
})
