/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-3.1: what a request gets from the data layer, and where it gives it back.
//
// The property under test is not "the hooks run" but "the release happens exactly once,
// whoever gets there first". v4 had two owners of one release and they ran in the wrong
// order, which is the whole of D-01; a single owner is only worth claiming if a test says
// a second caller changes nothing.
//
import { expect } from 'expect'
import fastify from 'fastify'
import http from 'http'
import { apply, openTenantContext } from '../../lib/loader/tenant.js'
import { dataContext, NoDataContextError } from '../../lib/util/tenancy.js'

;(global as any).log = {}

/** A data layer reduced to what the core is allowed to know: two handles and a release. */
function fakeProvider() {
  const releases: Array<{ requestId: string; error?: string }> = []
  const opened: string[] = []
  return {
    releases,
    opened,
    control: () => ({ kind: 'control' }) as any,
    tenant: async (tenantId: string, scope?: any) => {
      opened.push(`${tenantId}@${scope?.requestId ?? 'no-scope'}`)
      return { kind: 'tenant', tenantId } as any
    },
    releaseRequestScope: async (scope: any, error?: Error) => {
      releases.push({ requestId: scope.requestId, error: error?.message })
    },
    shutdown: async () => {}
  }
}

async function serverWith(provider: any, config?: any) {
  ;(global as any).config = { options: config ?? {} }
  const server: any = fastify()
  server.decorate('provider', provider)
  await apply(server)
  return server
}

describe('loader/tenant · the request data context (T-3.1)', () => {
  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('gives every request the control plane, tenants or not', async () => {
    const provider = fakeProvider()
    const server = await serverWith(provider)
    let seen: any = null
    server.get('/x', async (req: any) => {
      seen = { control: req.control, scope: req.dataScope }
      return { ok: true }
    })

    const res = await server.inject({ method: 'GET', url: '/x' })
    expect(res.statusCode).toBe(200)
    expect(seen.control.kind).toBe('control')
    expect(seen.scope.requestId).toBeTruthy()
    await server.close()
  })

  it('releases the scope once, after the response', async () => {
    const provider = fakeProvider()
    const server = await serverWith(provider)
    server.get('/x', async () => ({ ok: true }))

    await server.inject({ method: 'GET', url: '/x' })
    await server.inject({ method: 'GET', url: '/x' })

    expect(provider.releases.length).toBe(2)
    expect(provider.releases[0].requestId).not.toBe(provider.releases[1].requestId)
    expect(provider.releases.every((r) => r.error === undefined)).toBe(true)
    await server.close()
  })

  it('releases with an error when the client goes away mid-flight', async () => {
    // A real socket, because this is the one path `inject` cannot show: Fastify may never
    // run onResponse for a request nobody is listening to any more, and the connection
    // must still be given back, marked, so a pool destroys it instead of reusing it.
    const provider = fakeProvider()
    const server = await serverWith(provider)

    let scopeSeen: any = null
    server.get('/slow', async (req: any) => {
      scopeSeen = req.dataScope
      await new Promise((resolve) => setTimeout(resolve, 5000)) // never answered in this test
      return { ok: true }
    })

    await server.listen({ port: 0, host: '127.0.0.1' })
    const { port } = server.server.address()

    await new Promise<void>((resolve) => {
      const request = http.request({ host: '127.0.0.1', port, path: '/slow', method: 'GET' }, () => {})
      request.on('error', () => {})
      request.end()
      setTimeout(() => {
        request.destroy()
        setTimeout(resolve, 150)
      }, 150)
    })

    expect(scopeSeen).not.toBe(null)
    expect(provider.releases.length).toBe(1)
    expect(provider.releases[0].requestId).toBe(scopeSeen.requestId)
    expect(provider.releases[0].error).toBe('Client aborted the request')
    await server.close()
  })

  it('marks a scope spent, so a second release finds nothing to give back', async () => {
    const provider = fakeProvider()
    const server = await serverWith(provider)
    let scope: any = null
    server.get('/x', async (req: any) => {
      scope = req.dataScope
      return { ok: true }
    })

    await server.inject({ method: 'GET', url: '/x' })
    expect(provider.releases.length).toBe(1)
    // The flag is the loader's, not the adapter's: whoever gets here first spends it.
    expect(scope.released).toBe(true)
    await server.close()
  })

  it('carries the request scope into the container it opens', async () => {
    const provider = fakeProvider()
    const server = await serverWith(provider)
    server.get('/x', { config: { tenantContext: false } }, async (req: any) => {
      await openTenantContext(req, 'acme-id')
      return { tenant: (req.tenant as any).tenantId }
    })

    const res = await server.inject({ method: 'GET', url: '/x' })
    expect(JSON.parse(res.body).tenant).toBe('acme-id')
    // The container knows WHICH request is holding it: that is what the LRU consults
    // before closing one, and what the release gives back.
    expect(provider.opened[0]).toMatch(/^acme-id@.+/)
    expect(provider.opened[0]).not.toContain('no-scope')
    await server.close()
  })

  it('refuses a tenant request when nothing can resolve tenants (fail-closed)', async () => {
    const provider = fakeProvider()
    const server = await serverWith(provider, { tenants: { strategy: 'schema', engine: 'postgres' } })
    server.decorate('tenantManager', { isImplemented: () => false })
    server.get('/x', { config: { tenantContext: true } }, async () => ({ ok: true }))

    // Tenancy declared and no way to honour it: the request is refused, never served on
    // the control plane by omission (invariant 3).
    const res = await server.inject({ method: 'GET', url: '/x' })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).code).toBe('TENANCY_NOT_AVAILABLE')
    // Refused, but the scope it took is still given back: a rejected request is a request.
    expect(provider.releases.length).toBe(1)
    await server.close()
  })

  it('does nothing at all without a data layer', async () => {
    ;(global as any).config = { options: {} }
    const server: any = fastify()
    await apply(server)
    server.get('/x', async (req: any) => ({ control: req.control ?? null, scope: req.dataScope ?? null }))

    const res = await server.inject({ method: 'GET', url: '/x' })
    expect(JSON.parse(res.body)).toEqual({ control: null, scope: null })
    await server.close()
  })
})

