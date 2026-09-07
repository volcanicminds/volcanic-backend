/* eslint-disable @typescript-eslint/no-explicit-any */
import dayjs from 'dayjs'
import type { FastifyRequest, FastifyReply } from '../../types/global.js'
import { dataContext } from './tenancy.js'

//
// The audit trail, and what happens when it cannot be written (T-3.5).
//
// Defect D-05, in full: in multi-tenant the tracker called the manager with no context, the
// manager refused, the tracker caught the exception into a log line, and the request went on
// to answer 200. The audit trail was empty and nothing said so. Three separate mistakes, and
// the third is the one that mattered: a system that promises an audit trail and silently does
// not keep one is worse than one that fails visibly.
//
// So, in order:
//
//   1. the tracker passes `dataContext(req)`, so the change lands inside the tenant's own
//      container, next to the row it describes;
//   2. a tracking failure FAILS THE REQUEST, with `TRACKING_FAILED` and a 500. That is the
//      default and it is deliberate;
//   3. a route that considers tracking accessory declares `tracking: { strict: false }`, and
//      then the failure is logged and the response proceeds.
//
// One consequence, stated rather than hidden: the change is written after the handler has
// already written its own row, and the two are not in one transaction. Strict mode therefore
// answers 500 on a request whose data change DID happen. Making them atomic means running
// the handler inside the tracker's transaction, which is a different design and not this
// task; until then, a visible inconsistency beats an invisible one.
//
export class TrackingError extends Error {
  readonly statusCode = 500
  readonly error = 'Internal Server Error'
  readonly code = 'TRACKING_FAILED'
  constructor(what: string, cause: unknown) {
    super(`Tracking changes: ${what} failed, and this route tracks in strict mode`)
    this.name = 'TrackingError'
    this.cause = cause
  }
}

/**
 * Reads the row as it stands before the handler touches it, so the diff has a baseline.
 *
 * The framework can only do this for tables it knows. A consumer's own entity is not
 * registered anywhere in v5 (`global.entity` is gone), so for those the consumer sets
 * `req.trackingData` in a hook of its own; when nobody does, the change is still recorded,
 * with the previous values simply absent rather than invented.
 */
export async function initialize(req: FastifyRequest, _reply: FastifyReply) {
  const tc = getTrackingConfigIfEnabled(req)
  if (!tc || !req.server['trackingManager']?.isImplemented()) return
  if (req.trackingData !== undefined) return // the consumer already supplied the baseline

  const allData = { ...req.parameters(), ...req.data() }
  if (!allData || !tc.entity || !tc.primaryKey || !(tc.primaryKey in allData)) return

  try {
    const key = allData[tc.primaryKey]
    req.trackingData = await req.server['trackingManager'].retrieveBy(dataContext(req), tc.entity, key)
    if (log.t) log.trace(`Tracking changes: baseline for ${tc.entity} ${key} ${req.trackingData ? 'loaded' : 'not available'}`)
  } catch (error) {
    onFailure(req, tc, 'reading the previous state', error)
  }
}

