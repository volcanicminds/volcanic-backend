import type { FastifyRequest } from 'fastify'
import type { AccessLogEntry, DataHandle } from '../../types/global.js'

//
// The one writer of the access log (F44). Block J adds its configuration, its routes and its
// purge; the rule that matters is already here: a write never fails a login. The insert is awaited
// on the handle of the request, because the tenant's handle is given back when the response ends
// and a write fired after it would run on a handle somebody else holds.
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
  }
}
