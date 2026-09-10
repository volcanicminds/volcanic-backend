/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-8.2 / defect D-29: `req.data()` used to return the query string OR the body.
//
// The cliff was invisible from the outside: one unrelated query parameter — a `utm_source`
// added by a mail client, a cache-buster — and the whole body disappeared, so a login with
// the credentials in the body answered «Email not valid». These tests pin the merge and the
// precedence, because "it works on my request" is exactly what v4 also did.
//
import { expect } from 'expect'
import { getData, getQueryData, getBodyData, getParams } from '../../lib/util/common.js'

describe('util/common — getData (D-29)', () => {
  it('returns {} for a missing request', () => {
    expect(getData(undefined as any)).toEqual({})
    expect(getParams(undefined as any)).toEqual({})
  })

  it('merges query and body instead of choosing one', () => {
    const req: any = { query: { a: 1 }, body: { b: 2 } }
    expect(getData(req)).toEqual({ a: 1, b: 2 })
  })

  it('lets the body win on a shared key: the payload is what the caller meant to send', () => {
    const req: any = { query: { email: 'from-url' }, body: { email: 'from-body' } }
    expect(getData(req)).toEqual({ email: 'from-body' })
  })

  it('does not lose the body to an unrelated query parameter (the v4 regression)', () => {
    const req: any = { query: { utm_source: 'newsletter' }, body: { email: 'a@b.c', password: 'x' } }
    expect(getData(req)).toEqual({ utm_source: 'newsletter', email: 'a@b.c', password: 'x' })
  })

  it('keeps a null in the body: it is a value ("clear this field"), not an absence', () => {
    const req: any = { query: { note: 'kept-unless-overridden' }, body: { note: null } }
    expect(getData(req)).toEqual({ note: null })
  })

  it('does not let an undefined in the body erase the query value', () => {
    const req: any = { query: { a: 1 }, body: { a: undefined } }
    expect(getData(req)).toEqual({ a: 1 })
  })

  it('works with either source missing', () => {
    expect(getData({ body: { b: 2 } } as any)).toEqual({ b: 2 })
    expect(getData({ query: { a: 1 } } as any)).toEqual({ a: 1 })
    expect(getData({ query: {}, body: {} } as any)).toEqual({})
  })

  it('returns a shallow copy (not the original reference)', () => {
    const body = { b: 2 }
    const out = getData({ query: {}, body } as any)
    expect(out).toEqual({ b: 2 })
    expect(out).not.toBe(body)
  })
})

describe('util/common — queryData / bodyData (D-29)', () => {
  it('reads one source without the other', () => {
    const req: any = { query: { a: 1 }, body: { b: 2 } }
    expect(getQueryData(req)).toEqual({ a: 1 })
    expect(getBodyData(req)).toEqual({ b: 2 })
  })

  it('returns {} rather than undefined when the source is absent', () => {
    expect(getQueryData({ body: { b: 2 } } as any)).toEqual({})
    expect(getBodyData({ query: { a: 1 } } as any)).toEqual({})
    expect(getQueryData(undefined as any)).toEqual({})
    expect(getBodyData(undefined as any)).toEqual({})
  })
})

describe('util/common — getParams', () => {
  it('returns a copy of req.params', () => {
    const params = { id: '42' }
    const out = getParams({ params } as any)
    expect(out).toEqual({ id: '42' })
    expect(out).not.toBe(params)
  })
})
