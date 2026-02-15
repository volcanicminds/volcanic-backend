import { FastifyReply, FastifyRequest } from 'fastify'

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const tenants = await tm.listTenants()
  return reply.send(tenants)
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const data = req.data()
  // Provisioning is handled by the manager implementation
  await tm.createTenant(data)

  // Return created (or just success if createTenant doesn't return the object)
  return reply.code(201).send({ message: 'Tenant created', ...data })
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  const tenant = await tm.getTenant(id)
  if (!tenant) return reply.status(404).send()
  return reply.send(tenant)
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  const data = req.data()
  const tenant = await tm.updateTenant(id, data)
  if (!tenant) return reply.status(404).send()
  return reply.send(tenant)
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  await tm.deleteTenant(id)
  return reply.send({ message: 'Tenant archived/deleted', id })
}

export async function restore(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  const tenant = await tm.restoreTenant(id)
  return reply.send({ message: 'Tenant restored', tenant })
}
