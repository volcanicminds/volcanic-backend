import { FastifyReply, FastifyRequest } from 'fastify'
import { exportPackage, sendPackage } from '../../../util/tenantExport.js'

//
// The tenant plane's way into lib/util/tenantExport.ts. The tenant is the one the request was
// authenticated in (`req.tenant`), never a parameter: a route that took it from the path would
// let one tenant's admin read another's data.
//

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const tenantId = req.tenant?.tenantId
  if (!tenantId) return reply.status(404).send()
  // Always `client`: the operator's envelope, with the registry row, is not the tenant's to take.
  return await exportPackage(req, reply, { tenantId, profile: 'client', slot: 'tenant' })
}

export async function download(req: FastifyRequest, reply: FastifyReply) {
  const tenantId = req.tenant?.tenantId
  if (!tenantId) return reply.status(404).send()
  const { package: name } = req.parameters()
  return await sendPackage(req, reply, { tenantId, name, operator: false })
}
