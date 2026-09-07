/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { ensureGenesisAdmin } from '../../lib/loader/genesis.js'

// Records what the genesis reconciliation asked the (fake) userManager to do. The real
// admin-code/config fall back to sensible defaults, so no shared globals are set here.
const CONTROL: any = { kind: 'control' }

function fakeManager(overrides: any = {}) {
  // T-3.3: every call is recorded WITH the handle it received. Genesis runs before any
  // request exists, so if it could still reach a manager without a context, nothing at
  // request time would catch it.
  const calls: any = { created: null, promoted: null, confirmed: null, contexts: [] as any[] }
  const seen = (ctx: any) => calls.contexts.push(ctx)
  return {
    calls,
    isImplemented: () => true,
    countQuery: async (ctx: any) => {
      seen(ctx)
      return overrides.count ?? 0
    },
    retrieveUserByEmail: async (ctx: any) => {
      seen(ctx)
      return overrides.existing ?? null
    },
    createUser: async (ctx: any, data: any) => {
      seen(ctx)
      calls.created = data
      return { getId: () => 'new-id', ...data }
    },
    userConfirmation: async (ctx: any, u: any) => {
      seen(ctx)
      calls.confirmed = u
    },
    updateUserById: async (ctx: any, id: any, data: any) => {
      seen(ctx)
      calls.promoted = { id, data }
    }
  }
}

const serverWith = (um: any) =>
  ({
    userManager: um,
    provider: { control: async () => CONTROL }
  }) as any

describe('loader/genesis — ensureGenesisAdmin', () => {
  const savedEmail = process.env.ADMIN_EMAIL
  const savedPw = process.env.ADMIN_PASSWORD


  afterEach(() => {
    if (savedEmail === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = savedEmail
    if (savedPw === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = savedPw
  })

  it('skips when no data layer is loaded', async () => {
    const um = fakeManager()
    let fatal = false
    // No provider: a core-only boot has nowhere to look for an administrator, so it says
    // nothing rather than failing the startup. What it must NOT do is look anyway, which
    // is what `global.connection` allowed in v4 (T-3.3).
    await ensureGenesisAdmin({ userManager: um } as any, { onFatal: () => (fatal = true) })
    expect(um.calls.created).toBeNull()
    expect(um.calls.contexts).toEqual([])
    expect(fatal).toBe(false)
  })

  it('passes the control plane to every manager call it makes', async () => {
    process.env.ADMIN_EMAIL = 'founder@x.com'
    process.env.ADMIN_PASSWORD = 'Given-pw-123'
    const um = fakeManager({ existing: null })
    await ensureGenesisAdmin(serverWith(um))
    expect(um.calls.contexts.length).toBeGreaterThan(0)
    expect(um.calls.contexts.every((c: any) => c === CONTROL)).toBe(true)
  })

  it('creates the founder when ADMIN_EMAIL is set and missing', async () => {
    process.env.ADMIN_EMAIL = 'founder@x.com'
    process.env.ADMIN_PASSWORD = 'Given-pw-123'
    const um = fakeManager({ existing: null })
    await ensureGenesisAdmin(serverWith(um))
    expect(um.calls.created.email).toBe('founder@x.com')
    expect(um.calls.created.roles).toEqual(['admin'])
    expect(um.calls.confirmed).toBeTruthy()
  })

  it('promotes an existing non-admin founder', async () => {
    process.env.ADMIN_EMAIL = 'founder@x.com'
    const um = fakeManager({ existing: { getId: () => 'u1', roles: ['public'] } })
    await ensureGenesisAdmin(serverWith(um))
    expect(um.calls.promoted.id).toBe('u1')
    expect(um.calls.promoted.data.roles).toContain('admin')
    expect(um.calls.created).toBeNull()
  })

  it('is a no-op when the founder is already an admin', async () => {
    process.env.ADMIN_EMAIL = 'founder@x.com'
    const um = fakeManager({ existing: { getId: () => 'u1', roles: ['admin'] } })
    await ensureGenesisAdmin(serverWith(um))
    expect(um.calls.promoted).toBeNull()
    expect(um.calls.created).toBeNull()
  })

  it('proceeds without ADMIN_EMAIL when an admin already exists', async () => {
    delete process.env.ADMIN_EMAIL
    const um = fakeManager({ count: 1 })
    let fatal = false
    await ensureGenesisAdmin(serverWith(um), { onFatal: () => (fatal = true) })
    expect(fatal).toBe(false)
    expect(um.calls.created).toBeNull()
  })

  it('fails fast without ADMIN_EMAIL when there are zero admins', async () => {
    delete process.env.ADMIN_EMAIL
    const um = fakeManager({ count: 0 })
    let fatalMsg = ''
    await ensureGenesisAdmin(serverWith(um), { onFatal: (m: string) => (fatalMsg = m) })
    expect(fatalMsg).toContain('ADMIN_EMAIL')
  })
})
