/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-3.5: the audit trail gets a context, and a failure is visible.
//
// Defect D-05 had three layers: the tracker called the manager with no context, the manager
// refused, and the tracker turned the refusal into a log line while the request answered 200.
// A test that only checked "addChange was called" would have passed on the broken code, so
// what is asserted here is WHICH CONTAINER the write went to and WHAT THE CALLER SEES when
// it cannot happen.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { apply } from '../../lib/loader/tenant.js'
import { getData, getParams } from '../../lib/util/common.js'
import { TrackingError } from '../../lib/util/tracker.js'
import preHandler from '../../lib/hooks/preHandler.js'
import preSerialization from '../../lib/hooks/preSerialization.js'

;(global as any).log = {}

const CONTROL: any = { kind: 'control' }
const ACME: any = { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme' }
const HEADER = 'x-tenant-id'

/** Records the handle every tracking call received: that is the whole point of the task. */
function fakeTracking(over: any = {}) {
  const calls: any = { retrieve: [], added: [] }
  return {
    calls,
    isImplemented: () => true,
    retrieveBy: async (ctx: any, entityName: string, entityId: string) => {
      calls.retrieve.push({ ctx, entityName, entityId })
      if (over.retrieveThrows) throw new Error('cannot read the previous state')
      return over.baseline ?? null
    },
    addChange: async (ctx: any, change: any) => {
      calls.added.push({ ctx, change })
      if (over.addThrows) throw new Error('relation "change" does not exist')
      return { id: 'change-1' }
    },
    ...(over.isImplemented === false ? { isImplemented: () => false } : {})
  }
}

async function serverWith(opts: any = {}) {
  ;(global as any).config = { options: { tenants: opts.tenants ?? null } }
  ;(global as any).tracking = {
    'PUT::/widgets/:id': { enable: true, method: 'PUT', path: '/widgets/:id', entity: 'widget', primaryKey: 'id' }
  }
  ;(global as any).trackingConfig = { primaryKey: 'id', ...(opts.trackingConfig ?? {}) }

  const provider = {
    control: async () => CONTROL,
    tenant: async (tenantId: string) => ({ kind: 'tenant', tenantId }) as any,
    releaseRequestScope: async () => {},
    shutdown: async () => {}
  }

  const server: any = fastify()
  server.decorate('provider', provider)
  server.decorate('tenantManager', {
    isImplemented: () => true,
    getTenantBySlug: async (_c: any, slug: string) => (slug === ACME.slug ? ACME : null),
    getTenant: async (_c: any, id: string) => (id === ACME.id ? ACME : null)
  })
  server.decorate('trackingManager', opts.trackingManager ?? fakeTracking())

  await apply(server)
  // What lib/hooks/onRequest.ts does for every request: closures, evaluated later, when the
  // body has actually been parsed.
  server.addHook('onRequest', async (req: any) => {
    req.data = () => getData(req)
    req.parameters = () => getParams(req)
  })
  server.addHook('preHandler', preHandler)
  server.addHook('preSerialization', preSerialization)

  server.put(
    '/widgets/:id',
    { config: { tenantContext: true, ...(opts.routeTracking ? { tracking: opts.routeTracking } : {}) } },
    async (req: any, reply: any) => {
      if (opts.failHandler) return reply.code(400).send({ statusCode: 400, error: 'Bad Request' })
      return { id: req.params.id, name: req.body?.name }
    }
  )

  return server
}

const put = (server: any, headers: any = {}) =>
  server.inject({ method: 'PUT', url: '/widgets/w1', headers, payload: { name: 'new' } })

const MULTI = { strategy: 'schema', engine: 'postgres', resolver: 'header', headerKey: HEADER }

describe('util/tracker · the audit trail gets a context (T-3.5)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
    ;(global as any).tracking = undefined
    ;(global as any).trackingConfig = undefined
  })

  it('writes the change inside the tenant container, not the control plane', async () => {
    const tracking = fakeTracking({ baseline: { id: 'w1', name: 'old' } })
    const server = await serverWith({ tenants: MULTI, trackingManager: tracking })

    const res = await put(server, { [HEADER]: 'acme' })
    expect(res.statusCode).toBe(200)

    // The one assertion D-05 was about: in v4 this array was empty and nothing said so.
    expect(tracking.calls.added.length).toBe(1)
    const { ctx, change } = tracking.calls.added[0]
    expect(ctx.kind).toBe('tenant')
    expect(ctx.tenantId).toBe('id-acme')
    expect(change.entityName).toBe('widget')
    expect(change.entityId).toBe('w1')
    expect(change.status).toBe('update')
    expect(change.contents).toEqual([{ key: 'name', old: 'old', new: 'new' }])

    // The baseline was read from the same container, before the handler ran.
    expect(tracking.calls.retrieve[0].ctx.tenantId).toBe('id-acme')
    await server.close()
  })

  it('writes to the control plane when the deployment has no tenants', async () => {
    const tracking = fakeTracking()
    const server = await serverWith({ trackingManager: tracking })

    await put(server)
    expect(tracking.calls.added[0].ctx).toBe(CONTROL)
    await server.close()
  })

  it('records what a field became when there is no baseline, and does not invent the old value', async () => {
    // A consumer's own entity: the framework cannot reach the table, so `retrieveBy`
    // answers null. Writing `old: undefined` as if the field had been empty would be a
    // false audit record.
    const tracking = fakeTracking({ baseline: null })
    const server = await serverWith({ tenants: MULTI, trackingManager: tracking })

    await put(server, { [HEADER]: 'acme' })
    expect(tracking.calls.added[0].change.contents).toEqual([{ key: 'name', new: 'new' }])
    expect('old' in tracking.calls.added[0].change.contents[0]).toBe(false)
    await server.close()
  })

  it('does not record anything for a request that failed', async () => {
    const tracking = fakeTracking()
    const server = await serverWith({ tenants: MULTI, trackingManager: tracking, failHandler: true })

    const res = await put(server, { [HEADER]: 'acme' })
    expect(res.statusCode).toBe(400)
    expect(tracking.calls.added.length).toBe(0)
    await server.close()
  })
})

