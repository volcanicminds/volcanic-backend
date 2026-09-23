/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.47 and T-12.48: who may create an account in a tenant (F49). The platform decides the set of
// modes, for every tenant or for one; the tenant's administrator picks one inside it; the pick that
// falls out of a narrowed set gives way to the most closed mode left. Both doors obey it: the
// registration route here, the just-in-time provisioning in test/db/accountCreation.spec.ts.
//
import { expect } from 'expect'
import {
  accountCreationOf,
  assertAccountCreation,
  checkModes,
  checkRule,
  checkTenantOverride,
  CONTROL_KEY,
  effectiveMode,
  TENANT_KEY
} from '../../lib/auth/accountCreation.js'
import { tenantRefusal } from '../../lib/auth/subjects.js'
import { register } from '../../lib/api/auth/controller/auth.js'
import * as platform from '../../lib/api/system/controller/systemAccountCreation.js'
import * as tenantSettings from '../../lib/api/settings/controller/settings.js'
import { update as updateTenant } from '../../lib/api/tenants/controller/tenants.js'
import { approve } from '../../lib/api/users/controller/user.js'
import { EMAIL_ALREADY_REGISTERED } from '../../lib/config/constants.js'

const bag = globalThis as any
bag.log = {}
bag.roles = { public: { code: 'public' }, admin: { code: 'admin' } }

const GOOD = 'Str0ng-passw0rd!'
const CONTROL = { kind: 'control' }

/** One store for both containers, keyed by container: what the SQL table does per container. */
function memorySettings() {
  const rows = new Map<string, unknown>()
  const at = (ctx: any, key: string) => `${ctx === CONTROL ? 'control' : 'tenant'}:${key}`
  return {
    rows,
    isImplemented: () => true,
    get: async (ctx: any, key: string) => (rows.has(at(ctx, key)) ? rows.get(at(ctx, key)) : null),
    set: async (ctx: any, key: string, value: unknown) => void rows.set(at(ctx, key), value),
    remove: async (ctx: any, key: string) => rows.delete(at(ctx, key))
  }
}

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
    type: () => reply,
    headers: () => reply,
    sent
  }
  return reply
}

function fakeRequest(input: { data?: any; params?: any; server?: any; tenantInfo?: any; user?: any }) {
  return {
    data: () => input.data ?? {},
    parameters: () => input.params ?? {},
    params: input.params ?? {},
    control: CONTROL,
    routeOptions: { config: { tenantContext: false } },
    tenantInfo: input.tenantInfo ?? null,
    user: input.user,
    systemUser: { externalId: 'op-1' },
    server: input.server ?? {}
  } as any
}

describe('auth · account creation, the rule (F49, T-12.47)', () => {
  let saved: any
  beforeEach(() => {
    saved = bag.config
    bag.config = { options: {} }
  })
  afterEach(() => (bag.config = saved))

  it('reads a list of modes in their order, and refuses an empty or unknown one', () => {
    expect(checkModes('open, invite')).toEqual({ ok: true, value: ['invite', 'open'] })
    expect(checkModes(['approval', 'approval'])).toEqual({ ok: true, value: ['approval'] })
    expect(checkModes([]).ok).toBe(false)
    expect(checkModes(['public']).ok).toBe(false)
  })

  it('refuses a rule whose default is outside the set, or that carries unknown keys', () => {
    expect(checkRule({ allowed: ['invite', 'open'], default: 'open' })).toEqual({
      ok: true,
      value: { allowed: ['invite', 'open'], default: 'open' }
    })
    expect(checkRule({ allowed: ['invite'], default: 'open' }).ok).toBe(false)
    expect(checkRule({ allowed: ['invite'], default: 'invite', extra: true }).ok).toBe(false)
    expect(checkRule(null).ok).toBe(false)
  })

  it("takes only `allowed` in a tenant's own set", () => {
    expect(checkTenantOverride(undefined)).toEqual({ ok: true, value: null })
    expect(checkTenantOverride({ allowed: ['open'] })).toEqual({ ok: true, value: { allowed: ['open'] } })
    expect(checkTenantOverride({ allowed: ['open'], default: 'open' }).ok).toBe(false)
  })

  it('stops the boot on a deployment rule that is not one, and is closed by default', async () => {
    expect(() => assertAccountCreation()).not.toThrow()
    const state = await accountCreationOf({ settings: undefined, control: null, handle: {} as any, tenant: null })
    expect(state).toMatchObject({
      allowed: ['invite', 'approval', 'open'],
      allowedFrom: 'deployment',
      mode: 'invite',
      choice: null
    })

    bag.config.options.accountCreation = { allowed: 'invite,open', default: 'approval' }
    expect(() => assertAccountCreation()).toThrow(/not among the allowed modes/)
  })

  it('applies the choice inside the set, else the default, else the most closed mode of the set', () => {
    expect(effectiveMode(['invite', 'approval', 'open'], 'invite', 'open')).toBe('open')
    expect(effectiveMode(['invite', 'approval'], 'invite', 'open')).toBe('invite')
    expect(effectiveMode(['approval', 'open'], 'invite', null)).toBe('approval')
  })

  it("lets the platform's stored rule replace the deployment's, and a tenant's own set replace both", async () => {
    const settings = memorySettings()
    settings.rows.set(`control:${CONTROL_KEY}`, { allowed: ['invite', 'approval'], default: 'approval' })
    settings.rows.set(`tenant:${TENANT_KEY}`, 'open')

    const global = await accountCreationOf({
      settings: settings as any,
      control: CONTROL as any,
      handle: {} as any,
      tenant: null
    })
    // The tenant chose `open` when it was allowed; the platform narrowed the set since.
    expect(global).toEqual({
      allowed: ['invite', 'approval'],
      allowedFrom: 'control',
      default: 'approval',
      choice: 'open',
      mode: 'approval'
    })

    const own = await accountCreationOf({
      settings: settings as any,
      control: CONTROL as any,
      handle: {} as any,
      tenant: { config: { account_creation: { allowed: ['open'] } } } as any
    })
    expect(own).toMatchObject({ allowed: ['open'], allowedFrom: 'tenant', mode: 'open' })
  })

  it('reads a stored rule that is no longer one as absent, instead of closing every tenant', async () => {
    const settings = memorySettings()
    settings.rows.set(`control:${CONTROL_KEY}`, { allowed: ['nobody'], default: 'nobody' })
    const state = await accountCreationOf({
      settings: settings as any,
      control: CONTROL as any,
      handle: {} as any,
      tenant: null
    })
    expect(state.allowedFrom).toBe('deployment')
  })
})

