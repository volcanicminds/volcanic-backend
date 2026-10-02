/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The genesis check without ADMIN_EMAIL, against a migrated container: the question "is there an
// admin?" is a query on the `roles` array, and only a real database says whether the operator
// it uses can ask it. The fake manager of test/lib/genesis.spec.ts answers any query.
//
import { expect } from 'expect'
import { ensureGenesisAdmin } from '../../lib/loader/genesis.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { DATABASE_URL, migratedPglite, migratedPostgres, type Migrated } from './fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`loader/genesis · without ADMIN_EMAIL on ${name}`, function () {
    this.timeout(30000)
    let db: Migrated
    const users = createUserManager()
    const savedEmail = process.env.ADMIN_EMAIL

    before(async () => {
      db = await open()
      delete process.env.ADMIN_EMAIL
    })
    after(async () => {
      if (savedEmail !== undefined) process.env.ADMIN_EMAIL = savedEmail
      await db?.close()
    })

    const genesis = async () => {
      const fatal: string[] = []
      const server = { userManager: users, provider: { control: async () => db.control } }
      await ensureGenesisAdmin(server as any, { onFatal: (message) => fatal.push(message) })
      return fatal
    }

    it('fails fast with its own message when there is no user at all', async () => {
      expect(await genesis()).toEqual([expect.stringMatching(/no admin exists and ADMIN_EMAIL is not set/)])
    })

    it('fails fast when the only users are not admins', async () => {
      await users.createUser(db.control, { email: 'reader@example.com', password: 'Passw0rd!x', roles: ['public'] })
      expect(await genesis()).toHaveLength(1)
    })

    it('boots once a user holds the admin role among others', async () => {
      await users.createUser(db.control, {
        email: 'owner@example.com',
        password: 'Passw0rd!x',
        roles: ['public', 'admin']
      })
      expect(await genesis()).toEqual([])
    })
  })
}

behaviours('PGlite', () => migratedPglite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_genesis_ctl', tenant: 'test_genesis_acme' }))
}
