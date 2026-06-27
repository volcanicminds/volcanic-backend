/* eslint-disable @typescript-eslint/no-explicit-any */
// Consumer-app controller for the custom widget resource. Uses req.db (the
// request-scoped EntityManager) and the registered Widget entity.
import { FastifyReply, FastifyRequest } from 'fastify'

const repo = (req: FastifyRequest) => req.db.getRepository((global as any).entity.Widget)

export async function list(req: FastifyRequest, _reply: FastifyReply) {
  return await repo(req).find({ order: { name: 'ASC' } as any })
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const { name } = req.data()
  const r = repo(req)
  const widget = await r.findOneBy({ id } as any)
  if (!widget) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Widget not found' })
  ;(widget as any).name = name
  return await r.save(widget as any)
}

// multipart plugin: iterate the parsed parts (fields + files).
export async function upload(req: FastifyRequest, _reply: FastifyReply) {
  const out: any = {}
  for await (const part of (req as any).parts()) {
    if (part.type === 'file') {
      await part.toBuffer() // MUST drain the file stream or the iterator stalls
      out[part.fieldname] = `file:${part.filename}`
    } else {
      out[part.fieldname] = part.value
    }
  }
  return out
}

// rawBody plugin: echo the captured raw payload (e.g. for webhook signatures).
export async function webhook(req: FastifyRequest, _reply: FastifyReply) {
  const raw = (req as any).rawBody
  return { rawBody: Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw) }
}
