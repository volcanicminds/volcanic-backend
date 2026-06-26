import { expect } from 'expect'
import yn from '../../../lib/database/typeorm/util/yn.js'
import { ServiceError } from '../../../lib/database/typeorm/util/error.js'

describe('util', () => {
  describe('yn (boolean coercion)', () => {
    it('coerces truthy spellings to true', () => {
      for (const v of ['y', 'YES', 'true', '1', 'on', ' true ']) expect(yn(v, false)).toBe(true)
    })

    it('coerces falsy spellings to false', () => {
      for (const v of ['n', 'NO', 'false', '0', 'off', ' false ']) expect(yn(v, true)).toBe(false)
    })

    it('returns the default for nullish input', () => {
      expect(yn(undefined, true)).toBe(true)
      expect(yn(null, false)).toBe(false)
    })

    it('returns the default (coalesced to false) for unrecognized input', () => {
      expect(yn('maybe', true)).toBe(true)
      expect(yn('maybe', false)).toBe(false)
      expect(yn('whatever', undefined as unknown as boolean)).toBe(false)
    })
  })

  describe('ServiceError', () => {
    it('defaults the status code to 500', () => {
      const err = new ServiceError('boom')
      expect(err).toBeInstanceOf(Error)
      expect(err.message).toBe('boom')
      expect(err.statusCode).toBe(500)
    })

    it('honors a custom status code', () => {
      expect(new ServiceError('not found', 404).statusCode).toBe(404)
      expect(new ServiceError('bad request', 400).statusCode).toBe(400)
    })
  })
})
