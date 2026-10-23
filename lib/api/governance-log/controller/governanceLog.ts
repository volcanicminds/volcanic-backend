import { FastifyReply, FastifyRequest } from 'fastify'
import type { GovernanceLogManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import { dataContext } from '../../../util/tenancy.js'

const manager = (req: FastifyRequest): GovernanceLogManagement => req.server.governanceLogManager

/** Said as itself: a build without the table has no log to read, not a broken one. */
function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (manager(req)?.isImplemented?.()) return false
  reply.status(404).send(httpError(404, 'This build keeps no governance log', 'NOT_FOUND'))
  return true
}

// Only the acts on the container's own credentials: without tenants the operators' rows sit in the
// same log, and they are read at `/system/governance-log`.
export async function find(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const { headers, records } = await manager(req).findQuery(dataContext(req), req.data(), 'container')
  return reply.type('application/json').headers({ ...headers }).send(records)
}

export async function count(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  return reply.send(await manager(req).countQuery(dataContext(req), req.data(), 'container'))
}