describe('auth · account creation, the routes (F49, T-12.47)', () => {
  let saved: any
  beforeEach(() => {
    saved = bag.config
    bag.config = { options: {} }
  })
  afterEach(() => (bag.config = saved))

  it('lets the platform write, read and remove the rule for every tenant', async () => {
    const settings = memorySettings()
    const server = { settingManager: settings }

    const bad = fakeReply()
    await platform.update(fakeRequest({ server, data: { allowed: ['open'], default: 'invite' } }), bad)
    expect(bad.sent).toMatchObject({ code: 400, body: { code: 'ACCOUNT_CREATION_INVALID' } })

    const good = fakeReply()
    await platform.update(fakeRequest({ server, data: { allowed: ['open', 'approval'], default: 'approval' } }), good)
    expect(good.sent.body).toMatchObject({ allowed: ['approval', 'open'], default: 'approval', from: 'control' })

    const back = fakeReply()
    await platform.reset(fakeRequest({ server }), back)
    expect(back.sent.body).toMatchObject({ from: 'deployment', default: 'invite' })

    const none = fakeReply()
    await platform.get(fakeRequest({ server: { settingManager: { isImplemented: () => false } } }), none)
    expect(none.sent).toMatchObject({ code: 503, body: { code: 'SETTINGS_NOT_AVAILABLE' } })
  })

  it("refuses a tenant's own set that is not one, and stores a valid one in the order of the modes", async () => {
    let written: any = null
    const server = {
      tenantManager: {
        isImplemented: () => true,
        updateTenant: async (_c: any, _id: string, patch: any) => (written = patch)
      }
    }

    const bad = fakeReply()
    await updateTenant(
      fakeRequest({ server, params: { id: 't1' }, data: { config: { account_creation: { allowed: ['everyone'] } } } }),
      bad
    )
    expect(bad.sent).toMatchObject({ code: 400, body: { code: 'ACCOUNT_CREATION_INVALID' } })
    expect(written).toBeNull()

    await updateTenant(
      fakeRequest({
        server,
        params: { id: 't1' },
        data: { config: { account_creation: { allowed: ['open', 'invite'] } } }
      }),
      fakeReply()
    )
    expect(written.config.account_creation).toEqual({ allowed: ['invite', 'open'] })
  })

  it("lets the tenant's administrator choose inside the set and nowhere else", async () => {
    const settings = memorySettings()
    const tenantInfo = { config: { account_creation: { allowed: ['invite', 'approval'] } } }
    const server = { settingManager: settings }

    const outside = fakeReply()
    await tenantSettings.setAccountCreation(fakeRequest({ server, tenantInfo, data: { mode: 'open' } }), outside)
    expect(outside.sent).toMatchObject({ code: 403, body: { code: 'ACCOUNT_CREATION_NOT_ALLOWED' } })

    const unknown = fakeReply()
    await tenantSettings.setAccountCreation(fakeRequest({ server, tenantInfo, data: { mode: 'free' } }), unknown)
    expect(unknown.sent).toMatchObject({ code: 400, body: { code: 'ACCOUNT_CREATION_INVALID' } })

    const inside = fakeReply()
    await tenantSettings.setAccountCreation(
      fakeRequest({ server, tenantInfo, data: { mode: 'approval' }, user: { externalId: 'x-anna' } }),
      inside
    )
    expect(inside.sent.body).toMatchObject({ choice: 'approval', mode: 'approval', allowedFrom: 'tenant' })

    const read = fakeReply()
    await tenantSettings.getAccountCreation(fakeRequest({ server, tenantInfo }), read)
    expect(read.sent.body.mode).toBe('approval')
  })
})

