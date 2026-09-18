import { and, eq, isNull, lte, or, sql } from 'drizzle-orm'
import crypto from 'crypto'
import type { DataHandle, Session, SessionLookup, SessionManagement } from '../../../types/global.js'
import { runtime, table, column } from './runtime.js'

//
// The registry of live sessions (T-11.1 → T-11.5, decisions F18 to F26 in EVO_FASE_11.md).
//
// A row is a session and not a token: `sid` is fixed for its whole life, the secret rotates at
// every renewal, and `generation` counts the rotations. Everything the fase asks for follows
// from that shape. Closing a device, closing a family because a stolen secret came back, and
// listing what is open are all the same row.
//
// The secret is never stored. What the container keeps is its SHA-256, the same choice the
// destruction token makes (./destruction.ts): a database that leaks its tables leaks nothing
// that can renew a session.
//
// Every method takes a `DataHandle` rather than a `ControlHandle`, because the session lives
// where its subject lives (F19). Which handle to pass is the caller's decision, as it is for
// users, and passing the wrong one is a session written in the wrong container, not a type the
// compiler can catch. The `scope` column exists for exactly that reason: a control session and
// a tenant session can sit in the same container of a single-tenant deployment, and a renewal
// checks the scope it expects.
//
const NAME = 'sessionManager'

