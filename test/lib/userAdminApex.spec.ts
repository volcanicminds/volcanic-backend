/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: the admin apex, which is the whole authorization model of `/users` and had no test.
//
// Four rules protect it (docs/AUTHORIZATION_MODEL.md §6), and each one exists because of a
// specific way an instance stops being administrable:
//
//   A. minting an admin needs an admin caller AND `allow_multiple_admin`
//   B. only an admin may act on an admin subject
//   C. the instance never drops to zero admins
//   D. the sovereign founder cannot be demoted, renamed, deleted or blocked
//
// They were written, reviewed and never exercised. That matters more here than almost
// anywhere else: a broken authorization rule does not fail, it permits — the happy path is
// identical, and the only observable difference is that something forbidden went through.
//
import { expect } from 'expect'
import { create, update, remove, block, unblock, resetMfaByAdmin, resetPasswordByAdmin } from '../../lib/api/users/controller/user.js'

;(global as any).log = {}

const FOUNDER: any = { id: 'u-founder', email: 'root@acme.test', roles: ['admin'], isFounder: true }
const ADMIN: any = { id: 'u-admin', email: 'admin@acme.test', roles: ['admin'], isFounder: false }
const EDITOR: any = { id: 'u-editor', email: 'editor@acme.test', roles: ['editor'], isFounder: false }

function fakeReply() {
  const sent: any = { code: 200, body: null }
  const reply: any = {
    status(code: number) {
      sent.code = code
      return reply
    },
    send(body: any) {
      sent.body = body
      return reply
    },
    sent
  }
  return reply
}

/**
 * A request from `callerRoles`, acting on `target`.
 *
 * The manager is a double that records rather than persists: what these tests assert is
 * whether the call REACHED the manager, because "forbidden" and "permitted but no-op" look
 * the same from the response and are not the same thing at all.
 */
function request(opts: any = {}) {
  const calls: any[] = []
  const callerRoles: string[] = opts.callerRoles ?? ['admin']

  const req: any = {
    data: () => opts.data ?? {},
    parameters: () => ({ id: opts.targetId ?? opts.target?.id ?? 'u-editor' }),
    control: { kind: 'control' },
    routeOptions: { config: { tenantContext: false } },
    user: opts.caller ?? { id: 'u-caller', email: 'caller@acme.test', roles: callerRoles, isFounder: !!opts.callerIsFounder },
    hasRole: (r: any) => callerRoles.includes(r?.code),
    roles: () => callerRoles,
    log: { error: () => {} },
    server: {
      userManager: {
        isImplemented: () => true,
        retrieveUserById: async (_c: any, id: string) =>
          [FOUNDER, ADMIN, EDITOR].find((u) => u.id === id) ?? null,
        countQuery: async () => opts.adminCount ?? 5,
        createUser: async (_c: any, data: any) => {
          calls.push(['createUser', data])
          return { id: 'u-new', ...data }
        },
        userConfirmation: async (_c: any, user: any) => ({ ...user, confirmed: true }),
        updateUserById: async (_c: any, id: string, data: any) => {
          calls.push(['updateUserById', id, data])
          return { id, ...data }
        },
        deleteUser: async (_c: any, id: string) => {
          calls.push(['deleteUser', id])
          return { ok: true }
        },
        blockUserById: async (_c: any, id: string) => {
          calls.push(['blockUserById', id])
          return { id }
        },
        unblockUserById: async (_c: any, id: string) => {
          calls.push(['unblockUserById', id])
          return { id }
        },
        resetExternalId: async (_c: any, id: string) => ({ id }),
        disableMfa: async (_c: any, id: string) => {
          calls.push(['disableMfa', id])
        },
        resetPassword: async (_c: any, user: any) => {
          calls.push(['resetPassword', user.id])
        }
      }
    }
  }

  return { req, calls, reply: fakeReply() }
}

const setConfig = (options: any = {}) => {
  ;(global as any).config = { options }
}

