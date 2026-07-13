/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E batch — admin user management: CRUD on /users plus block/unblock, and the
// authorization boundary (non-admin cannot create). BEARER, single-tenant.
//
import { expect } from 'expect'
import { app, login, authHeader, seedConfirmedUser, getUserByEmail, countAdmins, ADMIN } from './harness.js'

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
    const actor = 'role-actor@e2e.test' // gets promoted to `ops` (users capability)
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

    it('a plain user cannot use a users-gated endpoint (block) → 403', async () => {
      const res = await inject({
        method: 'POST',
        url: `/users/${targetId}/block`,
        headers: authHeader(actorTok),
        payload: { reason: 'nope' }
      })
      expect(res.statusCode).toBe(403)
    })

    it('after admin grants a users-capability role, the SAME token can block (200)', async () => {
      const actorUser = await getUserByEmail(actor)
      const grant = await inject({
        method: 'PUT',
        url: `/users/${actorUser.id}`,
        headers: authHeader(adminTok),
        payload: { roles: ['ops'] }
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

    it('an ops-only user still reaches public routes (/users/me)', async () => {
      // Public routes are open to EVERY caller: a subject whose roles do not
      // include `public` (here: only `ops`) must not rank below anonymous.
      const res = await inject({ method: 'GET', url: '/users/me', headers: authHeader(actorTok) })
      expect(res.statusCode).toBe(200)
      expect(JSON.parse(res.body).email).toBe(actor)
    })
  })

  describe('admin-apex guards (rules A/B + never-zero)', () => {
    // Runs while ADMIN is still the only admin (before the multiple-admin block creates
    // a second), so never-zero fires deterministically. The precondition guards ADMIN
    // from an accidental delete if that ordering ever changes.
    let opsTok: string
    let adminId: string

    before(async () => {
      const n = await countAdmins()
      if (n !== 1) throw new Error(`precondition failed: expected exactly 1 admin, found ${n}`)
      adminId = (await getUserByEmail(ADMIN.email)).id
      const email = 'apex-ops@e2e.test'
      const u: any = await seedConfirmedUser(email, PW)
      await inject({ method: 'PUT', url: `/users/${u.id}`, headers: authHeader(adminTok), payload: { roles: ['ops'] } })
      opsTok = await login(email, PW)
    })

    it('rule A — a users-capability holder cannot create an admin (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(opsTok),
        payload: { email: 'apex-newadmin@e2e.test', password: PW, roles: ['admin'] }
      })
      expect(res.statusCode).toBe(403)
      expect(await getUserByEmail('apex-newadmin@e2e.test')).toBeFalsy()
    })

    it('rule A — a users-capability holder can create a non-admin (200)', async () => {
      const res = await inject({
        method: 'POST',
        url: '/users',
        headers: authHeader(opsTok),
        payload: { email: 'apex-plain@e2e.test', password: PW, roles: ['public'] }
      })
      expect(res.statusCode).toBe(200)
    })

    it('rule B — a users-capability holder cannot update an admin (403)', async () => {
      const res = await inject({
        method: 'PUT',
        url: `/users/${adminId}`,
        headers: authHeader(opsTok),
        payload: { firstName: 'Hacked' }
      })
      expect(res.statusCode).toBe(403)
    })

    it('rule B — a users-capability holder cannot block an admin (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: `/users/${adminId}/block`,
        headers: authHeader(opsTok),
        payload: { reason: 'nope' }
      })
      expect(res.statusCode).toBe(403)
      expect((await getUserByEmail(ADMIN.email)).blocked).toBeFalsy()
    })

    it('rule B — a users-capability holder cannot delete an admin (403)', async () => {
      const res = await inject({ method: 'DELETE', url: `/users/${adminId}`, headers: authHeader(opsTok) })
      expect(res.statusCode).toBe(403)
      expect(await getUserByEmail(ADMIN.email)).toBeTruthy()
    })

    it('never-zero — cannot delete the last admin (403)', async () => {
      const res = await inject({ method: 'DELETE', url: `/users/${adminId}`, headers: authHeader(adminTok) })
      expect(res.statusCode).toBe(403)
      expect(await getUserByEmail(ADMIN.email)).toBeTruthy()
    })

    it('never-zero — cannot demote the last admin (403)', async () => {
      const res = await inject({
        method: 'PUT',
        url: `/users/${adminId}`,
        headers: authHeader(adminTok),
        payload: { roles: ['public'] }
      })
      expect(res.statusCode).toBe(403)
      expect((await getUserByEmail(ADMIN.email)).roles).toContain('admin')
    })

    it('never-zero — cannot block the last admin (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: `/users/${adminId}/block`,
        headers: authHeader(adminTok),
        payload: { reason: 'x' }
      })
      expect(res.statusCode).toBe(403)
      expect((await getUserByEmail(ADMIN.email)).blocked).toBeFalsy()
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

  describe('sovereign founder (ADMIN_EMAIL) + register', () => {
    // A throwaway admin plays the founder so a guard regression cannot touch ADMIN.
    // adminTok is a different admin (not the founder) acting against it.
    const founderEmail = 'sovereign-founder@e2e.test'
    let founderId: string
    let savedEmail: string | undefined
    let savedPwReset: boolean | undefined

    before(async () => {
      savedEmail = process.env.ADMIN_EMAIL
      savedPwReset = (global as any).config.options.allow_admin_change_password_users
      ;(global as any).config.options.allow_admin_change_password_users = true
      await seedConfirmedUser(founderEmail, PW, ['admin'])
      founderId = (await getUserByEmail(founderEmail)).id
      process.env.ADMIN_EMAIL = founderEmail
    })

    after(() => {
      if (savedEmail === undefined) delete process.env.ADMIN_EMAIL
      else process.env.ADMIN_EMAIL = savedEmail
      ;(global as any).config.options.allow_admin_change_password_users = savedPwReset
    })

    it('another admin cannot demote the founder (403)', async () => {
      const res = await inject({
        method: 'PUT',
        url: `/users/${founderId}`,
        headers: authHeader(adminTok),
        payload: { roles: ['public'] }
      })
      expect(res.statusCode).toBe(403)
      expect((await getUserByEmail(founderEmail)).roles).toContain('admin')
    })

    it('another admin cannot change the founder email (403)', async () => {
      const res = await inject({
        method: 'PUT',
        url: `/users/${founderId}`,
        headers: authHeader(adminTok),
        payload: { email: 'moved@e2e.test' }
      })
      expect(res.statusCode).toBe(403)
    })

    it('another admin cannot block the founder (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: `/users/${founderId}/block`,
        headers: authHeader(adminTok),
        payload: { reason: 'x' }
      })
      expect(res.statusCode).toBe(403)
      expect((await getUserByEmail(founderEmail)).blocked).toBeFalsy()
    })

    it('another admin cannot reset the founder password (403)', async () => {
      const res = await inject({
        method: 'POST',
        url: `/users/${founderId}/password/reset`,
        headers: authHeader(adminTok),
        payload: { password: 'New-pw-123456' }
      })
      expect(res.statusCode).toBe(403)
    })

    it('another admin cannot delete the founder (403)', async () => {
      const res = await inject({ method: 'DELETE', url: `/users/${founderId}`, headers: authHeader(adminTok) })
      expect(res.statusCode).toBe(403)
      expect(await getUserByEmail(founderEmail)).toBeTruthy()
    })

    it('registration cannot grant the admin role', async () => {
      const email = 'selfreg-admin@e2e.test'
      const res = await inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: 'sra', email, password1: PW, password2: PW, requiredRoles: ['admin'] }
      })
      expect(res.statusCode).toBe(200)
      expect((await getUserByEmail(email)).roles).not.toContain('admin')
    })
  })
})
