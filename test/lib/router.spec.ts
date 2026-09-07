/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { processRoute } from '../../lib/loader/router.js'

// processRoute reads global `roles` and `log`.
;(global as any).roles = {
  public: { code: 'public' },
  admin: { code: 'admin' },
  backoffice: { code: 'backoffice' },
  ops: { code: 'ops', capabilities: ['users'] }
}
// T-4.1: the control catalogue is a separate map. A control route resolves against this
// one and never sees a tenant role code.
;(global as any).systemRoles = {
  'system:admin': { code: 'system:admin', name: 'System admin', capabilities: [] },
  'system:operator': { code: 'system:operator', name: 'System operator', capabilities: ['tenants', 'tenants:read'] }
}
;(global as any).log = {} // all log.x flags falsy -> silent

const AUTH_MIDDLEWARES = ['global.isAuthenticated', 'global.isAdmin']
const run = (route: any, validRoutes: any[] = [], errors: string[] = [], fileConfig: any = {}) =>
  processRoute(route, 0, 'users/routes.ts', 'users', '/base', fileConfig, AUTH_MIDDLEWARES, validRoutes, errors)

const codes = (r: any) => (r.roles || []).map((x: any) => x.code)

describe('loader/router — processRoute', () => {
  // T-1.2: `scope` is the v5 spelling of which plane a route acts on. It must actually
  // reach the route, or it is a documented field nobody reads (D-11).
  it('resolves scope: control into a route outside the tenant context', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'user.find', config: { scope: 'control' } })
    expect(r.tenantContext).toBe(false)
  })

  // T-3.3: `tenantContext` was the v4 spelling. It is refused at boot, not translated: a
  // route that meant "the platform" and is silently read as "a tenant" does not fail, it
  // answers from the wrong container.
  it('refuses the v4 spelling instead of translating it', () => {
    const errors: string[] = []
    run({ method: 'GET', path: '/', handler: 'user.find', config: { tenantContext: false } }, [], errors)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("scope: 'control'")

    const fromFile: string[] = []
    run({ method: 'GET', path: '/', handler: 'user.find' }, [], fromFile, { tenantContext: false })
    expect(fromFile.length).toBe(1)
  })

  it('refuses a plane that does not exist', () => {
    const errors: string[] = []
    run({ method: 'GET', path: '/', handler: 'user.find', config: { scope: 'platform' } }, [], errors)
    expect(errors.length).toBe(1)
    expect(errors[0]).toContain("unknown scope 'platform'")
  })

  // docs/AUTHORIZATION_V5.md §2.1: a route that mixes the scopes is a hole, and it must be
  // impossible to ship. These are refusals at boot, not warnings.
  it('refuses a tenant role on a control route, and a control role on a tenant route', () => {
    const mixedDown: string[] = []
    run({ method: 'GET', path: '/', handler: 'x.y', roles: ['admin'], config: { scope: 'control' } }, [], mixedDown)
    expect(mixedDown.length).toBe(1)
    expect(mixedDown[0]).toContain("control route lists the tenant role 'admin'")

    const mixedUp: string[] = []
    run({ method: 'GET', path: '/', handler: 'x.y', roles: ['system:operator'] }, [], mixedUp)
    expect(mixedUp.length).toBe(1)
    expect(mixedUp[0]).toContain("tenant route lists the control role 'system:operator'")
  })

  it('refuses a capability from the wrong catalogue', () => {
    const invented: string[] = []
    run({ method: 'GET', path: '/', handler: 'x.y', requireCapability: 'users', config: { scope: 'control' } }, [], invented)
    expect(invented.length).toBe(1)
    expect(invented[0]).toContain('not in the control catalogue')

    const borrowed: string[] = []
    run({ method: 'GET', path: '/', handler: 'x.y', requireCapability: 'tenants:destroy' }, [], borrowed)
    expect(borrowed.length).toBe(1)
    expect(borrowed[0]).toContain('cannot gate a tenant route')
  })

  it('gives a control route the system superuser, and never public', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'x.y', config: { scope: 'control' } })
    expect(codes(r)).toEqual(['system:admin'])

    const byCapability: any = run({
      method: 'GET',
      path: '/c',
      handler: 'x.y',
      requireCapability: 'tenants:read',
      config: { scope: 'control' }
    })
    expect(codes(byCapability).sort()).toEqual(['system:admin', 'system:operator'])
  })

  it('keeps the tenant context by default, and for scope: tenant', () => {
    const plain: any = run({ method: 'GET', path: '/', handler: 'user.find' })
    expect(plain.tenantContext).toBe(true)
    const scoped: any = run({ method: 'GET', path: '/s', handler: 'user.find', config: { scope: 'tenant' } })
    expect(scoped.tenantContext).toBe(true)
  })

  it('defaults to [public] and always appends admin (global superuser)', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'user.find' })
    expect(codes(r)).toEqual(['public', 'admin'])
  })

  it('does not double-append admin when already present', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'user.find', roles: [{ code: 'admin' }] })
    expect(codes(r)).toEqual(['admin'])
  })

  it('appends admin to a non-admin role set', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'user.find', roles: [{ code: 'backoffice' }] })
    expect(codes(r)).toEqual(['backoffice', 'admin'])
  })

  it('derives bearer security for a role-protected (non-public) route', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'user.find', roles: [{ code: 'backoffice' }] })
    expect(r.doc.security).toEqual([{ Bearer: [] }])
  })

  it('does not force security for a purely public route', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'user.find' })
    expect(r.doc.security).toBeFalsy()
  })

  it('forces bearer security when an auth middleware is attached, even if public', () => {
    const r: any = run({
      method: 'GET',
      path: '/roles',
      handler: 'user.getRoles',
      middlewares: ['global.isAuthenticated']
    })
    expect(r.doc.security).toEqual([{ Bearer: [] }])
  })

  it('normalizes method to upper-case and builds the full path', () => {
    const r: any = run({ method: 'get', path: '/count', handler: 'user.count' })
    expect(r.method).toBe('GET')
    expect(r.path).toBe('/users/count')
    expect(r.func).toBe('count')
  })

  it('returns null for a disabled route', () => {
    const r = run({ method: 'GET', path: '/', handler: 'user.find', config: { enable: false } })
    expect(r).toBeNull()
  })

  it('returns null for a malformed handler', () => {
    const r = run({ method: 'GET', path: '/', handler: 'bogus' })
    expect(r).toBeNull()
  })

  it('returns null on a duplicated method+path', () => {
    const first: any = run({ method: 'GET', path: '/', handler: 'user.find' })
    const dup = run({ method: 'GET', path: '/', handler: 'user.find' }, [first])
    expect(dup).toBeNull()
  })
})

