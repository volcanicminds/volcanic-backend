/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The session-state guard (T-3.1, point 3: "no `SET search_path` outside a transaction,
// anywhere in the data layer").
//
// The rule is enforced twice on purpose, at two different costs:
//
//   - `scripts/check-session-state.mjs` greps the sources in CI, so the statement cannot be
//     written by hand;
//   - this file watches the wire, so it cannot be *emitted* either: not by a helper, not
//     by a consumer's raw SQL, not by a future migration path that forgets the rule.
//
// A grep alone would be a coding convention. Watching the driver makes it a property of the
// running system, which is what invariant 1 asks for: the framework imposes the isolation,
// it does not ask the caller to remember.
//
// Why the transaction is the exception and not a loophole: `SET LOCAL` is undone by the
// commit or the rollback, by definition of the statement. There is no path where it
// survives into the pool, which is exactly what D-01 was.
//
// Every spelling, including `SET LOCAL`: outside a transaction that one is a silent no-op
// in Postgres, and a statement that does nothing is a belief about the code that is wrong.
const SESSION_SEARCH_PATH = /(?:^|[\s;(])set\s+(?:session\s+|local\s+)?search_path\b/i
const LOCAL_SEARCH_PATH = /(?:^|[\s;(])set\s+local\s+search_path\b/i
const BEGIN = /^\s*(?:begin|start\s+transaction)\b/i
const END = /^\s*(?:commit|rollback)\s*;?\s*$/i

/** Thrown before the statement reaches the connection: the guard fails closed. */
export class SessionStateError extends Error {
  readonly code = 'DB_SESSION_STATE_FORBIDDEN'
  constructor(text: string) {
    super(
      `Refused a statement that would leave state on the pooled connection: ${text.trim().slice(0, 120)}. ` +
        'A container is chosen by qualifying the tables (T-3.1); when raw SQL genuinely needs a ' +
        'search_path, run it inside a transaction with SET LOCAL.'
    )
    this.name = 'SessionStateError'
  }
}

/** The text of a `pg` query, in any of the shapes the driver accepts. Unknown shapes read as ''. */
export function queryTextOf(config: unknown): string {
  if (typeof config === 'string') return config
  const text = (config as { text?: unknown })?.text
  return typeof text === 'string' ? text : ''
}

/**
 * The rule itself, exported so a test can state it without a database.
 * Inside a transaction `SET LOCAL` is allowed; a session-wide `SET` never is.
 */
export function assertNoSessionState(text: string, inTransaction: boolean): void {
  if (!SESSION_SEARCH_PATH.test(text)) return
  if (inTransaction && LOCAL_SEARCH_PATH.test(text)) return
  throw new SessionStateError(text)
}

const PATCHED = Symbol.for('volcanic.pg.guarded')
const DEPTH = Symbol.for('volcanic.pg.txDepth')

/**
 * Wraps a checked-out client so it knows whether it is inside a transaction.
 *
 * The depth is reset at every checkout rather than tracked across them: a connection coming
 * out of the pool has no transaction in progress, and assuming otherwise would be the same
 * mistake as assuming it has no `search_path`.
 */
function guardClient(client: any): any {
  if (!client[PATCHED]) {
    const original = client.query.bind(client)
    client[PATCHED] = true
    client.query = function (config: any, values?: any, cb?: any) {
      const text = queryTextOf(config)
      assertNoSessionState(text, (client[DEPTH] || 0) > 0)
      if (BEGIN.test(text)) client[DEPTH] = (client[DEPTH] || 0) + 1
      else if (END.test(text)) client[DEPTH] = Math.max(0, (client[DEPTH] || 0) - 1)
      return original(config, values, cb)
    }
  }
  client[DEPTH] = 0
  return client
}

/**
 * Patches a pool in place: statements issued on the pool itself are outside any transaction
 * by construction, statements issued on a checked-out client are judged by that client.
 *
 * In place, and not behind a Proxy, for one reason: drizzle decides whether to open a
 * transaction with `client instanceof Pool`, and the driver reaches for fields the pool owns.
 * Shadowing two methods keeps the object exactly what it was.
 */
export function guardPool<T extends { query: any; connect: any }>(pool: T): T {
  const anyPool = pool as any
  if (anyPool[PATCHED]) return pool
  anyPool[PATCHED] = true

  const originalQuery = pool.query.bind(pool)
  const originalConnect = pool.connect.bind(pool)

  anyPool.query = function (config: any, values?: any, cb?: any) {
    assertNoSessionState(queryTextOf(config), false)
    return originalQuery(config, values, cb)
  }

  anyPool.connect = function (cb?: any) {
    // Callback form: the driver never uses it, but a consumer might.
    if (typeof cb === 'function') return originalConnect((err: any, client: any, release: any) => cb(err, client && guardClient(client), release))
    return Promise.resolve(originalConnect()).then(guardClient)
  }

  return pool
}
