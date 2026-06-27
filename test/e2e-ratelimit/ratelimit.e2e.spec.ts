/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (rate limiting) — credential-sensitive auth endpoints are throttled per IP
// (OWASP API2/API4: brute force / credential stuffing). Runs in its OWN mocha
// process with AUTH_RATELIMIT_MAX=3 so we can trip the limiter deterministically.
//
import { expect } from 'expect'
import { setup, teardown, app } from '../e2e/harness.js'

const MAX = Number(process.env.AUTH_RATELIMIT_MAX) || 3

describe('E2E (rate limiting) — auth endpoints throttle brute force', () => {
  const inject = (opts: any) => app().inject(opts)

  before(async function () {
    this.timeout(60000)
    await setup()
  })
  after(async () => await teardown())

  it(`POST /auth/login returns 429 after ${MAX} attempts in the window`, async () => {
    const attempt = () =>
      inject({ method: 'POST', url: '/auth/login', payload: { email: 'brute@e2e.test', password: 'wrong' } })

    const statuses: number[] = []
    for (let i = 0; i < MAX + 2; i++) statuses.push((await attempt()).statusCode)

    // the first MAX are processed (403 wrong creds), then the limiter kicks in (429)
    expect(statuses.slice(0, MAX).every((s) => s !== 429)).toBe(true)
    expect(statuses.some((s) => s === 429)).toBe(true)
  })

  it('POST /auth/forgot-password is throttled too', async () => {
    const attempt = () =>
      inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'brute@e2e.test' } })
    const statuses: number[] = []
    for (let i = 0; i < MAX + 2; i++) statuses.push((await attempt()).statusCode)
    expect(statuses.some((s) => s === 429)).toBe(true)
  })
})
