import { FastifyReply, FastifyRequest } from 'fastify'
import { generateManifest } from '../../../manifest/generator.js'

// GET /admin/manifest — full Manifest v2 (declared roles). Gating is enforced by the
// route (roles:[admin] + isAuthenticated); the manifest itself is not per-user.
export function get(req: FastifyRequest, reply: FastifyReply) {
  const server = (req.server as any) || global.server
  return reply.send(generateManifest(server))
}
