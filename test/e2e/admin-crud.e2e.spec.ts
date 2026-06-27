/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E batch — admin user management: CRUD on /users plus block/unblock, and the
// authorization boundary (non-admin cannot create). BEARER, single-tenant.
//
import { expect } from 'expect'
import { app, login, authHeader, seedConfirmedUser, getUserByEmail, ADMIN } from './harness.js'

const PW = 'Crud-pw-123456'

describe('E2E — admin user management (CRUD + block)', () => {
  const inject = (opts: any) => app().inject(opts)
  let adminTok: string

  before(async () => {
    adminTok = await login(ADMIN.email, ADMIN.password)
  })

  describe('CRUD', () => {
    const email = 'crud-create@e2e.test'
    let id: string

    it('admin creates a user', async () => {
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email, password: PW, username: 'cruduser', roles: ['public'] }
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.email).toBe(email)
      expect(body.id).toBeTruthy()
      id = body.id
    })

    it('admin reads the user by id', async () => {
      const res = await inject({ method: 'GET', url: `/users/${id}`, headers: authHeader(adminTok) })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).email).toBe(email)
    })

    it('admin lists and counts users', async () => {
      const count = await inject({ method: 'GET', url: '/users/count', headers: authHeader(adminTok) })
      expect(count.statusCode).toBe(200)
      expect(JSON.parse(count.body)).toBeGreaterThanOrEqual(1)

      const list = await inject({ method: 'GET', url: '/users', headers: authHeader(adminTok) })
      expect(list.statusCode).toBe(200)
      expect(JSON.parse(list.body).some((u: any) => u.id === id)).toBe(true)
    })

    it('admin updates the user', async () => {
      const res = await inject({
        method: 'PUT',
        url: `/users/${id}`,
        headers: authHeader(adminTok),
        payload: { username: 'crud-renamed' }
      })
      expect(res.statusCode).toBe(200)
      const after = await getUserByEmail(email)
      expect(after.username).toBe('crud-renamed')
    })

    it('admin deletes the user (afterwards 404)', async () => {
      const del = await inject({ method: 'DELETE', url: `/users/${id}`, headers: authHeader(adminTok) })
      expect(del.statusCode).toBe(200)
      const after = await inject({ method: 'GET', url: `/users/${id}`, headers: authHeader(adminTok) })
      expect(after.statusCode).toBe(404)
    })
  })

  describe('block / unblock', () => {
    const email = 'crud-block@e2e.test'
    let id: string

    before(async () => {
      const u: any = await seedConfirmedUser(email, PW)
      id = u.id
    })

    it('a seeded user can log in before being blocked', async () => {
      const res = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(res.statusCode).toBe(200)
    })

    it('admin blocks the user → login forbidden (403)', async () => {
      const blk = await inject({
        method: 'POST',
        url: `/users/${id}/block`,
        headers: authHeader(adminTok),
        payload: { reason: 'e2e test' }
      })
      expect(blk.statusCode).toBe(200)
      expect(JSON.parse(blk.body)).toMatchObject({ ok: true })

      const login403 = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(login403.statusCode).toBe(403)
    })

    it('admin unblocks the user → login works again (200)', async () => {
      const unb = await inject({ method: 'POST', url: `/users/${id}/unblock`, headers: authHeader(adminTok) })
      expect(unb.statusCode).toBe(200)
      expect(JSON.parse(unb.body)).toMatchObject({ ok: true })

      const ok = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(ok.statusCode).toBe(200)
    })
  })

  describe('dynamic role change takes effect', () => {
    // An admin grants a role; the change must apply on the NEXT request (roles are
    // read fresh from the DB in onRequest), unlocking a role-gated endpoint.
    const actor = 'role-actor@e2e.test' // gets promoted to backoffice
    const target = 'role-target@e2e.test' // someone the actor will block
    let actorTok: string
    let targetId: string

    before(async () => {
      const a: any = await seedConfirmedUser(actor, PW)
      void a
      const t: any = await seedConfirmedUser(target, PW)
      targetId = t.id
      actorTok = await login(actor, PW)
    })

    it('a plain user cannot use a backoffice-gated endpoint (block) → 403', async () => {
      const res = await inject({
        method: 'POST',
        url: `/users/${targetId}/block`,
        headers: authHeader(actorTok),
        payload: { reason: 'nope' }
      })
      expect(res.statusCode).toBe(403)
    })

    it('after admin grants backoffice, the SAME token can block (200)', async () => {
      const actorUser = await getUserByEmail(actor)
      const grant = await inject({
        method: 'PUT',
        url: `/users/${actorUser.id}`,
        headers: authHeader(adminTok),
        payload: { roles: ['backoffice'] }
      })
      expect(grant.statusCode).toBe(200)

      const res = await inject({
        method: 'POST',
        url: `/users/${targetId}/block`,
        headers: authHeader(actorTok),
        payload: { reason: 'now allowed' }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })
    })
  })

  describe('authorization boundary', () => {
    it('a non-admin cannot create a user (403)', async () => {
      const nonAdmin = 'crud-nonadmin@e2e.test'
      await seedConfirmedUser(nonAdmin, PW)
      const userTok = await login(nonAdmin, PW)
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(userTok),
        payload: { email: 'should-not@e2e.test', password: PW, roles: ['public'] }
      })
      expect(res.statusCode).toBe(403)
    })
  })
})
