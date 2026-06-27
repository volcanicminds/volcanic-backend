/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E batch — the API-token management surface (/token): admin CRUD plus
// block/unblock. BEARER, single-tenant. tokenManager + Token entity are wired in
// the shared harness.
//
import { expect } from 'expect'
import { app, login, authHeader, getTokenById, seedConfirmedUser, ADMIN } from './harness.js'

describe('E2E — API token management (/token)', () => {
  const inject = (opts: any) => app().inject(opts)
  let adminTok: string
  let id: string
  let bearer: string

  before(async () => {
    adminTok = await login(ADMIN.email, ADMIN.password)
  })

  it('requires admin/backoffice (401 without a token)', async () => {
    const res = await inject({ method: 'GET', url: '/token' })
    expect(res.statusCode).toBe(401)
  })

  it('admin creates an API token (returns id + signed bearer)', async () => {
    const res = await inject({
      method: 'POST',
      url: '/token',
      headers: authHeader(adminTok),
      payload: { name: 'ci-token', description: 'for CI', requiredRoles: ['public'] }
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.id).toBeTruthy()
    expect(body.name).toBe('ci-token')
    expect(typeof body.token).toBe('string') // signed bearer
    expect(body.externalId).toBeTruthy()
    id = body.id
    bearer = body.token
  })

  it('rejects creation without a name (404)', async () => {
    const res = await inject({
      method: 'POST',
      url: '/token',
      headers: authHeader(adminTok),
      payload: { description: 'no name' }
    })
    expect(res.statusCode).toBe(404)
  })

  it('admin lists and counts tokens', async () => {
    const count = await inject({ method: 'GET', url: '/token/count', headers: authHeader(adminTok) })
    expect(count.statusCode).toBe(200)
    expect(JSON.parse(count.body)).toBeGreaterThanOrEqual(1)

    const list = await inject({ method: 'GET', url: '/token', headers: authHeader(adminTok) })
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body).some((t: any) => t.id === id)).toBe(true)
  })

  it('admin reads a token by id', async () => {
    const res = await inject({ method: 'GET', url: `/token/${id}`, headers: authHeader(adminTok) })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).name).toBe('ci-token')
  })

  it('admin updates a token', async () => {
    const res = await inject({
      method: 'PUT',
      url: `/token/${id}`,
      headers: authHeader(adminTok),
      payload: { description: 'updated' }
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).description).toBe('updated')
  })

  it('admin blocks then unblocks a token (persisted flag)', async () => {
    const blk = await inject({
      method: 'POST',
      url: `/token/block/${id}`,
      headers: authHeader(adminTok),
      payload: { reason: 'e2e' }
    })
    expect(blk.statusCode).toBe(200)
    expect(JSON.parse(blk.body)).toMatchObject({ ok: true })
    expect((await getTokenById(id)).blocked).toBe(true)

    const unb = await inject({ method: 'POST', url: `/token/unblock/${id}`, headers: authHeader(adminTok) })
    expect(unb.statusCode).toBe(200)
    expect(JSON.parse(unb.body)).toMatchObject({ ok: true })
    expect((await getTokenById(id)).blocked).toBe(false)
  })

  it('a non-admin cannot list tokens (403)', async () => {
    const email = 'token-nonadmin@e2e.test'
    await seedConfirmedUser(email, 'Tok-pw-123456')
    const userTok = await login(email, 'Tok-pw-123456')
    const res = await inject({ method: 'GET', url: '/token', headers: authHeader(userTok) })
    expect(res.statusCode).toBe(403)
  })

  it('admin deletes a token (afterwards 404)', async () => {
    const del = await inject({ method: 'DELETE', url: `/token/${id}`, headers: authHeader(adminTok) })
    expect(del.statusCode).toBe(200)
    expect(JSON.parse(del.body)).toMatchObject({ ok: true })
    const after = await inject({ method: 'GET', url: `/token/${id}`, headers: authHeader(adminTok) })
    expect(after.statusCode).toBe(404)
  })

  // The created bearer is unused by the auth assertions above but documents intent:
  it('exposes the signed bearer on creation (sanity)', () => {
    expect(bearer.split('.').length).toBe(3) // JWT shape
  })
})