describe('users · the admin apex (T-9.5)', () => {
  let savedRoles: any

  // Saved and put back: mocha runs every spec in one process, so a catalogue this suite
  // installs is installed for everybody. Leaving it behind is how another suite starts
  // failing for a reason that is not in its own file.
  before(() => {
    savedRoles = (global as any).roles
    ;(global as any).roles = { public: { code: 'public' }, admin: { code: 'admin' }, editor: { code: 'editor' } }
  })

  after(() => {
    ;(global as any).roles = savedRoles
    ;(global as any).config = undefined
  })

  describe('rule A · minting an admin', () => {
    it('refuses a non-admin caller, whatever the capability that let them in', async () => {
      // The `users` capability manages users. It does not create peers of the apex, or it
      // would be a way to grant yourself everything by way of a second account.
      setConfig({ allow_multiple_admin: true })
      const { req, calls, reply } = request({ callerRoles: ['editor'], data: { email: 'x@acme.test', roles: ['admin'] } })

      await create(req, reply)
      expect(reply.sent.code).toBe(403)
      expect(calls.length).toBe(0)
    })

    it('refuses even an admin caller when the deployment declares a single apex', async () => {
      setConfig({ allow_multiple_admin: false })
      const { req, calls, reply } = request({ callerRoles: ['admin'], data: { email: 'x@acme.test', roles: ['admin'] } })

      await create(req, reply)
      expect(reply.sent.code).toBe(403)
      expect(calls.length).toBe(0)
    })

    it('allows it when both conditions hold, which is what makes the rule a rule', async () => {
      setConfig({ allow_multiple_admin: true })
      const { req, calls, reply } = request({ callerRoles: ['admin'], data: { email: 'x@acme.test', roles: ['admin'] } })

      await create(req, reply)
      expect(reply.sent.code).toBe(200)
      expect(calls[0][0]).toBe('createUser')
    })

    it('applies on update as well, or the same grant is one PUT away', async () => {
      setConfig({ allow_multiple_admin: false })
      const { req, calls, reply } = request({
        callerRoles: ['admin'],
        targetId: EDITOR.id,
        data: { roles: ['admin'] }
      })

      await update(req, reply)
      expect(reply.sent.code).toBe(403)
      expect(calls.length).toBe(0)
    })
  })

  describe('rule B · only an admin acts on an admin', () => {
    it('refuses a capability holder modifying, deleting, blocking or unblocking an admin', async () => {
      setConfig({})
      for (const [name, fn] of [
        ['update', update],
        ['remove', remove],
        ['block', block],
        ['unblock', unblock]
      ] as const) {
        const { req, calls, reply } = request({ callerRoles: ['editor'], targetId: ADMIN.id, data: { email: 'new@acme.test' } })
        await fn(req as any, reply as any)
        expect([name, reply.sent.code]).toEqual([name, 403])
        expect([name, calls.length]).toEqual([name, 0])
      }
    })
  })

  describe('rule C · never zero admins', () => {
    it('refuses to demote, delete or block the last one', async () => {
      setConfig({ allow_multiple_admin: true })

      const demote = request({ callerRoles: ['admin'], targetId: ADMIN.id, data: { roles: ['editor'] }, adminCount: 1 })
      await update(demote.req, demote.reply)
      expect(demote.reply.sent.code).toBe(403)
      expect(demote.calls.length).toBe(0)

      const deleted = request({ callerRoles: ['admin'], targetId: ADMIN.id, adminCount: 1 })
      await remove(deleted.req, deleted.reply)
      expect(deleted.reply.sent.code).toBe(403)
      expect(deleted.calls.length).toBe(0)

      // Blocking counts too: an instance whose only admin is blocked is locked out exactly as
      // thoroughly as one whose only admin was deleted.
      const blocked = request({ callerRoles: ['admin'], targetId: ADMIN.id, adminCount: 1 })
      await block(blocked.req, blocked.reply)
      expect(blocked.reply.sent.code).toBe(403)
      expect(blocked.calls.length).toBe(0)
    })

    it('allows the same operations while another admin remains', async () => {
      setConfig({ allow_multiple_admin: true })
      const { req, calls, reply } = request({ callerRoles: ['admin'], targetId: ADMIN.id, adminCount: 2 })

      await remove(req, reply)
      expect(reply.sent.code).toBe(200)
      expect(calls[0]).toEqual(['deleteUser', ADMIN.id])
    })
  })

  describe('rule D · the sovereign founder', () => {
    it('cannot be demoted, renamed, deleted or blocked, even by an admin', async () => {
      setConfig({ allow_multiple_admin: true })

      const demote = request({ callerRoles: ['admin'], targetId: FOUNDER.id, data: { roles: ['editor'] }, adminCount: 9 })
      await update(demote.req, demote.reply)
      expect(demote.reply.sent.body.message).toMatch(/sovereign/)

      const rename = request({ callerRoles: ['admin'], targetId: FOUNDER.id, data: { email: 'someone-else@acme.test' } })
      await update(rename.req, rename.reply)
      expect(rename.reply.sent.body.message).toMatch(/sovereign/)

      const deleted = request({ callerRoles: ['admin'], targetId: FOUNDER.id, adminCount: 9 })
      await remove(deleted.req, deleted.reply)
      expect(deleted.reply.sent.body.message).toMatch(/sovereign/)

      const blocked = request({ callerRoles: ['admin'], targetId: FOUNDER.id, adminCount: 9 })
      await block(blocked.req, blocked.reply)
      expect(blocked.reply.sent.body.message).toMatch(/sovereign/)
    })

    it('can still be updated in ways that do not touch what makes it sovereign', async () => {
      // The rule is about the apex, not about the row: a founder who cannot have a phone
      // number is a rule that will be worked around.
      setConfig({ allow_multiple_admin: true })
      const { req, calls, reply } = request({
        callerRoles: ['admin'],
        targetId: FOUNDER.id,
        data: { roles: ['admin'], firstName: 'Root' },
        adminCount: 9
      })

      await update(req, reply)
      expect(reply.sent.code).toBe(200)
      expect(calls[0][0]).toBe('updateUserById')
    })

    it('has its MFA and password reset refused to everyone but itself', async () => {
      // An admin who could reset the founder's second factor could take the founder's
      // account, which is the one account the model says nobody takes.
      setConfig({ allow_admin_change_password_users: true })

      const mfa = request({ callerRoles: ['admin'], targetId: FOUNDER.id })
      await resetMfaByAdmin(mfa.req, mfa.reply)
      expect(mfa.reply.sent.code).toBe(403)
      expect(mfa.calls.length).toBe(0)

      const password = request({ callerRoles: ['admin'], targetId: FOUNDER.id, data: { password: 'Str0ng-passw0rd!' } })
      await resetPasswordByAdmin(password.req, password.reply)
      expect(password.reply.sent.code).toBe(403)
      expect(password.calls.length).toBe(0)

      // And the founder itself can, or an enrolled founder who loses their phone has no way back.
      const self = request({
        callerRoles: ['admin'],
        callerIsFounder: true,
        caller: { ...FOUNDER },
        targetId: FOUNDER.id
      })
      await resetMfaByAdmin(self.req, self.reply)
      expect(self.calls[0]).toEqual(['disableMfa', FOUNDER.id])
    })
  })

  describe('the administrative resets are opt-in and admin-only', () => {
    it('answers 404 for a password reset the deployment has not enabled', async () => {
      // 404 and not 403: a feature that is off does not exist, and saying "forbidden" would
      // confirm the route to someone probing for it.
      setConfig({})
      const { req, calls, reply } = request({ callerRoles: ['admin'], targetId: EDITOR.id, data: { password: 'x' } })

      await resetPasswordByAdmin(req, reply)
      expect(reply.sent.code).toBe(404)
      expect(calls.length).toBe(0)
    })

    it('refuses a non-admin caller even when the feature is on', async () => {
      setConfig({ allow_admin_change_password_users: true })
      const { req, calls, reply } = request({
        callerRoles: ['editor'],
        targetId: EDITOR.id,
        data: { password: 'Str0ng-passw0rd!' }
      })

      await resetPasswordByAdmin(req, reply)
      expect(reply.sent.code).toBe(403)
      expect(calls.length).toBe(0)
    })
  })
})