//
// T-3.3: invariant 3, as a function. The control plane is what a route ASKS for, never what
// it gets because its tenant went missing. `dataContext` is pure, so the rule is stated
// here without a server: the shape of the request is the whole input.
//
describe('util/tenancy · which handle a call gets (T-3.3)', () => {
  const CONTROL: any = { kind: 'control' }
  const TENANT: any = { kind: 'tenant', tenantId: 'acme-id' }
  const req = (over: any): any => ({ method: 'GET', url: '/x', ...over })
  const withTenancy = (on: boolean) => {
    ;(global as any).config = { options: { tenants: on ? { strategy: 'schema', engine: 'postgres' } : null } }
  }

  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('gives a tenant route its container', () => {
    withTenancy(true)
    expect(dataContext(req({ control: CONTROL, tenant: TENANT }))).toBe(TENANT)
  })

  it('refuses to substitute the control plane when the container is missing', () => {
    withTenancy(true)
    // v4 wrote this case as `req.db ?? global.connection.manager`, and that is D-06: a
    // request that lost its context read whatever the pool handed over.
    expect(() => dataContext(req({ control: CONTROL }))).toThrow(NoDataContextError)
    try {
      dataContext(req({ control: CONTROL }))
    } catch (e: any) {
      expect(e.code).toBe('NO_DATA_CONTEXT')
      expect(e.message).toContain('scope: control')
    }
  })

  it('gives the control plane to a route that declared it, even with tenants configured', () => {
    withTenancy(true)
    const declared = req({ control: CONTROL, routeOptions: { config: { tenantContext: false } } })
    expect(dataContext(declared)).toBe(CONTROL)
  })

  it('gives the control plane to every route of a single-tenant deployment', () => {
    withTenancy(false)
    expect(dataContext(req({ control: CONTROL }))).toBe(CONTROL)
  })

  it('refuses when there is no data layer at all', () => {
    withTenancy(false)
    expect(() => dataContext(req({}))).toThrow(NoDataContextError)
  })
})