describe('util/tracker · what happens when it cannot be written (T-3.5)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
    ;(global as any).tracking = undefined
    ;(global as any).trackingConfig = undefined
  })

  it('carries a code the caller can act on', () => {
    const e = new TrackingError('writing the change', new Error('boom'))
    expect(e.code).toBe('TRACKING_FAILED')
    expect(e.statusCode).toBe(500)
  })

  it('fails the request by default', async () => {
    const tracking = fakeTracking({ addThrows: true })
    const server = await serverWith({ tenants: MULTI, trackingManager: tracking })

    const res = await put(server, { [HEADER]: 'acme' })
    // Strict is the default on purpose: an untracked write on a system that promises an
    // audit trail is worse than a visible error.
    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body).message).toMatch(/strict mode/)
    await server.close()
  })

  it('lets the response through when the route says the trail is accessory', async () => {
    const tracking = fakeTracking({ addThrows: true })
    const server = await serverWith({
      tenants: MULTI,
      trackingManager: tracking,
      routeTracking: { strict: false }
    })

    const res = await put(server, { [HEADER]: 'acme' })
    expect(res.statusCode).toBe(200)
    expect(tracking.calls.added.length).toBe(1)
    await server.close()
  })

  it('honours the deployment default, and the route still wins over it', async () => {
    const lenient = await serverWith({
      tenants: MULTI,
      trackingManager: fakeTracking({ addThrows: true }),
      trackingConfig: { strict: false }
    })
    expect((await put(lenient, { [HEADER]: 'acme' })).statusCode).toBe(200)
    await lenient.close()

    const overridden = await serverWith({
      tenants: MULTI,
      trackingManager: fakeTracking({ addThrows: true }),
      trackingConfig: { strict: false },
      routeTracking: { strict: true }
    })
    expect((await put(overridden, { [HEADER]: 'acme' })).statusCode).toBe(500)
    await overridden.close()
  })

  it('fails the request when even the baseline cannot be read', async () => {
    // A wrong diff is a wrong audit record, so the read is as strict as the write.
    const server = await serverWith({ tenants: MULTI, trackingManager: fakeTracking({ retrieveThrows: true }) })
    expect((await put(server, { [HEADER]: 'acme' })).statusCode).toBe(500)
    await server.close()
  })
})
