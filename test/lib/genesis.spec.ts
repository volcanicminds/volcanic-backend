/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { ensureGenesisAdmin } from '../../lib/loader/genesis.js'

// Records what the genesis reconciliation asked the (fake) userManager to do. The real
// admin-code/config fall back to sensible defaults, so no shared globals are set here.
function fakeManager(overrides: any = {}) {
  const calls: any = { created: null, promoted: null, confirmed: null }
  return {
    calls,
    isImplemented: () => true,
    countQuery: async () => overrides.count ?? 0,
    retrieveUserByEmail: async () => overrides.existing ?? null,
    createUser: async (data: any) => {
      calls.created = data
      return { getId: () => 'new-id', ...data }
    },
    userConfirmation: async (u: any) => {
      calls.confirmed = u
    },
    updateUserById: async (id: any, data: any) => {
      calls.promoted = { id, data }
    }
  }
}

const serverWith = (um: any) => ({ userManager: um }) as any

describe('loader/genesis — ensureGenesisAdmin', () => {
  const savedEmail = process.env.ADMIN_EMAIL
  const savedPw = process.env.ADMIN_PASSWORD

  beforeEach(() => {
    ;(global as any).connection = {}
  })
  afterEach(() => {
    if (savedEmail === undefined) delete process.env.ADMIN_EMAIL
    else process.env.ADMIN_EMAIL = savedEmail
    if (savedPw === undefined) delete process.env.ADMIN_PASSWORD
    else process.env.ADMIN_PASSWORD = savedPw
    delete (global as any).connection
  })

  it('skips when there is no live connection', async () => {
    delete (global as any).connection
    const um = fakeManager()
    let fatal = false
    await ensureGenesisAdmin(serverWith(um), { onFatal: () => (fatal = true) })
    expect(um.calls.created).toBeNull()
    expect(fatal).toBe(false)
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
