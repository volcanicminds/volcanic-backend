import { FastifyReply, FastifyRequest } from 'fastify'

export async function synchronizeSchemas(req: FastifyRequest, reply: FastifyReply) {
  const { multi_tenant } = global.config?.options || {}
  if (multi_tenant?.enabled) {
    throw new Error('Schema synchronization is not supported in multi-tenant mode.')
  }

  if (!req.server['dataBaseManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  reply.send({ ok: true })

  log.warn('Database schema synchronization started')
  await req.server['dataBaseManager'].synchronizeSchemas()
  log.warn('Database schema synchronization finished')
}
