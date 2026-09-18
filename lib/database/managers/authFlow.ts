import { and, asc, eq, gt, isNotNull, isNull, lt, lte, ne, or, sql, type SQL } from 'drizzle-orm'
import crypto from 'crypto'
import type { Table } from 'drizzle-orm'
import type {
  AuthFlow,
  AuthFlowExternal,
  AuthFlowLookup,
  AuthFlowManagement,
  ChallengeLimits,
  ChallengeRecord,
  DataHandle,
  ExternalAuthResult,
  SessionScope
} from '../../../types/global.js'
import { encrypt, decrypt } from '../crypto.js'
import { runtime, table, column, type CrossDialectDb, type RuntimeHandle } from './runtime.js'
import { hashSecret } from './session.js'
import { isUniqueViolation } from './user.js'

//
// The flow store (F37, T-12.12).
//
// Every change that a racing request could also make is one conditional statement, never a read
// followed by a write: consuming a code, counting a wrong one, spending a send. `version` moves
// only with `advance` and with retirement, so the challenge operations in between do not make the
// engine's next `advance` lose a race nobody ran.
//
// A flow is retired (completed, cancelled, evicted) by clearing every secret and its subject slot,
// not by deleting the row: its sends must keep counting against the subject until they leave the
// window, or restarting a flow would reset the ceiling it exists to enforce. `purgeExpired` removes
// the row once that window is over.
//
const NAME = 'authFlowManager'

/** The `secret_hash` of a retired flow. No SHA-256 is empty, so no credential finds it again. */
const RETIRED = ''

/** The longest per-subject window of F37 (24 h): a retired flow's row is kept at least this long. */
const DEFAULT_SEND_WINDOW_SECONDS = 86_400

interface FlowRow {
  id: string
  flowId: string
  scope: SessionScope
  subjectId: string | null
  candidateSubjectId: string | null
  secretHash: string
  flowName: string | null
  stageIndex: number
  satisfied: string[] | null
  challengeMethod: string | null
  challengeHash: string | null
  challengeExpiresAt: Date | string | null
  challengeAttempts: number
  challengeSends: number
  lastSentAt: Date | string | null
  stateHash: string | null
  external: string | null
  externalResult: ExternalAuthResult | null
  version: number
  ip: string | null
  userAgent: string | null
  createdAt: Date | string
  expiresAt: Date | string
}

type Transactional = RuntimeHandle & { transaction<T>(fn: (tx: CrossDialectDb) => Promise<T>): Promise<T> }

/** HMAC-SHA256 keyed by the flow secret: the table alone cannot test a guess. */
export function challengeMac(secret: string, code: string): string {
  return crypto.createHmac('sha256', String(secret)).update(String(code)).digest('hex')
}

const sameHash = (a: string, b: string): boolean =>
  a.length === b.length && a.length > 0 && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

