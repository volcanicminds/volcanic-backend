import type { FastifyRequest } from 'fastify'
import type { ControlHandle, GovernanceLogEntry, GovernanceLogManagement } from '../../types/global.js'

//
// The one writer of the governance log (F76), with the opposite rule of the access log's: a change
// to the platform that cannot be written down is not made.
//
// A change of the registry and its event share one control-plane transaction (`governed`): an
// event that cannot be written rolls the change back. An effect no transaction reaches, an export
// or the drop of a container, writes its intent first (`intend`), and does not start when that
// row cannot be written; its outcome follows (`settle`), or rides the transaction of the registry
// change that closes it (`governed` with `intentId`). An outcome that cannot be written does not
// undo an effect that already happened: the intent stays without one, which is what an auditor
// reads as "may have happened", and the process log has the line.
//
// The operator, the address and the request id come from the request, never from the route.
//

/** What a route says about its event. */
export type GovernanceEvent = Omit<GovernanceLogEntry, 'outcome' | 'intentId' | 'actorId' | 'ip' | 'requestId'>

const manager = (req: FastifyRequest): GovernanceLogManagement => req.server.governanceLogManager

/** Throws the 503 every governance write answers with when this build keeps no governance log. */
export function assertGovernanceLog(req: FastifyRequest): { manager: GovernanceLogManagement; ctx: ControlHandle } {
  const found = manager(req)
  if (!found?.isImplemented?.() || !req.control) {
    throw Object.assign(new Error('This build keeps no governance log, and no change to the platform is made without one'), {
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'GOVERNANCE_LOG_NOT_AVAILABLE'
    })
  }
  return { manager: found, ctx: req.control as ControlHandle }
}

const entryOf = (
  req: FastifyRequest,
  event: GovernanceEvent,
  outcome: GovernanceLogEntry['outcome'],
  intentId?: string
): GovernanceLogEntry => ({
  ...event,
  outcome,
  intentId: intentId ?? null,
  actorId: req.systemUser?.id ?? null,
  ip: req.ip ?? null,
  requestId: req.id ? String(req.id) : null
})

const said = (req: FastifyRequest, event: GovernanceEvent, outcome: string) => {
  if (!log.i) return
  const on = event.tenantId ? ` tenant ${event.tenantId}` : ''
  const target = event.targetId ? ` target ${event.targetId}` : ''
  log.info(`Governance ${event.action} ${outcome}${on}${target} by ${req.systemUser?.id ?? 'nobody'}`)
}

/**
 * Runs a change of the registry and writes its event in the same transaction. `change` must make
 * every call through `tx`. `event` reads the change's result and answers null when nothing changed,
 * and then nothing is written. With `intentId` the event is the success of that intent.
 */
export async function governed<T>(
  req: FastifyRequest,
  change: (tx: ControlHandle) => Promise<T>,
  event: (result: T) => GovernanceEvent | null,
  options: { intentId?: string } = {}
): Promise<T> {
  const { manager: governance, ctx } = assertGovernanceLog(req)
  // Cast and not annotated: an annotated `null` stays narrowed to null past the callback that assigns it.
  let written = null as GovernanceEvent | null
  const result = await governance.within(ctx, async (tx) => {
    const changed = await change(tx)
    written = event(changed)
    if (written) await governance.record(tx, entryOf(req, written, 'success', options.intentId))
    return changed
  })
  if (written) said(req, written, 'success')
  return result
}

/** The intent of an effect no transaction reaches. It throws, and the effect must not start, when the row is not written. */
export async function intend(req: FastifyRequest, event: GovernanceEvent): Promise<string> {
  const { manager: governance, ctx } = assertGovernanceLog(req)
  const row = await governance.record(ctx, entryOf(req, event, 'intent'))
  said(req, event, 'intent')
  return row.id
}

/** The outcome of an intent, once the effect is over. Never throws: the effect already happened. */
export async function settle(
  req: FastifyRequest,
  intentId: string,
  outcome: 'success' | 'failure',
  event: GovernanceEvent
): Promise<void> {
  try {
    await manager(req).record(req.control as ControlHandle, entryOf(req, event, outcome, intentId))
    said(req, event, outcome)
  } catch (error) {
    if (log.e) {
      log.error(`Governance log: the ${outcome} of ${event.action} (intent ${intentId}) not written (${(error as Error)?.message})`)
    }
  }
}

/** The names a patch carries, one level into `config`: what an auditor filters on, never a value. */
export function fieldNames(patch: Record<string, unknown> | null | undefined): string[] {
  const names: string[] = []
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === undefined) continue
    if (key === 'config' && value && typeof value === 'object' && !Array.isArray(value)) {
      const inner = Object.keys(value as Record<string, unknown>)
      names.push(...(inner.length ? inner.map((name) => `config.${name}`) : ['config']))
    } else names.push(key)
  }
  return names.sort()
}

/** A failure as the log keeps it: a code or an error class, never a message that may quote a connection string. */
export const failureOf = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'string' && code ? code : ((error as Error)?.name ?? 'Error')
}
