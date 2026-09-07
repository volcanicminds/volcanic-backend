//
// T-2.1: identifiers are minted in process. v4 looked for a free one with a `do/while`
// around a query, for users and for tokens (D-28) — a round trip per insert to avoid a
// collision that does not happen.
//
import { expect } from 'expect'
import { uuidv7, uuidv7Time } from '../../lib/database/uuid.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('database/uuid · v7', () => {
  it('is a well-formed v7 with the RFC variant bits', () => {
    const id = uuidv7()
    expect(id).toMatch(UUID)
    expect(id[14]).toBe('7') // version nibble
    expect(['8', '9', 'a', 'b']).toContain(id[19]) // variant 10xx
  })

  it('sorts by creation time, which is the reason for choosing v7', () => {
    const ids = Array.from({ length: 500 }, () => uuidv7())
    expect([...ids].sort()).toEqual(ids)
  })

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 20000 }, () => uuidv7()))
    expect(ids.size).toBe(20000)
  })

  it('carries the instant it was minted', () => {
    const before = Date.now()
    const at = uuidv7Time(uuidv7()).getTime()
    expect(at).toBeGreaterThanOrEqual(before - 1)
    expect(at).toBeLessThanOrEqual(Date.now())
  })
})
