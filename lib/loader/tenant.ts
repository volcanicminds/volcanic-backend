import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, DataProvider, Tenant, TenantManagement } from '../../types/global.js'
import { isTenancyEnabled, tenantsConfig } from '../util/tenancy.js'
import { declaredTenant } from '../util/tenantResolution.js'
import { bearerTokenOf } from '../util/bearer.js'
import { httpError } from '../util/httpError.js'

//
// The data context of a request: what it gets, and where it gives it back.
//
// v4 did three things here, and two of them were the defect: it created a QueryRunner per
// request, mutated its session with `SET search_path`, and tried to undo that from a
// listener on `finish` that Fastify never reached in time, so the tenant's schema went back
// into the pool with the connection (D-01, proved in appendix A.2 of EVO_FRAMEWORK.md).
//
// v5 does not switch a session at all: the container is chosen by qualifying the tables
// (T-3.1), so nothing is left behind to clean up and the order in which the hooks run stops
// being a security property. What remains is bookkeeping, and it has exactly ONE address,
// `release()` below. The response hook and the abort listener both call it, and the second
// caller finds the scope already released.
//
// Which tenant a request belongs to is decided below, and the order of the sources is the
// whole of T-3.2: the token first, the resolver only for a request that carries no token.
//
const providerOf = (server: FastifyInstance): DataProvider | undefined =>
  (server as unknown as Record<string, DataProvider | undefined>)['provider']

/**
 * The one place a request's data scope is given back.
 *
 * The flag is set here, synchronously, before anything is awaited: the response path and
 * the abort listener can both reach this line, and whichever arrives first must make the
 * other a no-op. Leaving that decision to the adapter would put it back where v4 had it:
 * in two places, with an order nobody controls (D-01).
 */
async function release(req: FastifyRequest, error?: Error): Promise<void> {
  const scope = req.dataScope
  if (!scope || scope.released) return
  scope.released = true
  try {
    await providerOf(req.server)?.releaseRequestScope(scope, error)
  } catch (e) {
    // A failed release must not turn into a failed response: the response is already sent.
    // It must not be silent either, because a container that is never given back is how a
    // pool runs dry.
    if (log.e) log.error(`Data context: release failed for request ${scope.requestId}: ${(e as Error)?.message}`)
  }
}

