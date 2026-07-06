//
// E2E (consumer-app fixture) — native tool API. `POST /tool/synchronize-schemas`
// is admin-only (roles: [admin] + isAuthenticated). Covers the auth gate and the
// implemented-manager success path (single-tenant fixture).
//
import { expect } from 'expect'
import { app, login, authHeader, ADMIN, EDITOR } from './harness.js'

describe('E2E (consumer-app fixture) — tool: synchronize-schemas', () => {
  const url = '/tool/synchronize-schemas'

  it('anonymous is unauthorized (401)', async () => {
    const res = await app().inject({ method: 'POST', url })
    expect(res.statusCode).toBe(401)
  })

  it('a non-admin (editor) is forbidden (403)', async () => {
    const tok = await login(EDITOR.email, EDITOR.password)
    const res = await app().inject({ method: 'POST', url, headers: authHeader(tok) })
    expect(res.statusCode).toBe(403)
  })

  it('an admin gets 200 { ok: true }', async () => {
    const tok = await login(ADMIN.email, ADMIN.password)
    const res = await app().inject({ method: 'POST', url, headers: authHeader(tok) })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ ok: true })
  })
})
