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

function server(options: { auditFails?: boolean } = {}) {
  const calls = { user: [] as string[], system: [] as string[] }
  const rows: any[] = []
  const users = {
    isImplemented: () => true,
    retrieveUserByEmail: async (_ctx: any, email: string) => (email === 'admin@acme.test' ? { id: 'u-1', externalId: 'x-u-1' } : null),
    forceDisableMfa: async (_ctx: any, id: string) => calls.user.push(id)
  }
  const systemUsers = {
    isImplemented: () => true,
    retrieveSystemUserByEmail: async (_ctx: any, email: string) => (email === 'admin@acme.test' ? { id: 's-1', externalId: 'x-s-1' } : null),
    disableMfa: async (_ctx: any, id: string) => calls.system.push(id)
  }
  const accessLog = {
    isImplemented: () => true,
    record: async (ctx: any, entry: any) => {
      if (options.auditFails) throw new Error('relation "access_log" does not exist')
      rows.push({ ctx, ...entry })
      return entry
    }
  }
  const instance: any = {
    provider: { control: async () => CONTROL },
    userManager: users,
    systemUserManager: systemUsers,
    accessLogManager: accessLog
  }
  return { instance, calls, rows }
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

  // S13: the reset has no actor and no request, so the access log is the only trace the admin reads.
  describe('the access log', () => {
    const row = (scope: string, outcome: string, subjectId: string | null, code?: string) => ({
      ctx: CONTROL,
      event: 'mfa.emergency_reset',
      scope,
      outcome,
      subjectId,
      methods: ['totp'],
      ...(code ? { code } : {})
    })

    it('records the reset of a user under the tenant scope of the control container', async () => {
      withTenants(false)
      const { instance, rows } = server()
      expect(await emergencyMfaReset(instance, { env: env(5), now: NOW })).toBe('reset')
      expect(rows).toEqual([row('tenant', 'success', 'x-u-1')])
    })

    it('records the reset of a platform identity under the control scope', async () => {
      withTenants(true)
      const { instance, rows } = server()
      expect(await emergencyMfaReset(instance, { env: env(5), now: NOW })).toBe('reset')
      expect(rows).toEqual([row('control', 'success', 'x-s-1')])
    })

    it('records an address that matches nobody as a failure without a subject', async () => {
      withTenants(true)
      const { instance, rows } = server()
      expect(await emergencyMfaReset(instance, { env: env(5, 'nobody@acme.test'), now: NOW })).toBe('not-found')
      expect(rows).toEqual([row('control', 'failure', null, 'NOT_FOUND')])
    })

    it('writes nothing for a window that never opened', async () => {
      withTenants(false)
      const { instance, rows } = server()
      expect(await emergencyMfaReset(instance, { env: env(-1), now: NOW })).toBe('expired')
      expect(await emergencyMfaReset(instance, { env: {}, now: NOW })).toBe('not-requested')
      expect(rows).toEqual([])
    })

    it('keeps the reset when the row cannot be written', async () => {
      withTenants(false)
      const { instance, calls } = server({ auditFails: true })
      expect(await emergencyMfaReset(instance, { env: env(5), now: NOW })).toBe('reset')
      expect(calls.user).toEqual(['u-1'])
    })
  })
})
