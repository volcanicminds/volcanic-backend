//
// E2E (consumer-app fixture) — per-route rate limit. The rate-limit plugin is
// registered with `global: false`, so only routes that declare their own
// `rateLimit` are throttled. `/cached/limited` allows 2 requests, then 429s.
//
import { expect } from 'expect'
import { app } from './harness.js'

describe('E2E (consumer-app fixture) — per-route rate limit', () => {
  it('throttles a route beyond its declared max (429)', async () => {
    const hit = () => app().inject({ method: 'GET', url: '/cached/limited' })
    const statuses: number[] = []
    for (let i = 0; i < 4; i++) statuses.push((await hit()).statusCode)
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1)
    expect(statuses.some((s) => s === 429)).toBe(true)
  })
})
