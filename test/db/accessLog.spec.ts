//
// T-12.12, the access log manager of F44 on a real migrated container: the closed vocabulary, the
// truncated address, and the purge by predicate. SQLite always, Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import { eq } from 'drizzle-orm'
import type { AccessLogEntry } from '../../types/global.js'
import { createAccessLogManager, truncateIp } from '../../lib/database/managers/accessLog.js'
import { column } from '../../lib/database/managers/runtime.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from './fixtures/migrated.js'

;(global as unknown as { log: object }).log = {}

const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p
  } catch (e) {
    return String((e as { code?: string }).code ?? 'NO_CODE')
  }
  return 'NO_ERROR'
}

describe('database/managers · the access log address (F44)', () => {
  it('truncates IPv4 to its /24 and IPv6 to its /48', () => {
    expect(truncateIp('203.0.113.77')).toBe('203.0.113.0')
    expect(truncateIp('2001:db8:85a3:8d3:1319:8a2e:370:7348')).toBe('2001:db8:85a3::')
    expect(truncateIp('2001:db8::1')).toBe('2001:db8:0::')
    expect(truncateIp('::1')).toBe('0:0:0::')
    expect(truncateIp('fe80::1%eth0')).toBe('fe80:0:0::')
    expect(truncateIp('64:ff9b::192.0.2.33')).toBe('64:ff9b:0::')
  })

  it('treats an IPv4-mapped IPv6 as the IPv4 it carries, and drops what is not an address', () => {
    expect(truncateIp('::ffff:198.51.100.23')).toBe('198.51.100.0')
    expect(truncateIp('not-an-ip')).toBeNull()
    expect(truncateIp('')).toBeNull()
    expect(truncateIp(null)).toBeNull()
    expect(truncateIp('203.0.113.77', 'none')).toBeNull()
  })
})

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`database/managers · the access log on ${name} (T-12.12)`, function () {
    this.timeout(30000)
    let db: Migrated
    const accessLog = createAccessLogManager()
    const entry: AccessLogEntry = {
      event: 'login.failed',
      outcome: 'failure',
      scope: 'tenant',
      code: 'AUTH_INVALID_CREDENTIALS',
      subjectId: 'user-1',
      methods: ['password'],
      ip: '203.0.113.77'
    }

    before(async () => (db = await open()))
    after(async () => await db?.close())

    it('writes a row with the address truncated', async () => {
      const row = await accessLog.record(db.tenant, entry)
      expect(row).toMatchObject({ event: 'login.failed', outcome: 'failure', scope: 'tenant', ip: '203.0.113.0', methods: ['password'] })
      expect(row.id).toBeTruthy()
      expect(row.occurredAt).toBeTruthy()
    })

    it('drops the address entirely with ACCESS_LOG_IP=none', async () => {
      const previous = process.env.ACCESS_LOG_IP
      process.env.ACCESS_LOG_IP = 'none'
      try {
        expect((await accessLog.record(db.tenant, { ...entry, ip: '2001:db8::1' })).ip).toBeNull()
      } finally {
        if (previous === undefined) delete process.env.ACCESS_LOG_IP
        else process.env.ACCESS_LOG_IP = previous
      }
      expect((await createAccessLogManager({ ip: 'none' }).record(db.tenant, entry)).ip).toBeNull()
    })

    it('refuses an event outside the vocabulary, and an entry without outcome or scope', async () => {
      expect(await codeOf(accessLog.record(db.tenant, { ...entry, event: 'login.renewed' as never }))).toBe('ACCESS_EVENT_UNKNOWN')
      expect(await codeOf(accessLog.record(db.tenant, { ...entry, outcome: 'maybe' as never }))).toBe('ACCESS_LOG_ENTRY_INVALID')
      expect(await codeOf(accessLog.record(db.tenant, { ...entry, scope: 'global' as never }))).toBe('ACCESS_LOG_ENTRY_INVALID')
    })

    it('finds and counts through Magic Query', async () => {
      await accessLog.record(db.tenant, { ...entry, event: 'logout', outcome: 'success', code: null })
      const found = await accessLog.findQuery(db.tenant, { event: 'logout' })
      expect(found.records.every((r) => r.event === 'logout')).toBe(true)
      expect(found.records.length).toBeGreaterThan(0)
      expect(await accessLog.countQuery(db.tenant, { event: 'logout' })).toBe(found.records.length)
    })

    it('purges by predicate: a row before the threshold goes, one after it stays', async () => {
      const old = await accessLog.record(db.tenant, { ...entry, subjectId: 'old-subject' })
      const recent = await accessLog.record(db.tenant, { ...entry, subjectId: 'recent-subject' })
      const t = db.raw.tables.accessLog
      await db.raw.db
        .update(t)
        .set({ occurredAt: new Date(Date.now() - 100 * 86_400_000) })
        .where(eq(column(t, 'id'), old.id as never))

      expect(await accessLog.purgeBefore(db.tenant, new Date(Date.now() - 90 * 86_400_000))).toBe(1)
      const left = (await db.raw.db.select().from(t)) as Array<{ id: string }>
      expect(left.map((r) => r.id)).toContain(recent.id)
      expect(left.map((r) => r.id)).not.toContain(old.id)
    })
  })
}

behaviours('SQLite', () => migratedSqlite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_p12_log_ctl', tenant: 'test_p12_log_acme' }))
}
