import { FastifyReply, FastifyRequest } from 'fastify'
import type { ExternalIdentityManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import { dataContext } from '../../../util/tenancy.js'
import { recordTenantAccess } from '../../../util/accessLog.js'

//
// The caller's own external identities (T-12.27): seen and removed, never added. Adding one from a
// logged-in session needs a fresh re-authentication first, and that is deferred past 5.0 (F48).
//
const links = (req: FastifyRequest): ExternalIdentityManagement => req.server['externalIdentityManager']

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (links(req)?.isImplemented?.()) return false
  reply.status(404).send(httpError(404, 'This build keeps no external identities', 'NOT_FOUND'))
  return true
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  if (!req.user?.externalId) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  return reply.send(await links(req).listOfSubject(dataContext(req), req.user.externalId, 'tenant'))
}

/** Somebody else's link answers the same 404 as one that does not exist, as a session does. */
export async function remove(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  if (!req.user?.externalId) return reply.status(401).send(httpError(401, 'Unauthorized', 'UNAUTHORIZED'))
  const { id } = req.params as { id: string }
  const mine = await links(req).listOfSubject(dataContext(req), req.user.externalId, 'tenant')
  const link = mine.find((row) => row.id === id)
  if (!link || !(await links(req).removeLink(dataContext(req), id, req.user.externalId))) {
    return reply.status(404).send(httpError(404, 'Not found', 'NOT_FOUND'))
  }
  await recordTenantAccess(req, { event: 'idp.unlinked', outcome: 'success', subjectId: req.user.externalId, provider: link.provider })
  return reply.send({ ok: true })
}
