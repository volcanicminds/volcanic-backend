import { FastifyReply, FastifyRequest } from 'fastify'
import { generateManifest } from '../../../manifest/generator.js'

// GET /system/manifest — Manifest v2 of the platform console (T-10.14): the control routes only,
// the platform auth endpoints, and the roles of the control catalogue.
export function get(req: FastifyRequest, reply: FastifyReply) {
  const server = (req.server as any) || global.server
  return reply.send(generateManifest(server, { plane: 'control' }))
}
