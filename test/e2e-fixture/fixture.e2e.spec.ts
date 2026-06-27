/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (consumer-app fixture) — exercises the framework's extensibility surface as
// a real app would: custom roles, custom-role-gated routes auto-discovered from
// src/api, a custom global middleware, a schema override, and the change-log
// (tracking) audit trail. Boots with cwd pointed at test/fixtures/app.
//
import { expect } from 'expect'
import { app, login, authHeader, widgetByName, listChanges, ADMIN, EDITOR, PLAIN } from './harness.js'

describe('E2E (consumer-app fixture) — extensibility surface', () => {
  const inject = (opts: any) => app().inject(opts)

  describe('custom role + auto-discovered route + custom middleware', () => {
    it('the custom widget route is registered and editor-gated (editor → 200)', async () => {
      const tok = await login(EDITOR.email, EDITOR.password)
      const res = await inject({ method: 'GET', url: '/widgets', headers: authHeader(tok) })
      expect(res.statusCode).toBe(200)
      expect(Array.isArray(JSON.parse(res.body))).toBe(true)
    })

    it('the custom global middleware ran (x-audited header present)', async () => {
      const tok = await login(EDITOR.email, EDITOR.password)
      const res = await inject({ method: 'GET', url: '/widgets', headers: authHeader(tok) })
      expect(res.headers['x-audited']).toBe('widgets')
    })

    it('a user without the custom role is forbidden (403)', async () => {
      const tok = await login(PLAIN.email, PLAIN.password)
      const res = await inject({ method: 'GET', url: '/widgets', headers: authHeader(tok) })
      expect(res.statusCode).toBe(403)
    })

    it('anonymous is unauthorized (401)', async () => {
      const res = await inject({ method: 'GET', url: '/widgets' })
      expect(res.statusCode).toBe(401)
    })

    it('admin (global superuser) can also reach the editor route (200)', async () => {
      const tok = await login(ADMIN.email, ADMIN.password)
      const res = await inject({ method: 'GET', url: '/widgets', headers: authHeader(tok) })
      expect(res.statusCode).toBe(200)
    })
  })

  describe('schema override (src/schemas overrides userSchema by $id)', () => {
    it('GET /users now exposes firstName (stripped by the base schema)', async () => {
      const tok = await login(ADMIN.email, ADMIN.password)
      const res = await inject({ method: 'GET', url: '/users', headers: authHeader(tok) })
      expect(res.statusCode).toBe(200)
      const editor = JSON.parse(res.body).find((u: any) => u.email === EDITOR.email)
      expect(editor).toBeTruthy()
      expect(editor.firstName).toBe('Edie') // only visible because the override added it
    })
  })

  describe('change-log (tracking) writes an audit row on a tracked mutation', () => {
    it('PUT /widgets/:id records a Change (entity=Widget, status=update)', async () => {
      const tok = await login(EDITOR.email, EDITOR.password)
      const w: any = await widgetByName('alpha')
      expect(w).toBeTruthy()

      const before = (await listChanges()).length
      const res = await inject({
        method: 'PUT',
        url: `/widgets/${w.id}`,
        headers: authHeader(tok),
        payload: { name: 'alpha-renamed' }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).name).toBe('alpha-renamed')

      const changes = await listChanges()
      expect(changes.length).toBe(before + 1)
      const last = changes.find((c: any) => c.entityId === w.id)
      expect(last).toBeTruthy()
      expect(last.entityName).toBe('Widget')
      expect(last.status).toBe('update')
      // the diff captured the name change
      expect(JSON.stringify(last.contents)).toContain('alpha-renamed')
    })
  })
})
