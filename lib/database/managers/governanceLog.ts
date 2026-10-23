import { inArray, type SQL } from 'drizzle-orm'
import type {
  DataHandle,
  GovernanceAction,
  GovernanceActorPlane,
  GovernanceLogManagement,
  GovernanceLogRecord,
  GovernanceOutcome,
  GovernanceScope,
  VQuery
} from '../../../types/global.js'
import { executeCount, executeFind } from '../query/index.js'
import { truncateIp, type AccessLogIpMode } from './accessLog.js'
import { column, inTransaction, runtime, table } from './runtime.js'

//
// The governance log, one in every container. On the control plane, next to the registry
// it describes, so a row outlives the tenant, the operator and the provider it names; in a
// tenant's container, the acts on that container's own integration tokens, which its admin reads
// and nobody else. The framework never purges it, and the database refuses to rewrite it.
//
// The manager is the last line for what a row may hold, as the access log's is: an action or an
// outcome outside the closed vocabulary is refused, a platform event is refused in a tenant's
// container, and the address is truncated here (/24, /48) or dropped with `ACCESS_LOG_IP=none`,
// the one address policy of both logs.
//
const NAME = 'governanceLogManager'

// A record and not an array: the compiler refuses a missing or an extra action. `platform` is
// written on the control plane alone, `container` in the container the act is on; without
// tenants the control plane is the only container and takes both.
const ACTIONS: Record<GovernanceAction, GovernanceScope> = {
  'tenant.created': 'platform',
  'tenant.updated': 'platform',
  'tenant.suspended': 'platform',
  'tenant.restored': 'platform',
  'tenant.deleted': 'platform',
  'tenant.exported': 'platform',
  'tenant.downloaded': 'platform',
  'tenant.export_expired': 'platform',
  'tenant.imported': 'platform',
  'tenant.moved': 'platform',
  'tenant.destruction_requested': 'platform',
  'tenant.destroyed': 'platform',
  'impersonation.started': 'platform',
  'impersonation.ended': 'platform',
  'system_user.created': 'platform',
  'system_user.updated': 'platform',
  'system_user.deleted': 'platform',
  'system_user.blocked': 'platform',
  'system_user.unblocked': 'platform',
  'system_user.mfa_reset': 'platform',
  'identity_provider.created': 'platform',
  'identity_provider.updated': 'platform',
  'identity_provider.deleted': 'platform',
  'account_creation.changed': 'platform',
  'account_creation.reset': 'platform',
  'token.created': 'container',
  'token.updated': 'container',
  'token.reissued': 'container',
  'token.blocked': 'container',
  'token.unblocked': 'container',
  'token.deleted': 'container'
}

const ofScope = (log: unknown, scope?: GovernanceScope): SQL | undefined => {
  if (!scope) return undefined
  if (scope !== 'platform' && scope !== 'container') throw invalid(`no governance scope '${String(scope)}'`)
  const actions = Object.keys(ACTIONS).filter((action) => ACTIONS[action as GovernanceAction] === scope)
  return inArray(column(log as never, 'action'), actions as never[]) as SQL
}

const OUTCOMES: Record<GovernanceOutcome, true> = { success: true, intent: true, failure: true }
const PLANES: Record<GovernanceActorPlane, true> = { control: true, tenant: true }

export interface GovernanceLogOptions {
  /** The `ip` of the `accessLog` block: the environment's `ACCESS_LOG_IP` wins over it. */
  ip?: AccessLogIpMode
}

const invalid = (message: string) => Object.assign(new Error(message), { code: 'GOVERNANCE_LOG_ENTRY_INVALID' })

export function createGovernanceLogManager(options: GovernanceLogOptions = {}): GovernanceLogManagement {
  const entries = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, log: table(handle, 'governanceLog') }
  }
  const ipMode = (): AccessLogIpMode => ((process.env.ACCESS_LOG_IP || options.ip) === 'none' ? 'none' : 'truncate')

  return {
    isImplemented: () => true,

    async record(ctx: DataHandle, entry) {
      const { handle, log } = entries(ctx, 'record')
      if (!Object.hasOwn(ACTIONS, String(entry?.action))) {
        throw Object.assign(new Error(`'${String(entry?.action)}' is not a governance action`), {
          code: 'GOVERNANCE_ACTION_UNKNOWN'
        })
      }
      // A tenant's container has no registry. An operator's act written there would leave with the
      // customer's export, and its admin would read who did what to the platform.
      if (ACTIONS[entry.action] === 'platform' && !handle.registry) {
        throw Object.assign(new Error(`'${entry.action}' is written on the control plane, never in a tenant's container`), {
          code: 'GOVERNANCE_ACTION_MISPLACED'
        })
      }
      if (!Object.hasOwn(OUTCOMES, String(entry.outcome))) {
        throw invalid('a governance entry needs an outcome: success, intent or failure')
      }
      if (entry.outcome === 'intent' && entry.intentId) throw invalid('an intent does not close another intent')
      // Without its plane an actor id names no table: one is written with the other or not at all.
      const plane = entry.actorPlane ?? null
      if (plane !== null && !Object.hasOwn(PLANES, String(plane))) throw invalid('the plane of an actor is control or tenant')
      if ((plane === null) !== (entry.actorId == null)) throw invalid('an actor is written with its plane')
      const detail = entry.detail ?? null
      if (detail !== null && (typeof detail !== 'object' || Array.isArray(detail))) {
        throw invalid('the detail of a governance entry is an object')
      }
      const rows = await handle.db
        .insert(log)
        .values({
          action: entry.action,
          outcome: entry.outcome,
          intentId: entry.intentId ?? null,
          actorId: entry.actorId ?? null,
          actorPlane: plane,
          tenantId: entry.tenantId ?? null,
          targetId: entry.targetId ?? null,
          detail,
          requestId: entry.requestId ?? null,
          ip: truncateIp(entry.ip, ipMode())
        })
        .returning()
      return rows[0] as GovernanceLogRecord
    },

    async within(ctx, change) {
      return await inTransaction(runtime(ctx, `${NAME}.within`), `${NAME}.within`, (bound) => change(bound as unknown as typeof ctx))
    },

    async findQuery(ctx: DataHandle, query: VQuery, scope?: GovernanceScope) {
      const { handle, log } = entries(ctx, 'findQuery')
      return (await executeFind(handle, log, query as never, { extraWhere: ofScope(log, scope) })) as never
    },

    async countQuery(ctx: DataHandle, query: VQuery, scope?: GovernanceScope) {
      const { handle, log } = entries(ctx, 'countQuery')
      return await executeCount(handle, log, query as never, { extraWhere: ofScope(log, scope) })
    }
  }
}
