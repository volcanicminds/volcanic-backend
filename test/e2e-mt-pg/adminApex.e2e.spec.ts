/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The admin apex of a tenant over HTTP on real Postgres.
//
// Demoting, blocking or deleting an admin asks first whether it is the last one, and that count
// filters an array column: only real Postgres says whether the filter is one it accepts. The
// question is the same SQL under both strategies, so one strategy answers it.
//
import { expect } from 'expect'
import { setup, teardown, inject, systemToken, createTenant, login, bearer, ACME } from './harness.js'

const body = (res: any) => JSON.parse(res.body)

describe('The admin apex of a tenant, on real Postgres', function () {
  this.timeout(60000)

  let admin: (method: string, url: string, payload?: unknown) => ReturnType<typeof inject>
  let several: unknown

  before(async () => {
    await setup({}, { strategy: 'schema' })
    await createTenant(await systemToken(), ACME)
    const token = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    admin = (method, url, payload) => inject({ method, url, headers: bearer(token, ACME.slug), ...(payload === undefined ? {} : { payload }) })
    several = global.config.options.allow_multiple_admin
    global.config.options.allow_multiple_admin = true
  })

  after(async () => {
    global.config.options.allow_multiple_admin = several as never
    await teardown()
  })

  it('lets an admin demote, block and delete another admin while the founder stays', async () => {
    const created = await admin('POST', '/users', { email: 'second@acme.test', password: 'Second-pw-123456', roles: ['admin'] })
    expect(created.statusCode).toBe(200)
    const { id } = body(created)

    for (const [method, url, payload] of [
      ['PUT', `/users/${id}`, { roles: ['public'] }],
      ['PUT', `/users/${id}`, { roles: ['admin'] }],
      ['POST', `/users/${id}/block`, { reason: 'left' }],
      ['DELETE', `/users/${id}`, undefined]
    ] as const) {
      const res = await admin(method, url, payload)
      expect([method, url, res.statusCode]).toEqual([method, url, 200])
    }
  })
})
