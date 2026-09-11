import { FastifyReply, FastifyRequest } from 'fastify'

// A middleware file is named after WHEN it runs around the route (`postAuth`: after an auth
// route has answered) and exports functions named after the Fastify hook they become: the
// router groups every middleware of a route by export name (lib/loader/router.ts). So this is
// `preSerialization` on purpose. A consumer overrides it with `src/middleware/postAuth.ts`.
export async function preSerialization(_req: FastifyRequest, _res: FastifyReply, payload: unknown) {
  return payload
}
