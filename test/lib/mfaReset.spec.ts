/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { emergencyMfaReset } from '../../lib/loader/mfaReset.js'

// The emergency reset looks for the administrator where the genesis puts it: a platform identity
// with tenants declared, a user of the control container without.
;(global as any).log = {}

const CONTROL: any = { kind: 'control' }
const NOW = new Date('2026-09-24T10:00:00.000Z')
const env = (minutesAhead: number, email = 'admin@acme.test') => ({
  MFA_ADMIN_FORCED_RESET_EMAIL: email,
  MFA_ADMIN_FORCED_RESET_UNTIL: new Date(NOW.getTime() + minutesAhead * 60_000).toISOString()
})

function server() {
  const calls = { user: [] as string[], system: [] as string[] }
  const users = {
    isImplemented: () => true,
    retrieveUserByEmail: async (_ctx: any, email: string) => (email === 'admin@acme.test' ? { id: 'u-1' } : null),
    forceDisableMfa: async (_ctx: any, id: string) => calls.user.push(id)
  }
  const systemUsers = {
    isImplemented: () => true,
    retrieveSystemUserByEmail: async (_ctx: any, email: string) => (email === 'admin@acme.test' ? { id: 's-1' } : null),
    disableMfa: async (_ctx: any, id: string) => calls.system.push(id)
  }
  const instance: any = { provider: { control: async () => CONTROL }, userManager: users, systemUserManager: systemUsers }
  return { instance, calls }
}

describe('emergency MFA reset at boot', () => {
  const previous = (global as any).config
  afterEach(() => ((global as any).config = previous))
  const withTenants = (on: boolean) => ((global as any).config = on ? { options: { tenants: { strategy: 'schema' } } } : { options: {} })

  it('resets a user of the control container in a single-tenant deployment', async () => {
    withTenants(false)
    const { instance, calls } = server()
    expect(await emergencyMfaReset(instance, { env: env(5), now: NOW })).toBe('reset')
    expect(calls).toEqual({ user: ['u-1'], system: [] })
  })

  it('resets the platform identity, not an application user, when tenants are declared', async () => {
    withTenants(true)
    const { instance, calls } = server()
    expect(await emergencyMfaReset(instance, { env: env(5), now: NOW })).toBe('reset')
    expect(calls).toEqual({ user: [], system: ['s-1'] })
  })

  it('says so when nobody has the address, and resets nothing', async () => {
    withTenants(true)
    const { instance, calls } = server()
    expect(await emergencyMfaReset(instance, { env: env(5, 'nobody@acme.test'), now: NOW })).toBe('not-found')
    expect(calls).toEqual({ user: [], system: [] })
  })

  it('ignores an expired window and refuses one further than ten minutes', async () => {
    withTenants(false)
    const { instance, calls } = server()
    expect(await emergencyMfaReset(instance, { env: env(-1), now: NOW })).toBe('expired')
    const fatal: string[] = []
    expect(await emergencyMfaReset(instance, { env: env(11), now: NOW, onFatal: (m) => fatal.push(m) })).toBe('too-far')
    expect(fatal[0]).toContain('too far in the future')
    expect(calls).toEqual({ user: [], system: [] })
  })

  it('does nothing without both variables, and nothing without a data layer', async () => {
    withTenants(false)
    expect(await emergencyMfaReset(server().instance, { env: {}, now: NOW })).toBe('not-requested')
    expect(await emergencyMfaReset({} as any, { env: env(5), now: NOW })).toBe('no-data-layer')
  })
})
