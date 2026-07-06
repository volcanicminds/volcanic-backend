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

    it('a backoffice-only user still reaches public routes (/users/me)', async () => {
      // Public routes are open to EVERY caller: a subject whose roles do not
      // include `public` (here: only `backoffice`) must not rank below anonymous.
      const res = await inject({ method: 'GET', url: '/users/me', headers: authHeader(actorTok) })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).email).toBe(actor)
    })
  })

  describe('confirmed-on-create (allow_admin_create_confirmed_users)', () => {
    // Opt-in option: admin-created users start confirmed (login-ready). Default off
    // keeps the standard flow (unconfirmed until email confirmation).
    const flag = () => (global as any).config.options
    let saved: boolean | undefined

    before(() => {
      saved = flag().allow_admin_create_confirmed_users
    })

    after(() => {
      flag().allow_admin_create_confirmed_users = saved
    })

    it('by default an admin-created user is unconfirmed and cannot log in (403)', async () => {
      flag().allow_admin_create_confirmed_users = false
      const email = 'crud-unconfirmed@e2e.test'
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email, password: PW, roles: ['public'] }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).confirmed).toBe(false)

      const login403 = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(login403.statusCode).toBe(403)
    })

    it('with the option on, the created user is confirmed and can log in (200)', async () => {
      flag().allow_admin_create_confirmed_users = true
      const email = 'crud-confirmed@e2e.test'
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email, password: PW, roles: ['public'] }
      })
      expect(res.statusCode).toBe(200)
      const body = JSON.parse(res.body)
      expect(body.confirmed).toBe(true)

      const ok = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(ok.statusCode).toBe(200)
    })

    it('an explicit confirmed:false in the payload keeps the standard flow', async () => {
      flag().allow_admin_create_confirmed_users = true
      const email = 'crud-optout@e2e.test'
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email, password: PW, roles: ['public'], confirmed: false }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).confirmed).toBe(false)

      const login403 = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(login403.statusCode).toBe(403)
    })

    it('self-registration is unaffected by the option (stays unconfirmed)', async () => {
      flag().allow_admin_create_confirmed_users = true
      const email = 'crud-selfreg@e2e.test'
      const res = await inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'selfreg', email, password1: PW, password2: PW }
      })
      expect(res.statusCode).toBe(200)

      const dbUser = await getUserByEmail(email)
      expect(dbUser.confirmed).toBe(false)
      expect(dbUser.confirmationToken).toBeTruthy()

      const login403 = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(login403.statusCode).toBe(403)
    })

    it('the confirmed user carries no leftover confirmation token', async () => {
      flag().allow_admin_create_confirmed_users = true
      const email = 'crud-notoken@e2e.test'
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email, password: PW, roles: ['public'] }
      })
      expect(res.statusCode).toBe(200)

      const dbUser = await getUserByEmail(email)
      expect(dbUser.confirmed).toBe(true)
      expect(dbUser.confirmedAt).toBeTruthy()
      expect(dbUser.confirmationToken).toBeFalsy()
    })
  })

  describe('multiple-admin guard (allow_multiple_admin)', () => {
    // Opt-in option: assigning the `admin` role on POST /users is blocked (403)
    // unless enabled. Default off guards a single-admin setup. Non-admin roles are
    // unaffected, and the guard applies to creation only.
    const flag = () => (global as any).config.options
    let saved: boolean | undefined

    before(() => {
      saved = flag().allow_multiple_admin
    })

    after(() => {
      flag().allow_multiple_admin = saved
    })

    it('by default, creating a user with the admin role is rejected (403)', async () => {
      flag().allow_multiple_admin = false
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email: 'crud-admin-blocked@e2e.test', password: PW, roles: ['admin'] }
      })
      expect(res.statusCode).toBe(403)
      // the user must not have been created
      expect(await getUserByEmail('crud-admin-blocked@e2e.test')).toBeFalsy()
    })

    it('non-admin roles are unaffected when the option is off', async () => {
      flag().allow_multiple_admin = false
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email: 'crud-plain-ok@e2e.test', password: PW, roles: ['public'] }
      })
      expect(res.statusCode).toBe(200)
    })

    it('with the option on, a second admin can be created (200)', async () => {
      flag().allow_multiple_admin = true
      const email = 'crud-admin-ok@e2e.test'
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(adminTok),
        payload: { email, password: PW, roles: ['admin'] }
      })
      expect(res.statusCode).toBe(200)
      const created = await getUserByEmail(email)
      expect(created.roles).toContain('admin')
    })
  })

  describe('admin password reset (allow_admin_change_password_users)', () => {
    // Opt-in option: POST /users/:id/password/reset lets an admin set a new password
    // for a user by id, with NO old-password check. Disabled by default → the route
    // responds 404 (feature hidden). Enabled → the credential is rotated.
    const flag = () => (global as any).config.options
    const email = 'crud-pwreset@e2e.test'
    const newPw = 'Reset-pw-NEW-77'
    let saved: boolean | undefined
    let id: string

    before(async () => {
      saved = flag().allow_admin_change_password_users
      const u: any = await seedConfirmedUser(email, PW)
      id = u.id
    })

    after(() => {
      flag().allow_admin_change_password_users = saved
    })

    it('with the option off, the endpoint is hidden (404)', async () => {
      flag().allow_admin_change_password_users = false
      const res = await inject({
        method: 'POST',
        url: `/users/${id}/password/reset`,
        headers: authHeader(adminTok),
        payload: { password: newPw }
      })
      expect(res.statusCode).toBe(404)
      // the original credential still works
      const stillOld = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(stillOld.statusCode).toBe(200)
    })

    it('with the option on, the admin resets the password (old fails, new works)', async () => {
      flag().allow_admin_change_password_users = true
      const res = await inject({
        method: 'POST',
        url: `/users/${id}/password/reset`,
        headers: authHeader(adminTok),
        payload: { password: newPw }
      })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body)).toMatchObject({ ok: true })

      const oldLogin = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: PW } })
      expect(oldLogin.statusCode).toBe(403)
      const newLogin = await inject({ method: 'POST', url: '/auth/login', payload: { email, password: newPw } })
      expect(newLogin.statusCode).toBe(200)
    })

    it('a non-admin cannot reset another user\'s password (403), even with the option on', async () => {
      flag().allow_admin_change_password_users = true
      const nonAdmin = 'crud-pwreset-nonadmin@e2e.test'
      await seedConfirmedUser(nonAdmin, PW)
      const userTok = await login(nonAdmin, PW)
      const res = await inject({
        method: 'POST',
        url: `/users/${id}/password/reset`,
        headers: authHeader(userTok),
        payload: { password: 'Whatever-pw-1' }
      })
      expect(res.statusCode).toBe(403)
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
