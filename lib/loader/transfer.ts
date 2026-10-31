import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { TransferManagement } from '../../types/global.js'
import { httpError } from '../util/httpError.js'
import { isAnonymous } from '../hooks/onRequest.js'

/**
 * Whose an upload is: the subject of the request, inside its tenant. Tokens, users and system
 * users are kept apart, their ids coming from different tables; `undefined` for an anonymous request.
 */
export function transferOwner(req: FastifyRequest): string | undefined {
  const subject = req.token
    ? `token:${req.token.id}`
    : req.user
      ? `user:${req.user.id}`
      : req.systemUser
        ? `system:${req.systemUser.id}`
        : undefined
  if (subject === undefined) return undefined
  return req.tenant ? `${req.tenant.tenantId}/${subject}` : subject
}

/**
 * The roles `options.transfer.roles` names. Refused at boot when the list is missing or names a
 * role the project does not have: either would leave the endpoint open, or closed, by mistake.
 */
function transferRoles(): string[] {
  const named: unknown = global.config?.options?.transfer?.roles
  if (!Array.isArray(named) || named.some((code) => typeof code !== 'string')) {
    throw new Error('options.transfer.roles must list the roles that may upload ([] leaves only what isValid vouches for)')
  }
  const known = new Set(Object.values(roles).map((role) => role.code))
  const unknown = named.filter((code) => !known.has(code))
  if (unknown.length) throw new Error(`options.transfer.roles names roles the project does not have: ${unknown.join(', ')}`)
  return named
}

/**
 * Mounts the resumable upload endpoint (tus) at the manager's `getPath()`, when there is one.
 *
 * The route is declared public so that `onRequest` authenticates whoever carries a credential
 * and lets the rest through as anonymous; the handler then refuses an anonymous request unless
 * `isValid(req)` vouches for it (a signed link, say), and an authenticated one holding none of
 * the roles `options.transfer.roles` lists (`public` there lets every authenticated subject in).
 * Without those refusals the route would carry no `requiredRoles`, and the role gate lets such a
 * route through for anyone, credential or not.
 *
 * Every upload belongs to the subject that created it (`transferOwner`, handed to `handle`): the
 * manager answers 404 to anyone else. `req.transferOwner()` gives the same owner to a route that
 * reads an upload from the manager's store, so it can check the caller is the one who sent it.
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
  const allowed = transferRoles()
  const everyone = allowed.includes(roles.public.code)

  if (log.i) log.info(`Transfer Manager 📂 mounted at ${global.transferPath}`)

  server.decorateRequest('transferOwner', function (this: FastifyRequest) {
    return transferOwner(this)
  })

  await server.register(
    async (instance) => {
      // tus streams the body itself: no parser may consume it first.
      instance.addContentTypeParser('*', (_req, _payload, done) => {
        done(null)
      })

      // `tenantContext` is the flag the router stores for the scope (lib/util/tenancy.ts, `dataContext`).
      const config = { requiredRoles: [roles.public], tenantContext: true }
      instance.all('*', { config }, async (req, reply) => {
        if (isAnonymous(req)) {
          if ((await tm.isValid(req)) !== true) {
            return reply.status(401).send(httpError(401, 'Authentication required', 'UNAUTHORIZED'))
          }
        } else if (!everyone && !req.roles().some((code: string) => allowed.includes(code))) {
          return reply.status(403).send(httpError(403, 'Authorization denied', 'FORBIDDEN'))
        }
        await tm.handle(req.raw, reply.raw, transferOwner(req))
        // tus has written the response directly.
        reply.hijack()
      })
    },
    { prefix: global.transferPath }
  )
}
