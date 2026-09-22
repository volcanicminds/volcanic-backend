import type { FastifyRequest } from 'fastify'
import type { AccessLogEntry, DataHandle } from '../../types/global.js'
import { dataContext } from './tenancy.js'

//
// The one writer of the access log (F44). The rule that matters: a write never fails the request
// it describes. The insert is awaited on the handle of the request, because the tenant's handle is
// given back when the response ends and a write fired after it would run on a handle somebody else
// holds. The process log line is written whatever happens to the row, so an access is never lost
// to a broken table without a trace.
//
// The handle is the caller's choice and not this function's: the flow engine and the platform
// routes pass `req.control`, the tenant routes pass `dataContext(req)`, and `scope` on the entry
// says which plane the row belongs to where both live in one container.
//
export async function recordAccess(req: FastifyRequest, handle: DataHandle | null | undefined, entry: AccessLogEntry): Promise<void> {
  const row: AccessLogEntry = { ...entry, ip: entry.ip ?? req.ip ?? null }
  if (log.i) {
    const subject = row.subjectId ? ` subject ${row.subjectId}` : ''
    log.info(`Access ${row.scope} ${row.event} ${row.outcome}${row.code ? ` ${row.code}` : ''}${subject}`)
  }

  const manager = req.server.accessLogManager
  if (!handle || !manager?.isImplemented?.()) return
  try {
    await manager.record(handle, row)
  } catch (error) {
    if (log.w) log.warn(`Access log: ${row.event} not written (${(error as Error)?.message})`)
    return
  }

  // Housekeeping on one write in fifty, like the sessions (T-12.33): a deployment that never runs
  // `npx volcanic access-log --purge` must not grow the table for ever. Same handle, same reason
  // it is awaited.
  if (Math.random() < 0.02) {
    try {
      const removed = await manager.purgeExpired(handle)
      if (removed && log.d) log.debug(`Access log: ${removed} rows past retention purged`)
    } catch (error) {
      if (log.w) log.warn(`Access log: the opportunistic purge failed (${(error as Error)?.message})`)
    }
  }
}

type PlaneEntry = Omit<AccessLogEntry, 'scope'>

/** A tenant-plane access, written in the container of the request (the control one without tenants). */
export function recordTenantAccess(req: FastifyRequest, entry: PlaneEntry): Promise<void> {
  let handle: DataHandle | null
  try {
    handle = dataContext(req)
  } catch {
    // No container on this request: the process log still gets its line.
    handle = null
  }
  return recordAccess(req, handle, { ...entry, scope: 'tenant' })
}

/** A platform access, written in the control plane and nowhere else. */
export function recordControlAccess(req: FastifyRequest, entry: PlaneEntry): Promise<void> {
  return recordAccess(req, (req.control as DataHandle | undefined) ?? null, { ...entry, scope: 'control' })
}