export async function apply(server: FastifyInstance) {
  // The provider is looked up per request, not here: the data layer is decorated onto the
  // server AFTER the routes are loaded (index.ts), so reading it now would capture nothing
  // and silently leave every request without a control plane.
  //
  // The control plane is available to every request, tenants or not: it is where the
  // registry and the system users live, and a `scope: 'control'` route needs it even in a
  // deployment that has tenants (docs/AUTHORIZATION_V5.md §2).
  server.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const provider = providerOf(req.server)
    if (!provider) return

    req.dataScope = { requestId: String(req.id) }
    req.control = (await provider.control()) as ControlHandle

    // The safety net, and the reason it is not a second release path: if the client goes
    // away before the response is written, Fastify may never run `onResponse`. The
    // listener passes an error, which tells the data layer that whatever it hands back was
    // interrupted and must not be handed out again.
    reply.raw.on('close', () => {
      if (reply.raw.writableFinished) return
      void release(req, new Error('Client aborted the request'))
    })
  })

  server.addHook('onResponse', async (req: FastifyRequest) => {
    await release(req)
  })

  if (!isTenancyEnabled()) {
    if (log.i) log.info('Tenancy: single tenant (no `tenants` block declared)')
    return
  }

  const tenants = tenantsConfig()
  if (log.i) log.info(`Tenancy: 🟢 ${tenants?.strategy} on ${tenants?.engine}`)

  server.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const cfg = (req.routeOptions?.config as { tenantContext?: boolean }) || {}
    // Only routes the framework's router registered carry this flag. Everything else, the
    // Swagger UI, static mounts, a 404, never reaches the data layer, and refusing it here
    // would be answering a question nobody asked.
    if (typeof cfg.tenantContext !== 'boolean') return
    if (cfg.tenantContext === false) return

    // Fail-closed (invariant 2): tenancy declared and no manager able to serve it means the
    // request cannot be isolated, so it is refused. It is never served on a shared context:
    // that is what "no implicit fallback to the global context" means (invariant 3).
    const tm = server['tenantManager'] as TenantManagement
    if (!tm || !tm.isImplemented() || !req.control) {
      if (log.e) log.error('Tenancy: declared but no tenant manager is implemented, refusing the request')
      return reply
        .code(503)
        .send(httpError(503, 'Tenancy is declared but the data layer cannot resolve tenants', 'TENANCY_NOT_AVAILABLE'))
    }

    const declared = declaredTenant(req, tenants)
    const claimed = claimedTenant(req)

    if (claimed === CONTROL_TOKEN) {
      // A control token has no `tid` by design (docs/AUTHORIZATION_V5.md §5). It is not a
      // request missing its tenant, it is a request on the wrong plane, and saying so is
      // worth more than a generic 400.
      return reply.code(403).send(httpError(403, 'A control token cannot act inside a tenant', 'SCOPE_MISMATCH'))
    }

    let tenant: Tenant | null = null

    if (claimed) {
      // The token decides. The header, when present, may only agree with it: the answer is
      // the same whether the declared tenant exists, is another one, or does not exist at
      // all, so a mismatch reveals nothing about the registry.
      if (declared) {
        const named = await tm.getTenantBySlug(req.control, declared)
        if (!named || named.id !== claimed) {
          if (log.w) log.warn(`Tenancy: token and ${tenants?.resolver ?? 'header'} name different tenants on ${req.url}`)
          return reply.code(403).send(httpError(403, 'The token does not belong to the declared tenant', 'TENANT_MISMATCH'))
        }
        tenant = named
      } else {
        tenant = await tm.getTenant(req.control, claimed)
      }
    } else if (declared) {
      // No token: login and public routes, the only ones where the tenant cannot come from
      // a credential (docs/API_V5.md §2.2).
      tenant = await tm.getTenantBySlug(req.control, declared)
    } else {
      return reply.code(400).send(httpError(400, 'No tenant was declared for this request', 'TENANT_REQUIRED'))
    }

    // Unknown and suspended answer the same 404: 403 would confirm that a tenant exists,
    // which turns the registry into something probable from outside (docs/API_V5.md §8).
    if (!tenant || tenant.status !== 'active') {
      return reply.code(404).send(httpError(404, 'Not found', 'TENANT_NOT_FOUND'))
    }

    req.tenantInfo = tenant
    await openTenantContext(req, tenant.id)
  })
}

/** A control token declares its plane and carries no tenant: it is not a missing `tid`. */
const CONTROL_TOKEN = Symbol('control-token')

/**
 * The tenant the request PROVES, taken from a token whose signature verified.
 *
 * The core reads the token, not the data layer: the data layer receives an identifier and
 * knows nothing about JWTs, which keeps the boundary `dependency-cruiser` enforces without
 * creating a second opinion on whether a token is valid.
 *
 * A token that does not verify yields nothing, on purpose. The authentication hook runs
 * right after this one and answers 401 for any route that is not public; on a public route
 * the request then behaves exactly as an anonymous one, which is what it is. Refusing here
 * instead would give a garbage token a different meaning from no token at all.
 */
function claimedTenant(req: FastifyRequest): string | typeof CONTROL_TOKEN | undefined {
  const raw = bearerTokenOf(req)
  if (!raw) return undefined

  try {
    const data = req.server.jwt.verify(raw) as { tid?: string; scp?: string }
    if (data?.scp === 'control') return CONTROL_TOKEN
    return typeof data?.tid === 'string' && data.tid ? data.tid : undefined
  } catch {
    return undefined
  }
}

/**
 * Puts a request inside a tenant's container, once resolution has said which one (T-3.2).
 *
 * The scope travels with the call so the data layer knows WHO is holding the container: it
 * is what the LRU consults before closing one, and what `release()` gives back. Nothing is
 * written to the connection, so there is no matching "leave the container" step, and that
 * absence is the point of T-3.1.
 */
export async function openTenantContext(req: FastifyRequest, tenantId: string): Promise<void> {
  const provider = providerOf(req.server)
  if (!provider) throw new Error('No data layer is loaded: a tenant context cannot be opened')
  req.tenant = await provider.tenant(tenantId, req.dataScope)
}
