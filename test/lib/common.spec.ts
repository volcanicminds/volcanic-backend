/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { getData, getParams } from '../../lib/util/common.js'

describe('util/common — getData / getParams', () => {
  it('returns {} for a missing request', () => {
    expect(getData(undefined as any)).toEqual({})
    expect(getParams(undefined as any)).toEqual({})
  })

  it('prefers query when it carries values', () => {
    const req: any = { query: { a: 1 }, body: { b: 2 } }
    expect(getData(req)).toEqual({ a: 1 })
  })

  it('falls back to body when query is empty/null', () => {
    expect(getData({ query: {}, body: { b: 2 } } as any)).toEqual({ b: 2 })
    expect(getData({ query: { a: null }, body: { b: 2 } } as any)).toEqual({ b: 2 })
  })

  it('returns {} when neither query nor body has values', () => {
    expect(getData({ query: {}, body: {} } as any)).toEqual({})
    expect(getData({ query: { a: undefined } } as any)).toEqual({})
  })

  it('returns a shallow copy (not the original reference)', () => {
    const body = { b: 2 }
    const out = getData({ query: {}, body } as any)
    expect(out).toEqual({ b: 2 })
    expect(out).not.toBe(body)
  })

  it('getParams returns a copy of req.params', () => {
    const params = { id: '42' }
    const out = getParams({ params } as any)
    expect(out).toEqual({ id: '42' })
    expect(out).not.toBe(params)
  })
})