const asDate = (value: Date | string | null | undefined): Date | null => {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

async function toFlow(row: FlowRow): Promise<AuthFlow> {
  return {
    id: row.id,
    flowId: row.flowId,
    scope: row.scope,
    subjectId: row.subjectId ?? null,
    candidateSubjectId: row.candidateSubjectId ?? null,
    flowName: row.flowName ?? null,
    stageIndex: row.stageIndex,
    satisfied: row.satisfied ?? [],
    challengeMethod: row.challengeMethod ?? null,
    challengeExpiresAt: row.challengeExpiresAt ?? null,
    challengeAttempts: row.challengeAttempts,
    challengeSends: row.challengeSends,
    lastSentAt: row.lastSentAt ?? null,
    external: row.external ? (JSON.parse(await decrypt(row.external)) as AuthFlowExternal) : null,
    externalResult: row.externalResult ?? null,
    version: row.version,
    ip: row.ip ?? null,
    userAgent: row.userAgent ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt
  }
}

export function createAuthFlowManager(options: { sendWindowSeconds?: number } = {}): AuthFlowManagement {
  const sendWindowSeconds = options.sendWindowSeconds ?? DEFAULT_SEND_WINDOW_SECONDS

  const flowsOf = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, flows: table(handle, 'authFlow') }
  }
  const col = (flows: Table, name: keyof FlowRow) => column(flows, name)

  const retirement = (flows: Table, now: Date) => ({
    secretHash: RETIRED,
    stateHash: null,
    challengeHash: null,
    external: null,
    subjectId: null,
    // The subject stays countable after it leaves its slot.
    candidateSubjectId: sql`coalesce(${col(flows, 'candidateSubjectId')}, ${col(flows, 'subjectId')})`,
    expiresAt: now,
    version: sql`${col(flows, 'version')} + 1`
  })

  /** Retires every other proven flow of the subject: one live flow per proven subject (F37). */
  const evict = async (handle: RuntimeHandle, flows: Table, subjectId: string, scope: string, keep: string) => {
    await handle.db
      .update(flows)
      .set(retirement(flows, new Date()))
      .where(
        and(
          eq(col(flows, 'subjectId'), subjectId as never),
          eq(col(flows, 'scope'), scope as never),
          ne(col(flows, 'flowId'), keep as never)
        )
      )
  }

  const byFlowId = async (handle: RuntimeHandle, flows: Table, flowId: string): Promise<FlowRow | null> => {
    const rows = await handle.db.select().from(flows).where(eq(col(flows, 'flowId'), String(flowId ?? '') as never)).limit(1)
    return (rows[0] as FlowRow) ?? null
  }

  /** The sends of a subject across every flow, in one window. A statement, so it can sit in a WHERE. */
  const sendsSince = (handle: RuntimeHandle, flows: Table, subject: string, scope: string, since: Date) =>
    handle.db
      .select({ total: sql`coalesce(sum(${col(flows, 'challengeSends')}), 0)` })
      .from(flows)
      .where(
        and(
          or(eq(col(flows, 'subjectId'), subject as never), eq(col(flows, 'candidateSubjectId'), subject as never)),
          eq(col(flows, 'scope'), scope as never),
          gt(col(flows, 'lastSentAt'), since as never)
        )
      )

  /**
   * When the subject may receive a code again, or null if no window is full. A row counts all its
   * sends at its last send, which errs on the side of fewer codes, never more.
   */
  const subjectRetryAt = async (
    handle: RuntimeHandle,
    flows: Table,
    subject: string,
    scope: string,
    windows: ChallengeLimits['perSubject'],
    now: Date
  ): Promise<Date | null> => {
    let latest: Date | null = null
    for (const window of windows) {
      const since = new Date(now.getTime() - window.windowSeconds * 1000)
      const rows = (await handle.db
        .select({ sends: col(flows, 'challengeSends'), lastSentAt: col(flows, 'lastSentAt') })
        .from(flows)
        .where(
          and(
            or(eq(col(flows, 'subjectId'), subject as never), eq(col(flows, 'candidateSubjectId'), subject as never)),
            eq(col(flows, 'scope'), scope as never),
            gt(col(flows, 'lastSentAt'), since as never)
          )
        )
        .orderBy(asc(col(flows, 'lastSentAt')))) as Array<{ sends: number; lastSentAt: Date | string }>
      let total = rows.reduce((sum, r) => sum + Number(r.sends), 0)
      if (total < window.max) continue
      for (const row of rows) {
        total -= Number(row.sends)
        if (total < window.max) {
          const free = new Date((asDate(row.lastSentAt) ?? now).getTime() + window.windowSeconds * 1000)
          if (!latest || free > latest) latest = free
          break
        }
      }
    }
    return latest
  }

  return {
    isImplemented: () => true,

    async openFlow(ctx: DataHandle, data) {
      const { handle, flows } = flowsOf(ctx, 'openFlow')
      const values = {
        flowId: String(data.flowId),
        scope: data.scope,
        secretHash: hashSecret(String(data.secret)),
        subjectId: data.subjectId ?? null,
        candidateSubjectId: data.candidateSubjectId ?? null,
        flowName: data.flowName ?? null,
        expiresAt: new Date(data.expiresAt as never),
        ip: data.ip ?? null,
        userAgent: data.userAgent ?? null
      }
      // Evict, then insert. Two proven flows of one subject opening together collide on the
      // partial unique index; the loser evicts the winner and takes the slot, which is the rule.
      for (let attempt = 1; ; attempt++) {
        if (values.subjectId) await evict(handle, flows, values.subjectId, values.scope, values.flowId)
        try {
          const rows = await handle.db.insert(flows).values(values).returning()
          return await toFlow(rows[0] as FlowRow)
        } catch (err) {
          if (!values.subjectId || !isUniqueViolation(err) || attempt >= 3) throw err
        }
      }
    },

    async findBySecret(ctx: DataHandle, flowId: string, secret: string): Promise<AuthFlowLookup> {
      const { handle, flows } = flowsOf(ctx, 'findBySecret')
      const row = await byFlowId(handle, flows, flowId)
      if (!row || !sameHash(row.secretHash, hashSecret(String(secret ?? '')))) return { outcome: 'unknown' }
      const flow = await toFlow(row)
      const expiresAt = asDate(row.expiresAt)
      return expiresAt && expiresAt > new Date() ? { outcome: 'current', flow } : { outcome: 'expired', flow }
    },

    /** Only a live flow: an expired one is answered as absent, like a retired one. */
    async findByState(ctx: DataHandle, state: string) {
      const { handle, flows } = flowsOf(ctx, 'findByState')
      const rows = await handle.db
        .select()
        .from(flows)
        .where(
          and(
            eq(col(flows, 'stateHash'), hashSecret(String(state ?? '')) as never),
            gt(col(flows, 'expiresAt'), new Date() as never)
          )
        )
        .limit(1)
      return rows[0] ? await toFlow(rows[0] as FlowRow) : null
    },

    async advance(ctx: DataHandle, flowId: string, version: number, patch) {
      const { handle, flows } = flowsOf(ctx, 'advance')
      const set: Record<string, unknown> = { version: version + 1 }
      if (patch.subjectId !== undefined) set.subjectId = patch.subjectId
      if (patch.candidateSubjectId !== undefined) set.candidateSubjectId = patch.candidateSubjectId
      if (patch.flowName !== undefined) set.flowName = patch.flowName
      if (patch.stageIndex !== undefined) set.stageIndex = patch.stageIndex
      if (patch.satisfied !== undefined) set.satisfied = [...patch.satisfied]

      const scope = patch.subjectId ? (await byFlowId(handle, flows, flowId))?.scope : undefined
      for (let attempt = 1; ; attempt++) {
        // Proving the subject takes its slot, so any other proven flow of it is evicted first.
        if (patch.subjectId && scope) await evict(handle, flows, patch.subjectId, scope, flowId)
        try {
          const rows = await handle.db
            .update(flows)
            .set(set)
            .where(
              and(
                eq(col(flows, 'flowId'), String(flowId) as never),
                eq(col(flows, 'version'), version as never),
                gt(col(flows, 'expiresAt'), new Date() as never)
              )
            )
            .returning()
          return rows[0] ? await toFlow(rows[0] as FlowRow) : null
        } catch (err) {
          if (!patch.subjectId || !isUniqueViolation(err) || attempt >= 3) throw err
        }
      }
    },

    /**
     * Spends one send under both ceilings in a single conditional UPDATE: the per-flow count in
     * the row, the per-subject sums as subqueries over every flow of the subject. On Postgres the
     * statement runs under a transaction-scoped advisory lock on the subject, because under READ
     * COMMITTED two flows of one subject would otherwise each see the other's send as not yet made.
     * SQLite has one writer, so the statement alone is enough there.
     *
     * The wrong-code counter is not reset by a new send: five wrong codes per flow, not per code.
     */
    async recordChallenge(ctx: DataHandle, flowId: string, data): Promise<ChallengeRecord> {
      const { handle, flows } = flowsOf(ctx, 'recordChallenge')
      const secretHash = hashSecret(String(data.secret))
      const perFlow = data.limits.perFlow
      const windows = data.limits.perSubject

      for (let attempt = 1; ; attempt++) {
        const now = new Date()
        const row = await byFlowId(handle, flows, flowId)
        // A flow that is gone, expired or not this credential's can send nothing more, ever.
        if (!row || !sameHash(row.secretHash, secretHash) || !((asDate(row.expiresAt) ?? now) > now)) {
          return { outcome: 'limit', scope: 'flow', retryAt: null }
        }
        const subject = row.subjectId ?? row.candidateSubjectId

        const conditions: SQL[] = [
          eq(col(flows, 'flowId'), row.flowId as never),
          eq(col(flows, 'secretHash'), secretHash as never),
          gt(col(flows, 'expiresAt'), now as never),
          lt(col(flows, 'challengeSends'), perFlow as never)
        ]
        if (subject) {
          for (const window of windows) {
            const since = new Date(now.getTime() - window.windowSeconds * 1000)
            conditions.push(sql`${sendsSince(handle, flows, subject, row.scope, since)} < ${window.max}`)
          }
        }
        const send = (db: CrossDialectDb) =>
          db
            .update(flows)
            .set({
              challengeMethod: String(data.method),
              challengeHash: challengeMac(data.secret, data.code),
              challengeExpiresAt: new Date(data.expiresAt as never),
              challengeSends: sql`${col(flows, 'challengeSends')} + 1`,
              lastSentAt: now
            })
            .where(and(...conditions))
            .returning()

        const rows: FlowRow[] =
          handle.dialect === 'postgres' && subject
            ? await (handle as Transactional).transaction(async (tx) => {
                await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`auth_flow:${row.scope}:${subject}`}, 0))`)
                return await send(tx)
              })
            : await send(handle.db)

        if (rows[0]) {
          const sends = Number(rows[0].challengeSends)
          if (sends >= perFlow) return { outcome: 'sent', sends, resendAt: null }
          const blocked = subject ? await subjectRetryAt(handle, flows, subject, row.scope, windows, now) : null
          return { outcome: 'sent', sends, resendAt: blocked ?? now }
        }

        if (row.challengeSends >= perFlow) return { outcome: 'limit', scope: 'flow', retryAt: null }
        const retryAt = subject ? await subjectRetryAt(handle, flows, subject, row.scope, windows, now) : null
        if (retryAt) return { outcome: 'limit', scope: 'subject', retryAt }
        // Nothing explains the refusal any more (a send elsewhere just left the window): try once more.
        if (attempt >= 2) return { outcome: 'limit', scope: 'subject', retryAt: now }
      }
    },

    /**
     * One conditional UPDATE that matches only the right code, then one that counts a wrong one.
     * Two concurrent submissions of the right code: the first clears the hash, the second matches
     * nothing and reads as a code that is no longer there.
     */
    async consumeChallenge(ctx: DataHandle, flowId: string, data) {
      const { handle, flows } = flowsOf(ctx, 'consumeChallenge')
      const now = new Date()
      const secretHash = hashSecret(String(data.secret))
      const mac = challengeMac(data.secret, data.code)
      const live = [
        eq(col(flows, 'flowId'), String(flowId ?? '') as never),
        eq(col(flows, 'secretHash'), secretHash as never),
        gt(col(flows, 'expiresAt'), now as never),
        isNotNull(col(flows, 'challengeHash')),
        gt(col(flows, 'challengeExpiresAt'), now as never),
        lt(col(flows, 'challengeAttempts'), data.maxAttempts as never)
      ]

      const ok = await handle.db
        .update(flows)
        .set({ challengeHash: null, challengeExpiresAt: null })
        .where(and(...live, eq(col(flows, 'challengeHash'), mac as never)))
        .returning()
      if (ok.length > 0) return { outcome: 'ok' }

      const wrong = await handle.db
        .update(flows)
        .set({ challengeAttempts: sql`${col(flows, 'challengeAttempts')} + 1` })
        .where(and(...live, ne(col(flows, 'challengeHash'), mac as never)))
        .returning()
      if (wrong.length > 0) {
        const remaining = data.maxAttempts - Number((wrong[0] as FlowRow).challengeAttempts)
        return remaining > 0 ? { outcome: 'invalid', remaining } : { outcome: 'exhausted' }
      }

      const row = await byFlowId(handle, flows, flowId)
      if (row && sameHash(row.secretHash, secretHash) && row.challengeAttempts >= data.maxAttempts) {
        return { outcome: 'exhausted' }
      }
      return { outcome: 'expired' }
    },

    async bindExternal(ctx: DataHandle, flowId: string, data) {
      const { handle, flows } = flowsOf(ctx, 'bindExternal')
      const set: Record<string, unknown> = { external: await encrypt(JSON.stringify(data.external ?? {})) }
      if (data.state !== undefined) set.stateHash = data.state === null ? null : hashSecret(String(data.state))
      const rows = await handle.db
        .update(flows)
        .set(set)
        .where(and(eq(col(flows, 'flowId'), String(flowId) as never), gt(col(flows, 'expiresAt'), new Date() as never)))
        .returning()
      return rows.length > 0
    },

    /** Written once, and `state` is spent with it: a second return with the same `state` finds nothing. */
    async recordExternalResult(ctx: DataHandle, flowId: string, result: ExternalAuthResult) {
      const { handle, flows } = flowsOf(ctx, 'recordExternalResult')
      const rows = await handle.db
        .update(flows)
        .set({ externalResult: result, stateHash: null })
        .where(
          and(
            eq(col(flows, 'flowId'), String(flowId) as never),
            gt(col(flows, 'expiresAt'), new Date() as never),
            isNull(col(flows, 'externalResult'))
          )
        )
        .returning()
      return rows.length > 0
    },

    async completeFlow(ctx: DataHandle, flowId: string) {
      return await retire(ctx, 'completeFlow', flowId)
    },

    async cancelFlow(ctx: DataHandle, flowId: string) {
      return await retire(ctx, 'cancelFlow', flowId)
    },

    /** Expired rows whose sends have left the longest per-subject window. One statement. */
    async purgeExpired(ctx: DataHandle, before?: Date | string) {
      const { handle, flows } = flowsOf(ctx, 'purgeExpired')
      const cutoff = before ? new Date(before as never) : new Date()
      const counted = new Date(cutoff.getTime() - sendWindowSeconds * 1000)
      const rows = await handle.db
        .delete(flows)
        .where(
          and(
            lte(col(flows, 'expiresAt'), cutoff as never),
            or(isNull(col(flows, 'lastSentAt')), lte(col(flows, 'lastSentAt'), counted as never))
          )
        )
        .returning({ id: col(flows, 'id') })
      return rows.length
    }
  }

  async function retire(ctx: unknown, what: string, flowId: string): Promise<boolean> {
    const { handle, flows } = flowsOf(ctx, what)
    const rows = await handle.db
      .update(flows)
      .set(retirement(flows, new Date()))
      .where(and(eq(col(flows, 'flowId'), String(flowId) as never), ne(col(flows, 'secretHash'), RETIRED as never)))
      .returning({ id: col(flows, 'id') })
    return rows.length > 0
  }
}
