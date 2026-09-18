/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-10.20 and T-10.21, verified on the real route files instead of fixtures.
//
// `manifest.spec.ts` proves the grammar on shapes written by hand, which is where the rules
// belong. What it cannot prove is that the framework's own routes.ts USE that grammar: the hint
// travels from `config.manifest.resource` through the loader into `ConfiguredRoute.resource`, and
// a hint that never reaches the manifest is a declaration nobody reads. So this suite imports the
// actual files, runs every route through the actual loader, and asks the manifest what a console
// would be handed.
//
import { expect } from 'expect'
import { processRoute } from '../../lib/loader/router.js'
import { loadSystem } from '../../lib/loader/roles.js'
import { buildManifest } from '../../lib/manifest/generator.js'
import * as commonSchemas from '../../lib/schemas/common.js'
import * as systemUserSchemas from '../../lib/schemas/systemUser.js'
import * as tenantSchemas from '../../lib/schemas/tenant.js'

const SCHEMAS: Record<string, any> = {}
for (const mod of [commonSchemas, systemUserSchemas, tenantSchemas]) {
  for (const value of Object.values(mod) as any[]) {
    if (value && typeof value === 'object' && value.$id) SCHEMAS[value.$id] = value
  }
}

const AUTH_MIDDLEWARES = ['global.isAuthenticated', 'global.isAdmin']

let savedRoles: any
let savedSystemRoles: any
let savedConfig: any

// Both files decide at import time whether they are enabled at all (`enable: isTenancyEnabled()`),
// so the config has to be in place before the module is loaded, not before it is used. Loaded
// afresh for the same reason: a suite that booted the real server has it cached with its own config.
async function routesOf(dir: string) {
  const mod = await import(`../../lib/api/${dir}/routes.js?fresh=${Date.now()}`)
  const file = mod.default
  const errors: string[] = []
  const out: any[] = []
  file.routes.forEach((r: any, i: number) => {
    const configured = processRoute(r, i, `${dir}/routes.ts`, dir, '', file.config, AUTH_MIDDLEWARES, out, errors)
    if (configured) out.push(configured)
  })
  expect(errors).toEqual([])
  return out
}

const control = (routes: any[]) =>
  buildManifest({ routes, schemas: SCHEMAS, options: { plane: 'control', splitPlanes: true } })

describe('manifest · the framework own routes, through the loader', () => {
  let manifest: any

  before(async () => {
    savedRoles = (global as any).roles
    savedSystemRoles = (global as any).systemRoles
    savedConfig = (global as any).config
    ;(global as any).log = {}
    // The shape a console actually runs in: tenants declared, and the manifest opted into. Both
    // switches matter — `/system/manifest` is not mounted at all without the second one, so a
    // suite that left it out would be describing a deployment with no console.
    ;(global as any).config = { options: { tenants: { strategy: 'schema' }, manifest: { enabled: true } } }
    ;(global as any).roles = {
      public: { code: 'public', name: 'Public' },
      admin: { code: 'admin', name: 'Admin' }
    }
    ;(global as any).systemRoles = await loadSystem()
    manifest = control([...(await routesOf('system')), ...(await routesOf('tenants'))])
  })

  after(() => {
    ;(global as any).roles = savedRoles
    ;(global as any).systemRoles = savedSystemRoles
    ;(global as any).config = savedConfig
  })

  describe('the platform operators are a resource (T-10.20)', () => {
    const operators = () => manifest.resources.find((r: any) => r.name === 'systemUser')

    it('appears in the control manifest, under the path it is served at', () => {
      expect(operators()).toBeDefined()
      expect(operators().path).toBe('system/users')
      expect(operators().titleField).toBe('email')
      expect(operators().group).toBe('system')
    })

    it('carries the five CRUD capabilities bound to the right paths', () => {
      const crud = Object.fromEntries(
        operators()
          .capabilities.filter((c: any) => c.kind !== 'action')
          .map((c: any) => [c.kind, `${c.method} ${c.path}`])
      )
      expect(crud).toEqual({
        list: 'GET /system/users',
        read: 'GET /system/users/:id',
        create: 'POST /system/users',
        update: 'PUT /system/users/:id',
        delete: 'DELETE /system/users/:id'
      })
    })

    it('carries block, unblock and the MFA reset as row actions', () => {
      const actions = operators().capabilities.filter((c: any) => c.kind === 'action')
      expect(actions.map((a: any) => a.name).sort()).toEqual(['block', 'reset', 'unblock'])
      for (const a of actions) expect(a.target).toEqual(['row'])
      // The reason a block is recorded with: the dialog has to ask for it, so the body schema
      // must reach the manifest.
      expect(actions.find((a: any) => a.name === 'block').input.fields.map((f: any) => f.name)).toEqual(['reason'])
    })

    it('describes the fields a console renders, and none of the credential columns', () => {
      const fields = operators().fields
      const names = fields.map((f: any) => f.name)
      expect(names).toEqual(expect.arrayContaining(['email', 'roles', 'blocked', 'mfaEnabled']))
      // Never readable, never listed: `password` is write-only and the rest never leaves at all.
      expect(fields.find((f: any) => f.name === 'password').readOnly).toBeUndefined()
      expect(names).not.toContain('mfaSecret')
      expect(names).not.toContain('mfaRecoveryCodes')
      expect(names).not.toContain('externalId')
    })

    it('does not swallow the rest of /system: the login and the manifest stay capabilities', () => {
      const paths = operators().capabilities.map((c: any) => c.path)
      expect(paths.every((p: string) => p.startsWith('/system/users'))).toBe(true)
      const loose = (manifest.capabilities || []).map((c: any) => c.path)
      expect(loose).toEqual(expect.arrayContaining(['/system/auth/login', '/system/manifest']))
    })
  })

  describe('the two phases of a destruction (T-10.21)', () => {
    const tenants = () => manifest.resources.find((r: any) => r.name === 'tenant')
    const action = (name: string) => tenants().capabilities.find((c: any) => c.name === name)

    it('asks phase 2 for the token, the slug and the second factor, all three required', () => {
      // Two calls tied together: the token is shown once, and the second call wants it back
      // along with the slug typed by hand. Without an input the console has a button and no
      // dialog, which is T-10.21 in one sentence.
      expect(action('data').method).toBe('DELETE')
      expect(action('data').input.fields).toEqual([
        { name: 'token', type: 'string', required: true },
        { name: 'slug', type: 'string', required: true },
        { name: 'otp', type: 'string', required: true }
      ])
    })

    it('leaves phase 1 and the export without an input, because they take no body', () => {
      // An input here would be a promise the controller cannot keep: both read only the id in
      // the URL.
      expect(action('destruction-request').input).toBeUndefined()
      expect(action('export').input).toBeUndefined()
    })
  })
})
