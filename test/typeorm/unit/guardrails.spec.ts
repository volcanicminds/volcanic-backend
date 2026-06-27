/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Performance GUARDRAILS (part of the normal suite).
//
// These are NOT benchmarks. They use deliberately HUGE budgets (3-5x the
// observed time) and only catch CATASTROPHIC regressions: an accidental O(n^2),
// an infinite/expensive loop, or ReDoS-style blowups. They must never flake on a
// busy CI runner. Real numbers live in the separate `npm run test:perf` suite.
//
import { expect } from 'expect'
import { applyQuery, useWhere } from '../../../lib/database/typeorm/query.js'
import { parseLogicExpression } from '../../../lib/database/typeorm/query/parser.js'

const ms = (fn: () => void) => {
  const start = process.hrtime.bigint()
  fn()
  return Number(process.hrtime.bigint() - start) / 1e6
}

describe('Magic Query — performance guardrails (loose budgets)', () => {
  it('applyQuery stays linear over many translations (no catastrophic regression)', () => {
    const data = {
      page: 2,
      pageSize: 50,
      sort: ['name:asc', 'createdAt:desc'],
      'name:containsi': 'abc',
      'price:gt': '10',
      'status:in': 'a,b,c',
      'profile.age:ge': '18'
    }
    const elapsed = ms(() => {
      for (let i = 0; i < 10_000; i++) applyQuery({ ...data }, {}, null)
    })
    // ~tens of ms in practice; 4s is a generous "did something hang?" budget.
    expect(elapsed).toBeLessThan(4000)
  })

  it('useWhere handles a wide filter object quickly', () => {
    const wide: any = {}
    for (let i = 0; i < 200; i++) wide[`field${i}:gt`] = String(i)
    const elapsed = ms(() => {
      for (let i = 0; i < 1000; i++) useWhere({ ...wide })
    })
    expect(elapsed).toBeLessThan(4000)
  })

  it('parseLogicExpression does not blow up on deep nesting', () => {
    // 300 nested groups: must be linear-ish, not exponential.
    const expr = '('.repeat(300) + 'a' + ')'.repeat(300)
    const elapsed = ms(() => {
      parseLogicExpression(expr)
    })
    expect(elapsed).toBeLessThan(1000)
  })

  it('parseLogicExpression handles a long flat AND/OR chain', () => {
    const expr = Array.from({ length: 500 }, (_, i) => `a${i}`).join(' AND ')
    const elapsed = ms(() => {
      parseLogicExpression(expr)
    })
    expect(elapsed).toBeLessThan(1000)
  })
})
