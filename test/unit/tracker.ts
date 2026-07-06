/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { isFieldChanged } from '../../lib/util/tracker.js'

// isFieldChanged drives the change-log diff: primitives compare loosely, Dates via
// dayjs (instant equality), and relation-like objects compare by their primary key
// (read from global.trackingConfig.primaryKey).
export default () => {
  describe('util/tracker — isFieldChanged', () => {
    const prev = (global as any).trackingConfig
    before(() => {
      ;(global as any).trackingConfig = { primaryKey: 'id' }
    })
    after(() => {
      ;(global as any).trackingConfig = prev
    })

    describe('primitives', () => {
      it('detects a changed value', () => {
        expect(isFieldChanged(1, 2)).toBe(true)
        expect(isFieldChanged('a', 'b')).toBe(true)
      })
      it('reports no change for equal values', () => {
        expect(isFieldChanged(1, 1)).toBe(false)
        expect(isFieldChanged('a', 'a')).toBe(false)
      })
      it('uses loose equality (1 == "1")', () => {
        expect(isFieldChanged(1, '1')).toBe(false)
      })
    })

    describe('dates', () => {
      it('same instant (different Date objects) → no change', () => {
        expect(isFieldChanged(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(false)
      })
      it('different instant → changed', () => {
        expect(isFieldChanged(new Date('2026-01-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'))).toBe(true)
      })
    })

    describe('relation-like objects (compared by primary key)', () => {
      it('same id → no change', () => {
        expect(isFieldChanged({ id: 1, name: 'a' }, { id: 1, name: 'b' })).toBe(false)
      })
      it('different id → changed', () => {
        expect(isFieldChanged({ id: 1 }, { id: 2 })).toBe(true)
      })
      it('string id vs object relation with the same id → no change', () => {
        expect(isFieldChanged('x', { id: 'x' })).toBe(false)
      })
    })
  })
}