export async function track(req: FastifyRequest, reply: FastifyReply, payload: any) {
  const tc = getTrackingConfigIfEnabled(req)
  if (!tc || !req.server['trackingManager']?.isImplemented()) return

  // A request that did not succeed changed nothing worth recording. v4 reached this point
  // on error responses too and got out of it by failing to find a primary key.
  if (reply.statusCode >= 400) return

  try {
    const { entity } = tc
    const oldData = req.trackingData
    const status =
      req.method?.toUpperCase() === 'POST' ? 'create' : req.method?.toUpperCase() === 'DELETE' ? 'delete' : 'update'

    const id =
      tc.primaryKey && payload && tc.primaryKey in payload
        ? payload[tc.primaryKey]
        : tc.primaryKey && oldData && tc.primaryKey in oldData
          ? oldData[tc.primaryKey]
          : undefined

    if (!id) {
      // Not a tracking failure: the response carries no identifier, so there is nothing to
      // attach a change to. It stays a log line even in strict mode.
      if (log.w) log.warn(`Tracking changes: no ${tc.primaryKey} in the response of ${req.method} ${req.url}`)
      return
    }

    const contents: any[] = []
    let addChange = false

    if (status === 'delete') {
      addChange = true
    } else {
      const fields = tc.fields?.includes || Object.keys(payload || {}) || []
      // The primary key identifies the row, it is not one of its changes. With a baseline
      // it filtered itself out because old and new matched; without one it would be
      // recorded as if the row had just acquired its own id.
      const excludes: string[] = [...(tc.fields?.excludes || []), ...(tc.primaryKey ? [tc.primaryKey] : [])]

      fields.forEach((field) => {
        if (excludes.includes(field)) return
        const newValue = payload != null && field in payload ? payload[field] : undefined
        if (newValue === undefined) return

        // No baseline: the entry records what the field became and omits `old` entirely,
        // so a reader can tell "the previous value was not captured" from "it was empty".
        if (oldData == null) {
          contents.push({ key: field, new: newValue })
          addChange = true
          return
        }

        const oldValue = field in oldData ? oldData[field] : undefined
        if (isFieldChanged(oldValue, newValue)) {
          contents.push({ key: field, old: oldValue, new: newValue })
          addChange = true
        }
      })
    }

    if (!addChange) return

    if (log.t) log.trace(`Tracking changes: add change for ${entity}, ${id}, ${status}`)
    await req.server['trackingManager'].addChange(dataContext(req), {
      entityName: entity,
      entityId: id,
      status,
      userId: req.user?.getId() ?? null,
      tokenId: req.token?.getId?.() ?? null,
      // Which impersonation session wrote this, when one did (T-4.2). Without it the trail
      // would say a tenant user made the change, which is true of the credential and false
      // of the person.
      impersonationId: req.impersonation?.id ?? null,
      contents
    })
  } catch (error) {
    onFailure(req, tc, 'writing the change', error)
  }
}

/**
 * Strict is the default, and it is the whole point of the task: the failure is either
 * visible in the response or it is a lie of omission.
 */
function onFailure(req: FastifyRequest, tc: any, what: string, error: unknown): void {
  if (log.e) {
    log.error(`Tracking changes: ${what} failed on ${tc.code}`)
    log.error(error)
  }
  if (isStrict(req)) throw new TrackingError(what, error)
}

/** Route declaration wins, then the deployment default in `config/tracking.ts`, then strict. */
export function isStrict(req: FastifyRequest): boolean {
  const onRoute = (req.routeOptions?.config as any)?.tracking?.strict
  if (typeof onRoute === 'boolean') return onRoute

  const deployment = (global as any).trackingConfig?.strict
  if (typeof deployment === 'boolean') return deployment

  return true
}

function getTrackingConfigIfEnabled(req) {
  try {
    const code = `${req.method?.toUpperCase()}::${req.routeOptions?.config?.url || req.routeConfig?.url || req.url}`
    return code in global.tracking && global.tracking[code].enable ? { code, ...global.tracking[code] } : null
  } catch (error) {
    if (log.e) log.error(error)
    return null
  }
}

export function isFieldChanged(oldValue, newValue) {
  if ((oldValue instanceof Date || newValue instanceof Date) && oldValue != null && newValue != undefined) {
    return !dayjs(oldValue).isSame(dayjs(newValue))
  }

  if ((oldValue instanceof Object || newValue instanceof Object) && oldValue != null && newValue != undefined) {
    const primaryKey = global.trackingConfig?.primaryKey
    // Guard the `in` operator with an object check: `'id' in 'someString'` throws
    // on a string primitive, so reach the string fallback instead of crashing.
    const oldId =
      oldValue != null && typeof oldValue === 'object' && primaryKey in oldValue
        ? oldValue[primaryKey]
        : typeof oldValue === 'string'
          ? oldValue
          : undefined
    const newId =
      newValue != null && typeof newValue === 'object' && primaryKey in newValue
        ? newValue[primaryKey]
        : typeof newValue === 'string'
          ? newValue
          : undefined
    return oldId !== undefined && newId !== undefined ? oldId != newId : false
  }

  return oldValue != newValue
}
