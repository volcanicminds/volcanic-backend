import type { FastifyRequest } from 'fastify'
import type { ControlHandle, DataHandle, GovernanceLogEntry, GovernanceLogManagement } from '../../types/global.js'
import { dataContext } from './tenancy.js'

//
// The one writer of the governance log, with the opposite rule of the access log's: a change
// to the platform that cannot be written down is not made.
//
// A change of the registry and its event share one control-plane transaction (`governed`): an
// event that cannot be written rolls the change back. An act on a container's own credentials is
// written the same way in that container's log, never in another (`governed` with `container`).
// An effect no transaction reaches, an export
// or the drop of a container, writes its intent first (`intend`), and does not start when that
// row cannot be written; its outcome follows (`settle`), or rides the transaction of the registry
// change that closes it (`governed` with `intentId`). An outcome that cannot be written does not
// undo an effect that already happened: the intent stays without one, which is what an auditor
// reads as "may have happened", and the process log has the line.
//
// The actor, its kind, the address and the request id come from the request, never from the route.
// A job of the framework writes as `Unattended`: nobody, from nowhere.
//

/** What a route says about its event. */
export type GovernanceEvent = Omit<GovernanceLogEntry, 'outcome' | 'intentId' | 'actorId' | 'actorKind' | 'ip' | 'requestId'>

/** A job of the framework writing for itself, with no request behind it. */
export interface Unattended {
  readonly governance: GovernanceLogManagement | undefined
  readonly ctx: DataHandle
}

type Source = FastifyRequest | Unattended
type Origin = Pick<GovernanceLogEntry, 'actorId' | 'actorKind' | 'ip' | 'requestId'>

const isUnattended = (source: Source): source is Unattended => 'governance' in source

/** An operator, a user or an integration token, whichever the request authenticated; nobody for a job. */
const originOf = (source: Source): Origin => {
  if (isUnattended(source)) return { actorId: null, actorKind: null, ip: null, requestId: null }
  const at = { ip: source.ip ?? null, requestId: source.id ? String(source.id) : null }
  if (source.systemUser?.id) return { actorId: source.systemUser.id, actorKind: 'system_user', ...at }
  if (source.user?.id) return { actorId: String(source.user.id), actorKind: 'user', ...at }
  if (source.token?.id) return { actorId: String(source.token.id), actorKind: 'token', ...at }
  return { actorId: null, actorKind: null, ...at }
}

/** The control plane of a request, or the container it names. */
const writerOf = <H extends DataHandle = ControlHandle>(
  source: Source,
  container?: H
): { manager: GovernanceLogManagement | undefined; ctx: H | undefined } =>
  isUnattended(source)
    ? { manager: source.governance, ctx: source.ctx as H }
    : { manager: source.server.governanceLogManager, ctx: container ?? (source.control as H | undefined) }

/** Throws the 503 every governance write answers with when this build keeps no governance log. */
export function assertGovernanceLog<H extends DataHandle = ControlHandle>(
  source: Source,
  container?: H
): { manager: GovernanceLogManagement; ctx: H } {
  const { manager, ctx } = writerOf(source, container)
  if (!manager?.isImplemented?.() || !ctx) {
    throw Object.assign(new Error('This build keeps no governance log, and no change to the platform is made without one'), {
      statusCode: 503,
      error: 'Service Unavailable',
      code: 'GOVERNANCE_LOG_NOT_AVAILABLE'
    })
  }
  // A token's id names a row of the container the hook found it in: in another container's log it
  // would name a row that is not there, or another token.
  if (!isUnattended(source) && source.token && ctx !== dataContext(source)) {
    throw Object.assign(new Error("An integration token is written in its own container's governance log only"), {
      code: 'GOVERNANCE_ACTOR_MISPLACED'
    })
  }
  return { manager, ctx }
}

// The impersonation an act was made under, when there is one: the actor is the user impersonated,
// and the row says who was behind it. Only a tenant route is ever impersonated.
const entryOf = (
  source: Source,
  event: GovernanceEvent,
  outcome: GovernanceLogEntry['outcome'],
  intentId?: string
): GovernanceLogEntry => {
  const impersonationId = isUnattended(source) ? undefined : source.impersonation?.id
  return {
    ...event,
    ...(impersonationId && { detail: { ...event.detail, impersonationId } }),
    outcome,
    intentId: intentId ?? null,
    ...originOf(source)
  }
}

const said = (source: Source, event: GovernanceEvent, outcome: string) => {
  if (!log.i) return
  const on = event.tenantId ? ` tenant ${event.tenantId}` : ''
  const target = event.targetId ? ` target ${event.targetId}` : ''
  const { actorId, actorKind } = originOf(source)
  log.info(`Governance ${event.action} ${outcome}${on}${target} by ${actorId ? `${actorKind} ${actorId}` : 'nobody'}`)
}

/**
 * Runs a change of the registry and writes its event in the same transaction. `change` must make
 * every call through `tx`. `event` reads the change's result and answers null when nothing changed,
 * and then nothing is written. With `intentId` the event is the success of that intent. With
 * `container` both happen in that container instead, `dataContext(req)` for an act on its tokens;
 * an `Unattended` source writes in its own `ctx`.
 */
export async function governed<T, H extends DataHandle = ControlHandle>(
  source: Source,
  change: (tx: H) => Promise<T>,
  event: (result: T) => GovernanceEvent | null,
  options: { intentId?: string; container?: H } = {}
): Promise<T> {
  const { manager: governance, ctx } = assertGovernanceLog<H>(source, options.container)
  // Cast and not annotated: an annotated `null` stays narrowed to null past the callback that assigns it.
  let written = null as GovernanceEvent | null
  const result = await governance.within(ctx, async (tx) => {
    const changed = await change(tx)
    written = event(changed)
    if (written) await governance.record(tx, entryOf(source, written, 'success', options.intentId))
    return changed
  })
  if (written) said(source, written, 'success')
  return result
}

/** The intent of an effect no transaction reaches. It throws, and the effect must not start, when the row is not written. */
export async function intend(source: Source, event: GovernanceEvent): Promise<string> {
  const { manager: governance, ctx } = assertGovernanceLog(source)
  const row = await governance.record(ctx, entryOf(source, event, 'intent'))
  said(source, event, 'intent')
  return row.id
}

/** The outcome of an intent, once the effect is over. Never throws: the effect already happened. */
export async function settle(
  source: Source,
  intentId: string,
  outcome: 'success' | 'failure',
  event: GovernanceEvent
): Promise<void> {
  try {
    const { manager: governance, ctx } = writerOf(source)
    await governance!.record(ctx!, entryOf(source, event, outcome, intentId))
    said(source, event, outcome)
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
