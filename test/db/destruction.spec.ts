//
// The emailed second factor of a destruction (docs/API_V5.md §6.2), against the migrated control
// plane: the code is stored bound to the token and never as itself, every check spends an attempt
// before comparing, and a request past its last attempt, spent or expired accepts nothing.
//
import { expect } from 'expect'
import { createDestructionManager, hashToken } from '../../lib/database/managers/destruction.js'
import { challengeMac } from '../../lib/database/managers/authFlow.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from './fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

const MAX = 5

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`database/managers · the destruction code on ${name}`, function () {
    this.timeout(30000)
    let db: Migrated
    const destructions = createDestructionManager()
    let sequence = 0

    before(async () => (db = await open()))
    after(async () => await db?.close())

    const request = async (over: { code?: string; expiresAt?: Date } = {}) => {
      const token = `token-${++sequence}`
      const row = await destructions.openRequest(db.control, {
        tenantId: 'id-acme',
        systemUserId: 'sys-1',
        token,
        code: over.code,
        preview: { rowCounts: {} },
        expiresAt: over.expiresAt ?? new Date(Date.now() + 600_000)
      })
      return { token, row }
    }

    it('keeps the code as an HMAC keyed by the token, and a TOTP request without one', async () => {
      const { token, row } = await request({ code: '123456' })
      expect(row.codeHash).toBe(challengeMac(token, '123456'))
      expect(row.tokenHash).toBe(hashToken(token))
      expect(JSON.stringify(row)).not.toContain('123456')
      expect(Number(row.codeAttempts)).toBe(0)

      const totp = await request()
      expect(totp.row.codeHash ?? null).toBeNull()
      // A request opened for a TOTP has no code to guess.
      expect(await destructions.checkCode(db.control, totp.row.id, { token: totp.token, code: '123456', maxAttempts: MAX })).toEqual({
        ok: false,
        remaining: 0
      })
    })

    it('accepts the code with its own token only', async () => {
      const { token, row } = await request({ code: '654321' })
      expect(await destructions.checkCode(db.control, row.id, { token: 'another-token', code: '654321', maxAttempts: MAX })).toEqual({
        ok: false,
        remaining: 0
      })
      expect(await destructions.checkCode(db.control, row.id, { token, code: '654321', maxAttempts: MAX })).toEqual({
        ok: true,
        remaining: MAX - 1
      })
    })

    it('spends an attempt per check, and past the last one refuses even the right code', async () => {
      const { token, row } = await request({ code: '111111' })
      for (let left = MAX - 1; left >= 0; left--) {
        expect(await destructions.checkCode(db.control, row.id, { token, code: '000000', maxAttempts: MAX })).toEqual({
          ok: false,
          remaining: left
        })
      }
      expect(await destructions.checkCode(db.control, row.id, { token, code: '111111', maxAttempts: MAX })).toEqual({
        ok: false,
        remaining: 0
      })
    })

    it('gives concurrent guesses one attempt each, never more than the ceiling', async () => {
      const { token, row } = await request({ code: '222222' })
      const answers = await Promise.all(
        Array.from({ length: MAX + 3 }, () => destructions.checkCode(db.control, row.id, { token, code: '999999', maxAttempts: MAX }))
      )
      // MAX checks were counted (remaining MAX - 1 down to 0), the three beyond found no attempt.
      expect(answers.filter((a) => a.remaining > 0).length).toBe(MAX - 1)
      expect(await destructions.checkCode(db.control, row.id, { token, code: '222222', maxAttempts: MAX })).toEqual({
        ok: false,
        remaining: 0
      })
    })

    it('refuses the code of a request spent or expired', async () => {
      const spent = await request({ code: '333333' })
      expect(await destructions.consumeRequest(db.control, spent.row.id, '/tmp/export.sql')).toBeTruthy()
      expect((await destructions.checkCode(db.control, spent.row.id, { token: spent.token, code: '333333', maxAttempts: MAX })).ok).toBe(
        false
      )
      // Spent once: a second consumption answers null, and the controller refuses on it.
      expect(await destructions.consumeRequest(db.control, spent.row.id, '/tmp/export.sql')).toBeNull()

      const expired = await request({ code: '444444', expiresAt: new Date(Date.now() - 1000) })
      expect((await destructions.checkCode(db.control, expired.row.id, { token: expired.token, code: '444444', maxAttempts: MAX })).ok).toBe(
        false
      )
    })
  })
}

behaviours('SQLite', () => migratedSqlite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_destruction_ctl', tenant: 'test_destruction_acme' }))
}
