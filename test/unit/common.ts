import { expect } from 'expect'
import { getData, getParams } from '../../lib/util/common.js'

// Request data extraction used by controllers via req.data()/req.parameters().
export default () => {
  describe('request data helpers (common)', () => {
    it('getData prefers query when it has meaningful values', () => {
      const req = { query: { a: 1 }, body: { b: 2 }, params: {} } as never
      expect(getData(req)).toEqual({ a: 1 })
    })

    it('getData falls back to body when query is empty/null-only', () => {
      expect(getData({ query: {}, body: { b: 2 }, params: {} } as never)).toEqual({ b: 2 })
      // a query made only of null/undefined values does not count as "having values"
      expect(getData({ query: { a: null, c: undefined }, body: { b: 2 }, params: {} } as never)).toEqual({ b: 2 })
    })

    it('getData returns an empty object when nothing is present', () => {
      expect(getData({ query: {}, body: {}, params: {} } as never)).toEqual({})
      expect(getData(undefined as never)).toEqual({})
    })

    it('getData returns a shallow clone (not the original reference)', () => {
      const query = { a: 1 }
      const out = getData({ query, body: {}, params: {} } as never)
      expect(out).toEqual({ a: 1 })
      expect(out).not.toBe(query)
    })

    it('getParams returns a clone of route params (or empty)', () => {
      expect(getParams({ params: { id: 'x' } } as never)).toEqual({ id: 'x' })
      expect(getParams({ params: {} } as never)).toEqual({})
      expect(getParams(undefined as never)).toEqual({})
    })
  })
}
