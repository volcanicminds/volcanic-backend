import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, GovernanceLogManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'

//
// The governance log of the platform (F76): what the operators did to the registry, the operators
// and the providers, read with Magic Query (`tenantId=`, `action=`, `actorId=`, `occurredAt:gte=`).
//
const manager = (req: FastifyRequest): GovernanceLogManagement => req.server.governanceLogManager

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (manager(req)?.isImplemented?.() && req.control) return false
  reply.status(404).send(httpError(404, 'This build keeps no governance log', 'NOT_FOUND'))
  return true
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const { headers, records } = await manager(req).findQuery(req.control as ControlHandle, req.data())
  return reply.type('application/json').headers({ ...headers }).send(records)
}

export async function count(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  return reply.send(await manager(req).countQuery(req.control as ControlHandle, req.data()))
}
