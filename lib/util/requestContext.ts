//
// The tenant a piece of work belongs to, readable from anywhere it runs: a request once resolution
// has named its tenant (lib/loader/tenant.ts), or a job running on one tenant (lib/loader/schedules.ts).
// The logger puts it on every line and the span processor on every span (F75), so that neither has
// to be handed the request.
//
// Only an identifier, never the slug: a slug is often a customer's name, and log lines and spans
// leave for whatever collector the deployment chose.
//
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Span } from '@opentelemetry/api'
import type { FastifyInstance, FastifyRequest } from 'fastify'

/** The span attribute. OpenTelemetry has no convention for a tenant; this is the name in use. */
export const TENANT_ATTRIBUTE = 'tenant.id'

interface WorkContext {
  tenantId?: string
}

const storage = new AsyncLocalStorage<WorkContext>()
const contexts = new WeakMap<FastifyRequest, WorkContext>()

/** The tenant of the work running now, when there is one. */
export function currentTenantId(): string | undefined {
  return storage.getStore()?.tenantId
}

/** What a log line carries: the tenant under `tenant_id`, beside `trace_id`. */
export function tenantFields(): Record<string, string> {
  const tenantId = currentTenantId()
  return tenantId ? { tenant_id: tenantId } : {}
}

/** Runs work that belongs to one tenant outside a request: a job, one tenant of a fan-out. */
export function runInTenant<T>(tenantId: string, fn: () => T): T {
  return storage.run({ tenantId }, fn)
}

/**
 * Gives every request a context of its own, in the hooks that open each segment of its life.
 *
 * Once is not enough: Fastify reads the body from the socket's events, and the hooks after it run
 * in the context of the socket, not of the request, so `preValidation` enters it again. So does
 * `onResponse`, which runs from the response's `finish`. Callback hooks, because an async one
 * would enter the context for itself and return, leaving the next hook outside. Registered before
 * the other hooks of the same kind, or those run without it.
 */
export function registerRequestContext(server: FastifyInstance): void {
  const enter = (req: FastifyRequest, done: () => void) => {
    const context = contexts.get(req)
    if (context) storage.run(context, done)
    else done()
  }
  server.addHook('onRequest', (req, _reply, done) => {
    const context: WorkContext = {}
    contexts.set(req, context)
    storage.run(context, done)
  })
  server.addHook('preValidation', (req, _reply, done) => enter(req, done))
  server.addHook('onResponse', (req, _reply, done) => enter(req, done))
}

/**
 * Records the tenant resolution chose, for everything the request does from here. The request
 * span started before the tenant was known, so the attribute goes on it here; the spans started
 * after it get it from the span processor.
 */
export function enterTenant(req: FastifyRequest, tenantId: string): void {
  const context = contexts.get(req)
  if (context) context.tenantId = tenantId
  // Decorated by `@fastify/otel`, only on a server where telemetry is on. Called on the request:
  // it reads the span from `this`.
  ;(req as { opentelemetry?: () => { span?: Span | null } })
    .opentelemetry?.()
    .span?.setAttribute(TENANT_ATTRIBUTE, tenantId)
}
