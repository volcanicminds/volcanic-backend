import { FastifyReply, FastifyRequest } from 'fastify'
import type { AccessLogManagement, DataHandle } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'

//
// The access log of the platform (T-12.32): the operators' own accesses, in the control plane.
// A tenant's accesses are not here and cannot be reached from here; reading them means entering
// the tenant with an impersonation, which leaves its own record (F44, F19).
//
const manager = (req: FastifyRequest): AccessLogManagement => req.server.accessLogManager

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (manager(req)?.isImplemented?.() && req.control) return false
  reply.status(404).send(httpError(404, 'This build keeps no access log', 'NOT_FOUND'))
  return true
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const { headers, records } = await manager(req).findQuery(req.control as DataHandle, req.data(), 'control')
  return reply.type('application/json').headers({ ...headers }).send(records)
}

export async function count(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  return reply.send(await manager(req).countQuery(req.control as DataHandle, req.data(), 'control'))
}
