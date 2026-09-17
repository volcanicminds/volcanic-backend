import { FastifyReply, FastifyRequest } from 'fastify'
import { generateManifest } from '../../../manifest/generator.js'

// GET /admin/manifest — Manifest v2 of the tenant plane (declared roles). Gating is enforced by
// the route (`manifest` capability + isAuthenticated); the manifest itself is not per-user —
// clients filter capabilities against the declared per-capability roles. With tenants declared
// the control routes are left out: they belong to `/system/manifest`.
export function get(req: FastifyRequest, reply: FastifyReply) {
  const server = (req.server as any) || global.server
  return reply.send(generateManifest(server, { plane: 'tenant' }))
}
