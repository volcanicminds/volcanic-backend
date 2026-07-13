import { FastifyReply, FastifyRequest } from 'fastify'
import { generateManifest } from '../../../manifest/generator.js'

// GET /admin/manifest — full Manifest v2 (declared roles). Gating is enforced by the
// route (`manifest` capability + isAuthenticated); the manifest itself is not per-user
// — clients filter capabilities against the declared per-capability roles.
export function get(req: FastifyRequest, reply: FastifyReply) {
  const server = (req.server as any) || global.server
  return reply.send(generateManifest(server))
}
