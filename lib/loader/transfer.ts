import type { FastifyInstance } from 'fastify'
import type { TransferManagement } from '../../types/global.js'
import { httpError } from '../util/httpError.js'
import { isAnonymous } from '../hooks/onRequest.js'

/**
 * Mounts the resumable upload endpoint (tus) at the manager's `getPath()`, when there is one.
 *
 * The route is declared public so that `onRequest` authenticates whoever carries a credential
 * and lets the rest through as anonymous; the handler then refuses an anonymous request unless
 * `isValid(req)` vouches for it (a signed link, say). Without that refusal the route would carry
 * no `requiredRoles`, and the role gate lets such a route through for anyone, credential or not.
 *
 * With tenants it is a tenant route, as the router makes every route that does not declare
 * `scope: 'control'`: the resolution opens the container the token names, where `onRequest`
 * finds the subject, and an anonymous request names its tenant as on any other route. The
 * resolution acts only on a route carrying the flag: without it the subject is looked up in no
 * container, and every upload is anonymous.
 */
export async function mountTransfer(server: FastifyInstance): Promise<void> {
  global.transferPath = null
  const tm = server['transferManager'] as TransferManagement | undefined
  if (!tm) return

  if (!tm.isImplemented()) {
    if (log.w) log.warn('Transfer Manager 📂 not available')
    return
  }
  try {
    global.transferPath = tm.getPath()
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    if (log.w) log.error(`Startup: TRANSFER MANAGER FAILED: ${message}`)
    return
  }
  if (!global.transferPath) return

  if (log.i) log.info(`Transfer Manager 📂 mounted at ${global.transferPath}`)

  await server.register(
    async (instance) => {
      // tus streams the body itself: no parser may consume it first.
      instance.addContentTypeParser('*', (_req, _payload, done) => {
        done(null)
      })

      // `tenantContext` is the flag the router stores for the scope (lib/util/tenancy.ts, `dataContext`).
      const config = { requiredRoles: [roles.public], tenantContext: true }
      instance.all('*', { config }, async (req, reply) => {
        if (isAnonymous(req) && (await tm.isValid(req)) !== true) {
          return reply.status(401).send(httpError(401, 'Authentication required', 'UNAUTHORIZED'))
        }
        await tm.handle(req.raw, reply.raw)
        // tus has written the response directly.
        reply.hijack()
      })
    },
    { prefix: global.transferPath }
  )
}
