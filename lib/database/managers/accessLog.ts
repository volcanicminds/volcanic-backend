import { lte } from 'drizzle-orm'
import { isIP } from 'net'
import type { AccessEvent, AccessLogManagement, AccessLogRecord, DataHandle, VQuery } from '../../../types/global.js'
import { executeCount, executeFind } from '../query/index.js'
import { runtime, table, column } from './runtime.js'

//
// The access log (F44). One table per container, like `session`: a tenant's accesses leave with
// its container, and `scope` tells platform identities from tenant users where both live.
//
// The manager is the last line for what a row may hold: an event outside the closed vocabulary is
// refused, and the address is truncated here (/24, /48) or dropped with `ACCESS_LOG_IP=none`,
// whatever the caller passed. A truncated address cannot be reversed and needs no key; a hash of
// an IPv4, keyed or not, is undone by trying the 2^32 addresses.
//
const NAME = 'accessLogManager'

// A record and not an array: the compiler refuses a missing or an extra event.
const EVENTS: Record<AccessEvent, true> = {
  'login.succeeded': true,
  'login.failed': true,
  'flow.started': true,
  'stage.passed': true,
  'stage.failed': true,
  'challenge.sent': true,
  'challenge.refused': true,
  'flow.expired': true,
  'flow.exhausted': true,
  'idp.linked': true,
  'idp.unlinked': true,
  'idp.provisioned': true,
  'idp.rejected': true,
  'mfa.enrolled': true,
  'mfa.disabled': true,
  logout: true,
  'session.revoked': true,
  'session.reuse_detected': true,
  'tokens.invalidated': true
}

export type AccessLogIpMode = 'truncate' | 'none'

/** The eight groups of an IPv6 address, zero-padded; null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let value = address
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(value)
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number)
    value = value.slice(0, -dotted[1].length) + `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const [head, tail] = value.split('::')
  const parse = (part: string | undefined) => (part ? part.split(':').map((g) => parseInt(g, 16)) : [])
  const front = parse(head)
  const back = parse(tail)
  const groups = tail === undefined ? front : [...front, ...new Array(8 - front.length - back.length).fill(0), ...back]
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/**
 * IPv4 to its /24, IPv6 to its /48; an IPv4-mapped IPv6 is treated as the IPv4 it carries. Anything
 * that does not parse as an address is dropped rather than stored as it came.
 */
export function truncateIp(ip: string | null | undefined, mode: AccessLogIpMode = 'truncate'): string | null {
  if (mode === 'none' || !ip) return null
  let value = String(ip).trim()
  const zone = value.indexOf('%')
  if (zone >= 0) value = value.slice(0, zone)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value)
  if (mapped) value = mapped[1]

  const family = isIP(value)
  if (family === 4) {
    const [a, b, c] = value.split('.')
    return `${a}.${b}.${c}.0`
  }
  if (family === 6) {
    const groups = ipv6Groups(value)
    return groups ? `${groups.slice(0, 3).map((g) => g.toString(16)).join(':')}::` : null
  }
  return null
}

export function createAccessLogManager(options: { ip?: AccessLogIpMode } = {}): AccessLogManagement {
  const entries = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, log: table(handle, 'accessLog') }
  }
  // Read at every write, so the environment set after the data layer started still counts.
  const ipMode = (): AccessLogIpMode => options.ip ?? (process.env.ACCESS_LOG_IP === 'none' ? 'none' : 'truncate')

  return {
    isImplemented: () => true,

    async record(ctx: DataHandle, entry) {
      const { handle, log } = entries(ctx, 'record')
      if (!Object.hasOwn(EVENTS, String(entry?.event))) {
        throw Object.assign(new Error(`'${String(entry?.event)}' is not an access event`), { code: 'ACCESS_EVENT_UNKNOWN' })
      }
      if (!['success', 'failure'].includes(entry.outcome) || !['tenant', 'control'].includes(entry.scope)) {
        throw Object.assign(new Error('an access log entry needs an outcome (success, failure) and a scope (tenant, control)'), {
          code: 'ACCESS_LOG_ENTRY_INVALID'
        })
      }
      const rows = await handle.db
        .insert(log)
        .values({
          scope: entry.scope,
          event: entry.event,
          outcome: entry.outcome,
          code: entry.code ?? null,
          subjectId: entry.subjectId ?? null,
          methods: entry.methods ? [...entry.methods].map(String) : null,
          provider: entry.provider ?? null,
          flowId: entry.flowId ?? null,
          sid: entry.sid ?? null,
          ip: truncateIp(entry.ip, ipMode())
        })
        .returning()
      return rows[0] as AccessLogRecord
    },

    async findQuery(ctx: DataHandle, query: VQuery) {
      const { handle, log } = entries(ctx, 'findQuery')
      return (await executeFind(handle, log, query as never, { dialect: handle.dialect })) as never
    },

    async countQuery(ctx: DataHandle, query: VQuery) {
      const { handle, log } = entries(ctx, 'countQuery')
      return await executeCount(handle, log, query as never, { dialect: handle.dialect })
    },

    /** One statement on the indexed `occurred_at`, like the purge of sessions. */
    async purgeBefore(ctx: DataHandle, before: Date | string) {
      const { handle, log } = entries(ctx, 'purgeBefore')
      const rows = await handle.db
        .delete(log)
        .where(lte(column(log, 'occurredAt'), new Date(before as never) as never))
        .returning({ id: column(log, 'id') })
      return rows.length
    }
  }
}
