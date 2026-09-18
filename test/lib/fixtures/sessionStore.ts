/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto'

//
// An in-memory session registry with the semantics of the real one (lib/database/managers/session.ts).
//
// The controllers are what these tests are about, and a controller cannot tell this apart from the
// Drizzle manager: same outcomes, same grace window, same race on the generation. The SQL version is
// exercised against real engines in test/db.
//
const hash = (value: string) => crypto.createHash('sha256').update(String(value)).digest('hex')

export interface FakeSession {
  id: string
  sid: string
  subjectId: string
  scope: 'tenant' | 'control'
  secretHash: string
  previousSecretHash: string | null
  generation: number
  rotatedAt: Date | null
  lastUsedAt: Date
  idleExpiresAt: Date
  absoluteExpiresAt: Date
  revokedAt: Date | null
  revokedReason: string | null
  ip: string | null
  userAgent: string | null
  impersonationId: string | null
  createdAt: Date
}

export function fakeSessionStore() {
  const rows = new Map<string, FakeSession>()
  let minted = 0

  const state = (row: FakeSession, now: Date): 'live' | 'revoked' | 'expired' => {
    if (row.revokedAt) return 'revoked'
    if (row.idleExpiresAt <= now || row.absoluteExpiresAt <= now) return 'expired'
    return 'live'
  }

  const manager = {
    isImplemented: () => true,

    async openSession(_ctx: any, data: any): Promise<FakeSession> {
      minted += 1
      const row: FakeSession = {
        id: `sess-${minted}`,
        sid: `sid-${minted}`,
        subjectId: String(data.subjectId),
        scope: data.scope,
        secretHash: hash(data.secret),
        previousSecretHash: null,
        generation: 1,
        rotatedAt: null,
        lastUsedAt: new Date(),
        idleExpiresAt: new Date(data.idleExpiresAt),
        absoluteExpiresAt: new Date(data.absoluteExpiresAt),
        revokedAt: null,
        revokedReason: null,
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null,
        impersonationId: data.impersonationId ?? null,
        createdAt: new Date()
      }
      rows.set(row.sid, row)
      return row
    },

    async findBySecret(_ctx: any, secret: string, graceSeconds: number) {
      const digest = hash(secret ?? '')
      const now = new Date()

      const current = [...rows.values()].find((row) => row.secretHash === digest)
      if (current) {
        const found = state(current, now)
        if (found === 'revoked') return { outcome: 'revoked', session: current }
        if (found === 'expired') return { outcome: 'expired', session: current }
        return { outcome: 'current', session: current }
      }

      const previous = [...rows.values()].find((row) => row.previousSecretHash === digest)
      if (!previous) return { outcome: 'unknown' }
      if (previous.revokedAt) return { outcome: 'revoked', session: previous }

      const rotatedAt = previous.rotatedAt
      // Strictly inside the window: with `<=`, a tolerance of zero still accepted a replay that
      // landed in the same millisecond as the rotation (the real manager had the same flaw).
      const withinGrace = rotatedAt !== null && now.getTime() - rotatedAt.getTime() < Math.max(0, graceSeconds) * 1000
      if (!withinGrace) return { outcome: 'reused', session: previous }
      return state(previous, now) === 'expired' ? { outcome: 'expired', session: previous } : { outcome: 'grace', session: previous }
    },

    async rotate(_ctx: any, sid: string, generation: number, next: any) {
      const row = rows.get(sid)
      // The generation in the condition is what makes two simultaneous renewals end with one
      // winner, exactly as the WHERE clause does in the real manager.
      if (!row || row.revokedAt || row.generation !== generation) return null
      row.previousSecretHash = row.secretHash
      row.secretHash = hash(next.secret)
      row.generation = generation + 1
      row.rotatedAt = new Date()
      row.lastUsedAt = new Date()
      row.idleExpiresAt = new Date(next.idleExpiresAt)
      return row
    },

    async revokeSession(_ctx: any, sid: string, reason: string) {
      const row = rows.get(sid)
      if (!row || row.revokedAt) return false
      row.revokedAt = new Date()
      row.revokedReason = reason
      return true
    },

    async revokeAllOfSubject(_ctx: any, subjectId: string, reason: string) {
      let closed = 0
      for (const row of rows.values()) {
        if (row.subjectId !== subjectId || row.revokedAt) continue
        row.revokedAt = new Date()
        row.revokedReason = reason
        closed += 1
      }
      return closed
    },

    async listOfSubject(_ctx: any, subjectId: string) {
      return [...rows.values()].filter((row) => row.subjectId === subjectId && !row.revokedAt)
    },

    async purgeExpired(_ctx: any, before?: Date | string) {
      const cutoff = before ? new Date(before) : new Date()
      let removed = 0
      for (const [sid, row] of rows) {
        if (row.absoluteExpiresAt <= cutoff || row.idleExpiresAt <= cutoff) {
          rows.delete(sid)
          removed += 1
        }
      }
      return removed
    }
  }

  return { manager, rows }
}
