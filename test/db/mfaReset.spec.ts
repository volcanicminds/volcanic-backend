/* eslint-disable @typescript-eslint/no-explicit-any */
//
// S13, the emergency MFA reset against a migrated container: the factor goes and the access log
// keeps a row the admin reads with the same query as any other access. The doubles of
// test/lib/mfaReset.spec.ts accept any event; only the real manager refuses one outside its
// vocabulary.
//
import { expect } from 'expect'
import { emergencyMfaReset } from '../../lib/loader/mfaReset.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { createAccessLogManager } from '../../lib/database/managers/accessLog.js'
import { DATABASE_URL, migratedPglite, migratedPostgres, type Migrated } from './fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`loader/mfaReset · the access log on ${name} (S13)`, function () {
    this.timeout(30000)
    let db: Migrated
    const users = createUserManager()
    const accessLog = createAccessLogManager()
    const previousConfig = (global as any).config
    const now = new Date()
    const env = (email: string) => ({
      MFA_ADMIN_FORCED_RESET_EMAIL: email,
      MFA_ADMIN_FORCED_RESET_UNTIL: new Date(now.getTime() + 5 * 60_000).toISOString()
    })

    before(async () => {
      db = await open()
      ;(global as any).config = { options: {} }
    })
    after(async () => {
      ;(global as any).config = previousConfig
      await db?.close()
    })

    const reset = (email: string) => {
      const server = { userManager: users, accessLogManager: accessLog, provider: { control: async () => db.control } }
      return emergencyMfaReset(server as any, { env: env(email), now })
    }

    it('disables the factor and writes a row under the tenant scope', async () => {
      const admin = await users.createUser(db.control, { email: 'owner@example.com', password: 'Passw0rd!x', roles: ['admin'] })
      await users.enableMfa(db.control, admin.id)

      expect(await reset('owner@example.com')).toBe('reset')
      expect((await users.retrieveUserById(db.control, admin.id))?.mfaEnabled).toBe(false)
      const rows = (await accessLog.findQuery(db.control, { event: 'mfa.emergency_reset' }, 'tenant')).records
      expect(rows).toEqual([
        expect.objectContaining({ outcome: 'success', subjectId: admin.externalId, methods: ['totp'], ip: null, code: null })
      ])
    })

    it('writes a failure without a subject for an address that matches nobody', async () => {
      expect(await reset('nobody@example.com')).toBe('not-found')
      expect(await accessLog.countQuery(db.control, { event: 'mfa.emergency_reset', outcome: 'failure' }, 'tenant')).toBe(1)
      const [row] = (await accessLog.findQuery(db.control, { event: 'mfa.emergency_reset', outcome: 'failure' }, 'tenant')).records
      expect(row).toMatchObject({ code: 'NOT_FOUND', subjectId: null })
    })
  })
}

behaviours('PGlite', () => migratedPglite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_mfareset_ctl', tenant: 'test_mfareset_acme' }))
}
