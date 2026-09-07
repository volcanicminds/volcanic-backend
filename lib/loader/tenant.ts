import { FastifyInstance } from 'fastify'
import { TenantManagement } from '../../types/global.js'
import { isTenancyEnabled, tenantsConfig } from '../util/tenancy.js'

//
// Tenant loader.
//
// v4 did three things here, and two of them were the defect: it created a QueryRunner per
// request, mutated its session with `SET search_path`, and tried to undo that from a
// listener on `finish` that Fastify never reached in time, so the tenant's schema went back
// into the pool with the connection (D-01, proved in appendix A.2 of EVO_FRAMEWORK.md).
//
// v5 does not switch a session at all: the container is chosen by qualifying the tables,
// so nothing is left behind to clean up. That mechanism, the token-bound resolution and the
// single release path arrive with T-3.1 and T-3.2, on top of the data layer that T-1.3 and
// phase 2 build. Until then this loader only does what it can do honestly: say which mode
// the deployment is in, and refuse to pretend there is isolation when there is none.
//
export async function apply(server: FastifyInstance) {
  if (!isTenancyEnabled()) {
    if (log.i) log.info('Tenancy: single tenant (no `tenants` block declared)')
    return
  }

  const tenants = tenantsConfig()
  if (log.i) log.info(`Tenancy: 🟢 ${tenants?.strategy} on ${tenants?.engine}`)

  server.addHook('onRequest', async (req, reply) => {
    const cfg = (req.routeOptions?.config as { tenantContext?: boolean }) || {}
    if (cfg.tenantContext === false) return

    // Fail-closed (invariant 2): tenancy declared and no manager able to serve it means the
    // request cannot be isolated, so it is refused. It is never served on a shared context:
    // that is what "no implicit fallback to the global context" means (invariant 3).
    const tm = server['tenantManager'] as TenantManagement
    if (!tm || !tm.isImplemented()) {
      if (log.e) log.error('Tenancy: declared but no tenant manager is implemented — refusing the request')
      return reply.code(503).send({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Tenancy is declared but the data layer cannot resolve tenants',
        code: 'TENANCY_NOT_AVAILABLE'
      })
    }

    // T-3.2 resolves the tenant here, from the token first and from the resolver only for
    // requests that carry none, then T-3.1 opens the container. Neither exists yet, and a
    // half-resolution would be worse than none: refuse.
    if (log.t) log.trace(`Tenancy: resolution not implemented yet for ${req.url}`)
    return reply.code(503).send({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Tenant resolution is not implemented in this build',
      code: 'TENANT_RESOLUTION_NOT_IMPLEMENTED'
    })
  })
}
