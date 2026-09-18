/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-11.5, against a real SQLite in memory: the session registry as the database sees it.
//
// The controller-level behaviour lives in test/lib/authChannels.spec.ts with an in-memory store.
// What is proved here is the part that store cannot prove: that the SQL does what the contract
// says, in particular the two things that are statements and not JavaScript — the generation in
// the WHERE clause, which is what makes two simultaneous renewals end with one winner, and the
// shift of `secret_hash` into `previous_secret_hash` inside a single UPDATE.
//
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { expect } from 'expect'
import { appTables } from '../../lib/database/schema/sqlite.js'
import { createSessionManager, hashSecret } from '../../lib/database/managers/session.js'

const tables = appTables()

const createTableSql = (table: any) => {
  const config = getTableConfig(table)
  const columns = config.columns
    .map((c: any) => `"${c.name}" ${c.getSQLType()}${c.primary ? ' primary key' : ''}`)
    .join(', ')
  return `create table "${config.name}" (${columns})`
}

const sessions = createSessionManager()
let handle: any

const open = (overrides: Record<string, unknown> = {}) =>
  sessions.openSession(handle, {
    subjectId: 'u-ext-1',
    scope: 'tenant',
    secret: 'secret-one',
    idleExpiresAt: new Date(Date.now() + 3600_000),
    absoluteExpiresAt: new Date(Date.now() + 86_400_000),
    ...(overrides as any)
  })

before(() => {
  const sqlite = new Database(':memory:')
  const db = drizzle(sqlite)
  sqlite.exec(createTableSql(tables.session))
  handle = { kind: 'tenant', dialect: 'sqlite', tenantId: 'acme', db, tables }
})

describe('database/managers · the session registry (T-11.5)', () => {
  it('refuses to work without a handle instead of finding one', async () => {
    await expect(sessions.findBySecret(undefined as never, 'x', 10)).rejects.toThrow(/needs a data handle/)
  })

  it('writes the hash of the secret and never the secret', async () => {
    const row: any = await open({ secret: 'plain-secret' })
    const stored: any = handle.db.select().from(tables.session).all().find((r: any) => r.sid === row.sid)

    expect(stored.secretHash).toBe(hashSecret('plain-secret'))
    expect(JSON.stringify(stored)).not.toContain('plain-secret')
    expect(stored.generation).toBe(1)
    expect(stored.previousSecretHash).toBeNull()
  })

  it('recognises the current secret, and nothing else', async () => {
    const row = await open({ secret: 'current-one' })
    const found: any = await sessions.findBySecret(handle, 'current-one', 10)

    expect(found.outcome).toBe('current')
    expect(found.session.sid).toBe(row.sid)
    expect((await sessions.findBySecret(handle, 'never-issued', 10)).outcome).toBe('unknown')
  })

  it('shifts the spent generation into the previous one, in a single statement', async () => {
    const row = await open({ secret: 'gen-1' })
    const rotated: any = await sessions.rotate(handle, row.sid, row.generation, {
      secret: 'gen-2',
      idleExpiresAt: new Date(Date.now() + 7200_000)
    })

    expect(rotated.generation).toBe(2)
    expect(rotated.secretHash).toBe(hashSecret('gen-2'))
    // The UPDATE assigns from the OLD row on both engines, which is what lets one statement move
    // the credential down a step instead of the caller handing back what it just consumed.
    expect(rotated.previousSecretHash).toBe(hashSecret('gen-1'))
    expect((await sessions.findBySecret(handle, 'gen-2', 10)).outcome).toBe('current')
  })

  it('tolerates the spent generation inside the window, and calls it a reuse outside it', async () => {
    const row = await open({ secret: 'grace-1' })
    await sessions.rotate(handle, row.sid, row.generation, { secret: 'grace-2', idleExpiresAt: new Date(Date.now() + 7200_000) })

    expect((await sessions.findBySecret(handle, 'grace-1', 10)).outcome).toBe('grace')
    // A tolerance of zero is a choice, and it has to mean no tolerance at all.
    expect((await sessions.findBySecret(handle, 'grace-1', 0)).outcome).toBe('reused')
  })

  it('lets exactly one of two simultaneous renewals win', async () => {
    const row = await open({ secret: 'race-1' })
    const next = { idleExpiresAt: new Date(Date.now() + 7200_000) }

    const first = await sessions.rotate(handle, row.sid, row.generation, { secret: 'race-2', ...next })
    // The loser asked to spend a generation that is no longer current: it gets null, and the
    // caller answers with an access token instead of minting a second live credential.
    const second = await sessions.rotate(handle, row.sid, row.generation, { secret: 'race-3', ...next })

    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect((await sessions.findBySecret(handle, 'race-3', 10)).outcome).toBe('unknown')
  })

  it('answers revoked after a revocation, and says so only once', async () => {
    const row = await open({ secret: 'revoke-1' })

    expect(await sessions.revokeSession(handle, row.sid, 'logout')).toBe(true)
    // Idempotent: revoking an already revoked session is the same state, not an error.
    expect(await sessions.revokeSession(handle, row.sid, 'logout')).toBe(false)

    const found: any = await sessions.findBySecret(handle, 'revoke-1', 10)
    expect(found.outcome).toBe('revoked')
    expect(found.session.revokedReason).toBe('logout')
  })

  it('closes every live session of a subject, and lists only what is still open', async () => {
    const subjectId = 'u-ext-many'
    await open({ subjectId, secret: 'many-1' })
    await open({ subjectId, secret: 'many-2' })

    expect((await sessions.listOfSubject(handle, subjectId)).length).toBe(2)
    expect(await sessions.revokeAllOfSubject(handle, subjectId, 'tokens invalidated by the user')).toBe(2)
    expect(await sessions.listOfSubject(handle, subjectId)).toEqual([])
    // Nothing left to close: the count is how many were closed, not how many exist.
    expect(await sessions.revokeAllOfSubject(handle, subjectId, 'again')).toBe(0)
  })

  it('refuses a session whose clocks have run out, on either of the two', async () => {
    const idle = await open({ subjectId: 'u-idle', secret: 'idle-1', idleExpiresAt: new Date(Date.now() - 1000) })
    const absolute = await open({
      subjectId: 'u-absolute',
      secret: 'absolute-1',
      absoluteExpiresAt: new Date(Date.now() - 1000)
    })

    expect((await sessions.findBySecret(handle, 'idle-1', 10)).outcome).toBe('expired')
    expect((await sessions.findBySecret(handle, 'absolute-1', 10)).outcome).toBe('expired')
    expect(idle.sid).not.toBe(absolute.sid)
  })

  it('purges what no renewal can use, and keeps a revoked session until its own deadline', async () => {
    const live = await open({ subjectId: 'u-purge', secret: 'purge-live' })
    const revoked = await open({ subjectId: 'u-purge', secret: 'purge-revoked' })
    await sessions.revokeSession(handle, revoked.sid, 'logout')
    await open({ subjectId: 'u-purge', secret: 'purge-dead', idleExpiresAt: new Date(Date.now() - 1000) })

    const removed = await sessions.purgeExpired(handle)
    expect(removed).toBeGreaterThanOrEqual(1)

    expect((await sessions.findBySecret(handle, 'purge-live', 10)).outcome).toBe('current')
    // The revoked row survives: "when did this session end, and why" has to outlive the session.
    expect((await sessions.findBySecret(handle, 'purge-revoked', 10)).outcome).toBe('revoked')
    expect((await sessions.findBySecret(handle, 'purge-dead', 10)).outcome).toBe('unknown')
    expect(live.scope).toBe('tenant')
  })
})
