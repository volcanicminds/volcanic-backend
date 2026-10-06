import type {
  ControlHandle,
  GovernanceAction,
  GovernanceLogManagement,
  GovernanceLogRecord,
  GovernanceOutcome,
  VQuery
} from '../../../types/global.js'
import { executeCount, executeFind } from '../query/index.js'
import { truncateIp, type AccessLogIpMode } from './accessLog.js'
import { control, inTransaction, table } from './runtime.js'

//
// The governance log (F76). One table in the control plane, next to the registry it describes, so
// a row outlives the tenant, the operator and the provider it names; the framework never purges it.
//
// The manager is the last line for what a row may hold, as the access log's is: an action or an
// outcome outside the closed vocabulary is refused, and the address is truncated here (/24, /48)
// or dropped with `ACCESS_LOG_IP=none`, the one address policy of both logs.
//
const NAME = 'governanceLogManager'

// A record and not an array: the compiler refuses a missing or an extra action.
const ACTIONS: Record<GovernanceAction, true> = {
  'tenant.created': true,
  'tenant.updated': true,
  'tenant.suspended': true,
  'tenant.restored': true,
  'tenant.deleted': true,
  'tenant.exported': true,
  'tenant.destruction_requested': true,
  'tenant.destroyed': true,
  'impersonation.started': true,
  'impersonation.ended': true,
  'system_user.created': true,
  'system_user.updated': true,
  'system_user.deleted': true,
  'system_user.blocked': true,
  'system_user.unblocked': true,
  'system_user.mfa_reset': true,
  'identity_provider.created': true,
  'identity_provider.updated': true,
  'identity_provider.deleted': true,
  'account_creation.changed': true,
  'account_creation.reset': true
}

const OUTCOMES: Record<GovernanceOutcome, true> = { success: true, intent: true, failure: true }

export interface GovernanceLogOptions {
  /** The `ip` of the `accessLog` block: the environment's `ACCESS_LOG_IP` wins over it. */
  ip?: AccessLogIpMode
}

const invalid = (message: string) => Object.assign(new Error(message), { code: 'GOVERNANCE_LOG_ENTRY_INVALID' })

export function createGovernanceLogManager(options: GovernanceLogOptions = {}): GovernanceLogManagement {
  const entries = (ctx: unknown, what: string) => {
    const handle = control(ctx, `${NAME}.${what}`)
    return { handle, log: table(handle, 'governanceLog') }
  }
  const ipMode = (): AccessLogIpMode => ((process.env.ACCESS_LOG_IP || options.ip) === 'none' ? 'none' : 'truncate')

  return {
    isImplemented: () => true,

    async record(ctx: ControlHandle, entry) {
      const { handle, log } = entries(ctx, 'record')
      if (!Object.hasOwn(ACTIONS, String(entry?.action))) {
        throw Object.assign(new Error(`'${String(entry?.action)}' is not a governance action`), {
          code: 'GOVERNANCE_ACTION_UNKNOWN'
        })
      }
      if (!Object.hasOwn(OUTCOMES, String(entry.outcome))) {
        throw invalid('a governance entry needs an outcome: success, intent or failure')
      }
      if (entry.outcome === 'intent' && entry.intentId) throw invalid('an intent does not close another intent')
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
      return await inTransaction(control(ctx, `${NAME}.within`), `${NAME}.within`, (bound) =>
        change(bound as unknown as ControlHandle)
      )
    },

    async findQuery(ctx: ControlHandle, query: VQuery) {
      const { handle, log } = entries(ctx, 'findQuery')
      return (await executeFind(handle, log, query as never)) as never
    },

    async countQuery(ctx: ControlHandle, query: VQuery) {
      const { handle, log } = entries(ctx, 'countQuery')
      return await executeCount(handle, log, query as never)
    }
  }
}
