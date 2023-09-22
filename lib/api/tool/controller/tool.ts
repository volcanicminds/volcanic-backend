import { FastifyReply, FastifyRequest } from 'fastify'

export async function synchronizeSchemas(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['dataBaseManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  reply.send({ ok: true })

  log.warn('Database schema synchronization started')
  await req.server['dataBaseManager'].synchronizeSchemas()
  log.warn('Database schema synchronization finished')
}