describe('auth · account creation, the registration and the wait (F49, T-12.48)', () => {
  let saved: any
  beforeEach(() => {
    saved = bag.config
    bag.config = { options: {} }
  })
  afterEach(() => (bag.config = saved))

  const body = { username: 'someone', email: 'someone@acme.test', password1: GOOD, password2: GOOD }

  function registration(mode: 'invite' | 'approval' | 'open') {
    const created: any[] = []
    const accesses: any[] = []
    bag.config.options.accountCreation = { allowed: [mode], default: mode }
    const server = {
      settingManager: memorySettings(),
      accessLogManager: {
        isImplemented: () => true,
        record: async (_c: any, e: any) => void accesses.push(e),
        purgeExpired: async () => 0
      },
      userManager: {
        isImplemented: () => true,
        createUser: async (_c: any, data: any) => {
          created.push(data)
          return { id: 'u1', externalId: 'x-new', email: data.email, roles: data.roles, approved: data.approved }
        }
      }
    }
    return { server, created, accesses }
  }

  it('closes the registration under `invite`, before reading the request', async () => {
    const { server, created } = registration('invite')
    const reply = fakeReply()
    await register(fakeRequest({ server, data: { ...body, email: 'not an address' } }), reply)
    expect(reply.sent).toMatchObject({ code: 403, body: { code: 'REGISTRATION_CLOSED' } })
    expect(created).toHaveLength(0)
  })

  it('creates a waiting account under `approval`, whatever the body says, and writes it in the access log', async () => {
    const { server, created, accesses } = registration('approval')
    await register(fakeRequest({ server, data: { ...body, confirmed: true, approved: true } }), fakeReply())
    expect(created[0]).toMatchObject({ approved: false })
    expect(created[0].confirmed).toBeUndefined()
    expect(accesses).toEqual([
      expect.objectContaining({ event: 'account.pending', outcome: 'success', subjectId: 'x-new', scope: 'tenant' })
    ])
  })

  it('under `approval`, answers a taken address like a free one and writes as much to the log', async () => {
    const { server, accesses } = registration('approval')
    server.userManager.createUser = async () => {
      throw Object.assign(new Error('Email already registered'), { code: EMAIL_ALREADY_REGISTERED })
    }
    const reply = fakeReply()
    const decoy: any = await register(fakeRequest({ server, data: { ...body } }), reply)
    expect(reply.sent.code).toBe(200)
    expect(Object.keys(decoy).sort()).toEqual(['email', 'externalId', 'id', 'roles', 'username'])
    expect(accesses).toEqual([
      expect.objectContaining({ event: 'account.pending', outcome: 'failure', code: 'AUTH_EMAIL_TAKEN' })
    ])
    expect(accesses[0].subjectId).toBeUndefined()
  })

  it('creates an account that waits for nobody under `open`', async () => {
    const { server, created, accesses } = registration('open')
    await register(fakeRequest({ server, data: { ...body } }), fakeReply())
    expect(created[0]).toMatchObject({ approved: true })
    expect(accesses).toEqual([])
  })

  it('keeps a waiting account out, with the cause for the log only', async () => {
    const users: any = { isValidUser: async (u: any) => !!u?.email && !!u?.password }
    const row = { email: 'a@acme.test', password: 'h', confirmed: true, blocked: false }
    expect(await tenantRefusal(users, row)).toBeNull()
    expect(await tenantRefusal(users, { ...row, approved: false })).toBe('AUTH_PENDING_APPROVAL')
    expect(await tenantRefusal(users, { ...row, approved: false, blocked: true })).toBe('AUTH_BLOCKED')
  })

  it('approves a waiting account once, and says so in the access log', async () => {
    const accesses: any[] = []
    const rows: any[] = [{ id: 'u1', externalId: 'x-u1', approved: false }]
    const server = {
      accessLogManager: {
        isImplemented: () => true,
        record: async (_c: any, e: any) => void accesses.push(e),
        purgeExpired: async () => 0
      },
      userManager: {
        isImplemented: () => true,
        retrieveUserById: async (_c: any, id: string) => rows.find((r) => r.id === id) ?? null,
        approveUserById: async (_c: any, id: string) => {
          const row = rows.find((r) => r.id === id && r.approved === false)
          if (!row) return false
          row.approved = true
          return true
        }
      }
    }

    const first = fakeReply()
    expect(await approve(fakeRequest({ server, params: { id: 'u1' } }), first)).toEqual({ ok: true })
    expect(accesses).toEqual([expect.objectContaining({ event: 'account.approved', subjectId: 'x-u1' })])

    const again = fakeReply()
    await approve(fakeRequest({ server, params: { id: 'u1' } }), again)
    expect(again.sent).toMatchObject({ code: 409, body: { code: 'USER_NOT_PENDING' } })

    const missing = fakeReply()
    await approve(fakeRequest({ server, params: { id: 'nobody' } }), missing)
    expect(missing.sent).toMatchObject({ code: 404, body: { code: 'NOT_FOUND' } })
    expect(accesses).toHaveLength(1)
  })
})
