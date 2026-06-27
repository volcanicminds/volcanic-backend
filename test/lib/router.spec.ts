/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { processRoute } from '../../lib/loader/router.js'

// processRoute reads global `roles` and `log`.
;(global as any).roles = {
  public: { code: 'public' },
  admin: { code: 'admin' },
  backoffice: { code: 'backoffice' }
}
;(global as any).log = {} // all log.x flags falsy -> silent

const AUTH_MIDDLEWARES = ['global.isAuthenticated', 'global.isAdmin']
const run = (route: any, validRoutes: any[] = []) =>
  processRoute(route, 0, 'users/routes.ts', 'users', '/base', {}, AUTH_MIDDLEWARES, validRoutes)

const codes = (r: any) => (r.roles || []).map((x: any) => x.code)

describe('loader/router — processRoute', () => {
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