const runErr = (route: any, roleErrors: string[]) =>
  processRoute(route, 0, 'x/routes.ts', 'x', '/base', {}, AUTH_MIDDLEWARES, [], roleErrors)

describe('loader/router — role/capability resolution', () => {
  it('resolves a string-code role against the catalog', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'x.y', roles: ['backoffice'] })
    expect(codes(r)).toEqual(['backoffice', 'admin'])
  })

  it('expands requireCapability to holder roles plus admin', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'x.y', requireCapability: 'users' })
    expect(codes(r)).toEqual(['ops', 'admin'])
  })

  it('a capability held by no role is admin-only (no public default)', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'x.y', requireCapability: 'tokens' })
    expect(codes(r)).toEqual(['admin'])
  })

  it('dedupes when a declared role also holds the capability', () => {
    const r: any = run({ method: 'GET', path: '/', handler: 'x.y', roles: ['ops'], requireCapability: 'users' })
    expect(codes(r)).toEqual(['ops', 'admin'])
  })

  it('collects an unknown string-code role for the fail-fast', () => {
    const errs: string[] = []
    runErr({ method: 'GET', path: '/', handler: 'x.y', roles: ['pippo'] }, errs)
    expect(errs.length).toBe(1)
    expect(errs[0]).toContain("unknown role 'pippo'")
  })

  it('collects an undefined role entry (e.g. roles.pippo)', () => {
    const errs: string[] = []
    runErr({ method: 'GET', path: '/', handler: 'x.y', roles: [undefined] }, errs)
    expect(errs.length).toBe(1)
    expect(errs[0]).toContain('undefined role')
  })

  it('does not flag a well-known role', () => {
    const errs: string[] = []
    runErr({ method: 'GET', path: '/', handler: 'x.y', roles: ['admin'] }, errs)
    expect(errs.length).toBe(0)
  })
})
