/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-10.27 left a blind spot written down: three route handlers that no spec ever loaded, so
// under c8 they counted as zero and under monocart they do not count at all. The way out was
// never a threshold, it was calls that reach those routes.
//
// They are four lines each, which is why nobody wrote a test: the work happens inside
// `generateManifest`, and T-9.5 already covers `buildManifest` on the shapes it produces. What
// stayed untested is the WIRING — that each handler asks for the plane its own route stands
// for, that it reads the schemas off the instance actually serving the request, and that the
// whole thing answers over HTTP. A handler that sent the tenant manifest on `/system/manifest`
// would not throw: it would hand a customer's console the platform's route map and role codes,
// and every screen it drew would be refused with SCOPE_MISMATCH.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { check as healthCheck } from '../../lib/api/health/controller/health.js'
import { get as adminManifest } from '../../lib/api/admin/controller/manifest.js'
import { get as systemManifest } from '../../lib/api/system/controller/systemManifest.js'

;(global as any).log = {}

const partnerSchema = {
  $id: 'partnerSchema',
  type: 'object',
  required: ['name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', maxLength: 80 },
    // Never on a form, never in a list: if a manifest names it, the console renders it.
    mfaSecret: { type: 'string' }
  }
}

const route = (over: any) => ({ method: 'GET', roles: [{ code: 'admin' }], doc: {}, ...over })

// The tenant plane: a customer's own resource.
const TENANT_ROUTES = [
  route({ path: '/partners', doc: { response: { 200: { type: 'array', items: { $ref: 'partnerSchema#' } } } } }),
  route({ path: '/partners/:id', doc: { response: { 200: { $ref: 'partnerSchema#' } } } }),
  route({ method: 'POST', path: '/partners', doc: { body: { $ref: 'partnerSchema#' } } })
]

// The control plane: what the router leaves as `tenantContext: false` after reading
// `scope: 'control'` (T-1.2).
const CONTROL_ROUTES = [
  route({ path: '/tenants', tenantContext: false, roles: [{ code: 'system:operator' }] }),
  route({ method: 'POST', path: '/tenants', tenantContext: false, roles: [{ code: 'system:operator' }] })
]

// Mocha runs every spec in one process, so globals assigned at module load belong to whoever
// wrote them. This suite borrows them and gives them back (the discipline of systemScope.spec).
let savedConfig: any
let savedRoutes: any
let savedServer: any

function takeGlobals(tenants: any) {
  savedConfig = (global as any).config
  savedRoutes = (global as any).routes
  savedServer = (global as any).server
  ;(global as any).config = { options: { tenants } }
  ;(global as any).routes = [...TENANT_ROUTES, ...CONTROL_ROUTES]
}

function giveGlobalsBack() {
  ;(global as any).config = savedConfig
  ;(global as any).routes = savedRoutes
  ;(global as any).server = savedServer
}

// A real instance with the real handlers on their real paths: the manifest controllers read
// `server.getSchemas()`, so the schema has to be registered on the instance that serves the
// request and not handed to them as an argument.
async function serve() {
  const server: any = fastify()
  server.addSchema(partnerSchema)
  server.get('/health', healthCheck as any)
  server.get('/admin/manifest', adminManifest as any)
  server.get('/system/manifest', systemManifest as any)
  await server.ready()
  return server
}

const TENANTS = { strategy: 'schema', resolver: 'header', headerKey: 'x-tenant-id' }

const paths = (manifest: any) =>
  [...(manifest.resources || []).flatMap((r: any) => (r.capabilities || []).map((c: any) => c.path))].sort()

describe('api route controllers over HTTP (T-10.27 blind spot)', () => {
  let server: any

  describe('with tenants declared', () => {
    before(async () => {
      takeGlobals(TENANTS)
      server = await serve()
    })
    after(async () => {
      await server.close()
      giveGlobalsBack()
    })

    it('GET /health answers before anything is configured', async () => {
      const res = await server.inject({ method: 'GET', url: '/health' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    })

    it('GET /admin/manifest describes the tenant plane and none of the control routes', async () => {
      const res = await server.inject({ method: 'GET', url: '/admin/manifest' })
      expect(res.statusCode).toBe(200)
      const manifest = res.json()
      expect(manifest.version).toBe(2)
      expect(manifest.auth.plane).toBe('tenant')
      expect(manifest.auth.endpoints.login).toBe('/auth/login')
      expect(manifest.resources.map((r: any) => r.name)).toEqual(['partners'])
      expect(paths(manifest).every((p: string) => p.startsWith('/partners'))).toBe(true)
      // Multi-tenant on the tenant plane: the console is told which header to send (T-10.15).
      expect(manifest.tenancy).toMatchObject({ mode: 'multi', switchable: false, header: 'x-tenant-id' })
    })

    it('GET /system/manifest describes the control plane and none of the tenant routes', async () => {
      const res = await server.inject({ method: 'GET', url: '/system/manifest' })
      expect(res.statusCode).toBe(200)
      const manifest = res.json()
      expect(manifest.auth.plane).toBe('control')
      expect(manifest.auth.endpoints.login).toBe('/system/auth/login')
      expect(manifest.resources.map((r: any) => r.name)).toEqual(['tenants'])
      expect(paths(manifest).every((p: string) => p.startsWith('/tenants'))).toBe(true)
      // There is no tenant to declare on the control plane, so no header is named.
      expect(manifest.tenancy.header).toBeUndefined()
    })

    it('reads the schemas off the instance serving the request, sensitive fields excluded', async () => {
      const res = await server.inject({ method: 'GET', url: '/admin/manifest' })
      const partners = res.json().resources.find((r: any) => r.name === 'partners')
      const names = (partners.fields || []).map((f: any) => f.name)
      // The schema only reaches the manifest through `server.getSchemas()`: if the handler read
      // some other instance, this list would be empty.
      expect(names).toContain('name')
      expect(names).not.toContain('mfaSecret')
    })
  })

  describe('without tenants declared', () => {
    before(async () => {
      takeGlobals(null)
      server = await serve()
    })
    after(async () => {
      await server.close()
      giveGlobalsBack()
    })

    // One identity space, so the manifest is whole: the planes are not split and `/admin/manifest`
    // describes everything the deployment serves. A console that hid the control routes here
    // would hide the only administration this deployment has.
    it('GET /admin/manifest is the whole surface, control routes included', async () => {
      const res = await server.inject({ method: 'GET', url: '/admin/manifest' })
      expect(res.statusCode).toBe(200)
      const manifest = res.json()
      expect(manifest.resources.map((r: any) => r.name).sort()).toEqual(['partners', 'tenants'])
      expect(manifest.tenancy).toEqual({ mode: 'single' })
    })
  })

  // `req.server || global.server`: the fallback is there because a handler can be invoked outside
  // a request (the manifest is also generated at boot). Untested, it is a branch that would only
  // be discovered the day `req.server` is absent and the manifest comes back with no fields.
  it('falls back to global.server when the request carries no instance', async () => {
    takeGlobals(TENANTS)
    const instance = await serve()
    ;(global as any).server = instance
    try {
      let sent: any
      const reply: any = { send: (payload: any) => ((sent = payload), reply) }
      adminManifest({} as any, reply)
      expect(sent.auth.plane).toBe('tenant')
      expect(sent.resources.find((r: any) => r.name === 'partners').fields.map((f: any) => f.name)).toContain('name')

      systemManifest({} as any, reply)
      expect(sent.auth.plane).toBe('control')
    } finally {
      await instance.close()
      giveGlobalsBack()
    }
  })
})