/** SHA-256, hex. The secret is compared by hash and never written down. */
export function hashSecret(secret: string): string {
  return crypto.createHash('sha256').update(String(secret)).digest('hex')
}

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function createSessionManager(): SessionManagement {
  const sessions = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, session: table(handle, 'session') }
  }

  /**
   * The state of a row, decided in TypeScript and not in SQL.
   *
   * The two dialects store time differently (timestamptz against epoch milliseconds), so a
   * comparison written once in SQL would be a comparison written twice, subtly. Reading one row
   * and judging it here is the same answer on both engines.
   */
  const stateOf = (row: Session, now: Date): 'live' | 'revoked' | 'expired' => {
    if (asDate(row.revokedAt)) return 'revoked'
    const idle = asDate(row.idleExpiresAt)
    const absolute = asDate(row.absoluteExpiresAt)
    if ((idle && idle <= now) || (absolute && absolute <= now)) return 'expired'
    return 'live'
  }

  const oneBy = async (ctx: unknown, what: string, field: string, value: string): Promise<Session | null> => {
    const { handle, session } = sessions(ctx, what)
    const rows = await handle.db.select().from(session).where(eq(column(session, field), value as never)).limit(1)
    return (rows[0] as Session) ?? null
  }

  return {
    isImplemented: () => true,

    async openSession(ctx: DataHandle, data) {
      const { handle, session } = sessions(ctx, 'openSession')
      const rows = await handle.db
        .insert(session)
        .values({
          subjectId: String(data.subjectId),
          scope: data.scope,
          secretHash: hashSecret(String(data.secret)),
          idleExpiresAt: new Date(data.idleExpiresAt as never),
          absoluteExpiresAt: new Date(data.absoluteExpiresAt as never),
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          impersonationId: data.impersonationId ?? null,
          authMethods: data.authMethods ?? null
        })
        .returning()
      return rows[0] as Session
    },

    /**
     * What a presented secret turned out to be.
     *
     * The current generation answers first. If it does not match, the previous one is tried,
     * and the difference between `grace` and `reused` is only how long ago the rotation was:
     * inside the window it is two tabs renewing together, outside it is a secret that should no
     * longer exist anywhere. Unknown, revoked and expired are answers too, never exceptions:
     * this runs on a credential a stranger chose, so every shape of it must have an outcome.
     */
    async findBySecret(ctx: DataHandle, secret: string, graceSeconds: number): Promise<SessionLookup> {
      const hash = hashSecret(String(secret ?? ''))
      const now = new Date()

      const current = await oneBy(ctx, 'findBySecret', 'secretHash', hash)
      if (current) {
        const state = stateOf(current, now)
        if (state === 'revoked') return { outcome: 'revoked', session: current }
        if (state === 'expired') return { outcome: 'expired', session: current }
        return { outcome: 'current', session: current }
      }

      const previous = await oneBy(ctx, 'findBySecret', 'previousSecretHash', hash)
      if (!previous) return { outcome: 'unknown' }
      if (asDate(previous.revokedAt)) return { outcome: 'revoked', session: previous }

      const rotatedAt = asDate(previous.rotatedAt)
      // Strictly inside the window, not up to and including its edge: a tolerance of zero means
      // no tolerance, and with `<=` a replay landing in the same millisecond as the rotation was
      // accepted, which made `graceSeconds: 0` a setting that did nothing.
      const withinGrace = rotatedAt !== null && now.getTime() - rotatedAt.getTime() < Math.max(0, graceSeconds) * 1000
      if (!withinGrace) return { outcome: 'reused', session: previous }
      return stateOf(previous, now) === 'expired'
        ? { outcome: 'expired', session: previous }
        : { outcome: 'grace', session: previous }
    },

    /**
     * Spends a generation and writes the next one.
     *
     * The `generation` in the WHERE clause is what makes two simultaneous renewals end with one
     * winner: the second update matches nothing and answers null, and the caller hands back the
     * secret the winner already issued instead of minting a second live credential.
     */
    async rotate(ctx: DataHandle, sid: string, generation: number, next) {
      const { handle, session } = sessions(ctx, 'rotate')
      const now = new Date()
      const rows = await handle.db
        .update(session)
        .set({
          secretHash: hashSecret(String(next.secret)),
          // The generation being spent becomes the previous one, read from the row itself: an
          // UPDATE assigns from the OLD values on both engines, so the two columns shift by one
          // in a single statement and the caller never has to hand back the secret it consumed.
          previousSecretHash: sql`${column(session, 'secretHash')}`,
          generation: generation + 1,
          rotatedAt: now,
          lastUsedAt: now,
          idleExpiresAt: new Date(next.idleExpiresAt as never)
        })
        .where(
          and(
            eq(column(session, 'sid'), sid as never),
            eq(column(session, 'generation'), generation as never),
            isNull(column(session, 'revokedAt'))
          )
        )
        .returning()
      return (rows[0] as Session) ?? null
    },

    async revokeSession(ctx: DataHandle, sid: string, reason: string) {
      const { handle, session } = sessions(ctx, 'revokeSession')
      const rows = await handle.db
        .update(session)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(column(session, 'sid'), sid as never), isNull(column(session, 'revokedAt'))))
        .returning()
      return rows.length > 0
    },

    async revokeAllOfSubject(ctx: DataHandle, subjectId: string, reason: string) {
      const { handle, session } = sessions(ctx, 'revokeAllOfSubject')
      const rows = await handle.db
        .update(session)
        .set({ revokedAt: new Date(), revokedReason: reason })
        .where(and(eq(column(session, 'subjectId'), subjectId as never), isNull(column(session, 'revokedAt'))))
        .returning()
      return rows.length
    },

    async listOfSubject(ctx: DataHandle, subjectId: string) {
      const { handle, session } = sessions(ctx, 'listOfSubject')
      const rows = await handle.db
        .select()
        .from(session)
        .where(and(eq(column(session, 'subjectId'), subjectId as never), isNull(column(session, 'revokedAt'))))
      return rows as Session[]
    },

    /**
     * Rows no renewal can use any more: either clock having run out is enough, because a session
     * that cannot be renewed is finished whichever deadline reached it first.
     *
     * A revoked row is not singled out, and that is worth stating because it is easy to assume
     * otherwise: it is removed when its own clocks run out, like any other. Its idle clock keeps
     * the moment of its last renewal, so "when did this session end, and why" survives roughly an
     * idle period past the last time anybody used it, which is the window in which someone asks.
     */
    async purgeExpired(ctx: DataHandle, before?: Date | string) {
      const { handle, session } = sessions(ctx, 'purgeExpired')
      const cutoff = before ? new Date(before as never) : new Date()
      // One statement, and the predicate in SQL: reading the table into the process to filter it
      // here would make housekeeping cost more the more there is to clean up, which is the wrong
      // way round. `absolute_expires_at` is indexed for exactly this.
      const rows = await handle.db
        .delete(session)
        .where(
          or(
            lte(column(session, 'absoluteExpiresAt'), cutoff as never),
            lte(column(session, 'idleExpiresAt'), cutoff as never)
          )
        )
        .returning()
      return rows.length
    }
  }
}
