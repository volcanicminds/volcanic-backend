/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: the admin manifest, 350 lines with no test.
//
// It is what an admin console renders from: the resources it shows, the fields it puts on a
// form, the capabilities it gates buttons with. A wrong manifest does not throw — it draws a
// form without a field, or draws one WITH a field that should never leave the server, and the
// second of those is the reason these tests exist. `password` may be written and never read;
// `mfaSecret`, `token`, `resetPasswordToken` and `confirmationToken` must appear nowhere at all.
//
// It reads `global.routes` and the registered JSON Schemas and touches no database, so it can
// be exercised directly on the shapes the router produces.
//
import { expect } from 'expect'
import { buildManifest, tenancyOf } from '../../lib/manifest/generator.js'

;(global as any).log = {}

const productSchema = {
  $id: 'productSchema',
  type: 'object',
  required: ['name'],
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string', minLength: 2, maxLength: 80 },
    price: { type: 'number', minimum: 0 },
    stock: { type: 'integer' },
    active: { type: 'boolean' },
    status: { type: 'string', enum: ['draft', 'published'] },
    email: { type: 'string', format: 'email' },
    site: { type: 'string', format: 'uri' },
    createdAt: { type: 'string', format: 'date-time' },
    meta: { type: 'object' },
    // Never read, never listed, never on a form.
    mfaSecret: { type: 'string' },
    token: { type: 'string' },
    // Written on a form, never read back.
    password: { type: 'string' }
  }
}

const route = (over: any) => ({
  method: 'GET',
  path: '/products',
  roles: [{ code: 'admin' }],
  doc: {},
  ...over
})

const CRUD = [
  route({ method: 'GET', path: '/products', doc: { response: { 200: { type: 'array', items: { $ref: 'productSchema#' } } } } }),
  route({ method: 'GET', path: '/products/count' }),
  route({ method: 'GET', path: '/products/:id', doc: { response: { 200: { $ref: 'productSchema#' } } } }),
  route({ method: 'POST', path: '/products', doc: { body: { $ref: 'productSchema#' } } }),
  route({ method: 'PUT', path: '/products/:id', doc: { body: { $ref: 'productSchema#' } } }),
  route({ method: 'DELETE', path: '/products/:id' })
]

const build = (routes: any[] = CRUD, options: any = {}) =>
  buildManifest({ routes: routes as any, schemas: { productSchema }, options })

const resourceOf = (m: any, name = 'products') => m.resources.find((r: any) => r.name === name)
const fieldNames = (m: any, name = 'products') => resourceOf(m, name).fields.map((f: any) => f.name)
const fieldOf = (m: any, field: string, name = 'products') => resourceOf(m, name).fields.find((f: any) => f.name === field)

describe('manifest · resources and capabilities (T-9.5)', () => {
  it('groups routes into one resource by their first path segment', () => {
    const m = build()
    expect(m.version).toBe(2)
    expect(m.resources.map((r: any) => r.name)).toEqual(['products'])
    // The segment, without a leading slash: the console composes it as `<apiUrl>/<path>` (plus an
    // optional prefix), so a leading slash here would produce `//products`.
    expect(resourceOf(m).path).toBe('products')
  })

  it('names each CRUD capability by what it is, not by its method', () => {
    // The console gates a button on `update`, not on "the PUT one": a capability named after
    // the verb would move every time a route did.
    const m = build()
    const kinds = resourceOf(m).capabilities.map((c: any) => c.kind)
    expect(kinds.sort()).toEqual(['create', 'delete', 'list', 'read', 'update'])
  })

  it('leaves /count out: it is pagination plumbing, not something to render', () => {
    const m = build()
    const names = resourceOf(m).capabilities.map((c: any) => c.name)
    expect(names).not.toContain('count')
  })

  it('binds delete to the item path when both a row and a bulk delete exist', () => {
    // `DELETE /products` and `DELETE /products/:id` are two different buttons, and a console
    // that bound the row button to the collection path deletes everything.
    const m = build([...CRUD, route({ method: 'DELETE', path: '/products' })])
    const del = resourceOf(m).capabilities.find((c: any) => c.kind === 'delete')
    expect(del.path).toBe('/products/:id')
  })

  it('reports a custom action under the name of its last named segment', () => {
    const m = build([...CRUD, route({ method: 'POST', path: '/products/:id/publish' })])
    const action = resourceOf(m).capabilities.find((c: any) => c.kind === 'action')
    expect(action.name).toBe('publish')
    expect(action.method).toBe('POST')
  })

  it('carries the roles of each route, so the console hides what a user cannot call', () => {
    const m = build([
      ...CRUD,
      route({ method: 'POST', path: '/products/:id/publish', roles: [{ code: 'editor' }, { code: 'admin' }] })
    ])
    const action = resourceOf(m).capabilities.find((c: any) => c.name === 'publish')
    expect(action.roles.sort()).toEqual(['admin', 'editor'])
  })
})

describe('manifest · fields, and what never leaves the server (T-9.5)', () => {
  it('maps every JSON Schema shape to the widget type the console expects', () => {
    const m = build()
    const type = (f: string) => fieldOf(m, f)?.type

    expect(type('name')).toBe('string')
    expect(type('price')).toBe('number')
    expect(type('stock')).toBe('integer')
    expect(type('active')).toBe('boolean')
    expect(type('status')).toBe('enum')
    expect(type('email')).toBe('email')
    expect(type('site')).toBe('url')
    expect(type('id')).toBe('uuid')
    expect(type('createdAt')).toBe('datetime')
    expect(type('meta')).toBe('json')
  })

  it('never emits a field that must not leave the server', () => {
    // The reason this file exists. A console rendering `mfaSecret` on a detail page has
    // published a second factor to whoever can read the page.
    const names = fieldNames(build())
    for (const secret of ['mfaSecret', 'token']) expect(names).not.toContain(secret)
  })

  it('keeps a write-only field on the form and out of every response', () => {
    // `password` has to be on the create form and must never come back in a response, and the
    // generator expresses that by adding it from the WRITE side only. Dropping it would make
    // the form unusable; adding it from the read side would put a hash in a list.
    const password = fieldOf(build(), 'password')
    expect(password).toBeTruthy()
    // Not read-only: read-only is the opposite property, and it is what a field the server
    // only ever sends gets.
    expect(password.readOnly).toBeFalsy()
    // And it says so out loud, because a console cannot infer it. Without the flag `password` is
    // indistinguishable from a field the server simply never filled in, so the console draws a
    // column of empty cells and a detail row that can never have a value: exactly what the
    // platform console did until this was emitted.
    expect(password.writeOnly).toBe(true)
  })

  it('marks a field the schema requires, so the form does not have to guess', () => {
    expect(fieldOf(build(), 'name').required).toBe(true)
    expect(fieldOf(build(), 'price').required).toBeFalsy()
  })

  it('carries the validation the schema already states, instead of restating it in the console', () => {
    const name = fieldOf(build(), 'name')
    expect(name.validation).toEqual({ minLength: 2, maxLength: 80 })
    expect(fieldOf(build(), 'price').validation).toEqual({ min: 0 })
  })

  it('lists the values of an enum with a label each', () => {
    const status = fieldOf(build(), 'status')
    expect(status.enum.map((e: any) => e.value)).toEqual(['draft', 'published'])
    for (const entry of status.enum) expect(typeof entry.label).toBe('string')
  })

  it('marks a field that only ever appears in a response as read-only', () => {
    // `id` and `createdAt` are in the read schema and in the body schema here, so the
    // interesting case is built explicitly: a field the server sends and never accepts.
    const readOnlySchema = {
      $id: 'readOnlySchema',
      type: 'object',
      properties: { id: { type: 'string' }, computed: { type: 'string' } }
    }
    const writeSchema = { $id: 'writeSchema', type: 'object', properties: { id: { type: 'string' } } }

    const m = buildManifest({
      routes: [
        route({ method: 'GET', path: '/things/:id', doc: { response: { 200: { $ref: 'readOnlySchema#' } } } }),
        route({ method: 'PUT', path: '/things/:id', doc: { body: { $ref: 'writeSchema#' } } })
      ] as any,
      schemas: { readOnlySchema, writeSchema },
      options: {}
    })

    expect(fieldOf(m, 'computed', 'things').readOnly).toBe(true)
    expect(fieldOf(m, 'computed', 'things').writeOnly).toBeFalsy()
    // `id` travels in both directions, so it is neither: the two flags are not each other's
    // negation, and a field that is plainly readable and writable carries no flag at all.
    expect(fieldOf(m, 'id', 'things').readOnly).toBeFalsy()
    expect(fieldOf(m, 'id', 'things').writeOnly).toBeFalsy()
  })

  it('honours a caller who redefines what counts as sensitive', () => {
    // A consuming project has its own secrets, and the alternative to this option is forking
    // the generator.
    const m = build(CRUD, { sensitiveAlways: ['price'], sensitiveWriteOnly: [] })
    const names = fieldNames(m)
    expect(names).not.toContain('price')
    // And the defaults are replaced, not merged: the caller said what the list is.
    expect(names).toContain('mfaSecret')
  })
})

describe('manifest · the envelope the console reads first (T-9.5)', () => {
  it('reports the auth mode and endpoints it was given', () => {
    const m = build(CRUD, {
      authMode: 'cookie',
      authEndpoints: { login: '/auth/login', refresh: '/auth/refresh-token', logout: '/auth/logout' }
    })
    expect(m.auth.mode).toBe('cookie')
    expect(m.auth.endpoints.login).toBe('/auth/login')
  })

  it('reports single tenancy by default, and multi when it is told', () => {
    expect(build().tenancy.mode).toBe('single')
    const multi = build(CRUD, { tenancy: { mode: 'multi', header: 'x-tenant-id', switchable: true } })
    expect(multi.tenancy).toEqual({ mode: 'multi', header: 'x-tenant-id', switchable: true })
  })

  //
  // T-10.5: what the LIVE manifest says about tenancy is asked the way the router, the hooks
  // and the data layer ask it. Before, a `tenants` block with no strategy booted single
  // tenant and was announced as multi, so a console drew a switcher for a header nobody read.
  //
  describe('tenancy of the live manifest (T-10.5)', () => {
    const withTenants = (tenants: any) => {
      ;(global as any).config = { options: { tenants } }
    }
    afterEach(() => {
      ;(global as any).config = undefined
    })

    it('is single when no tenants block is declared', () => {
      withTenants(null)
      expect(tenancyOf()).toEqual({ mode: 'single' })
    })

    it('is single when the block is declared without a strategy, because that is how it boots', () => {
      withTenants({ resolver: 'header', headerKey: 'x-tenant-id' })
      expect(tenancyOf()).toEqual({ mode: 'single' })
    })

    it('names the header the backend actually reads, and offers no switcher (T-10.15)', () => {
      // From the login on the token binds the tenant (T-3.2): another tenant under the same
      // session is TENANT_MISMATCH, so a console switches by signing in again. The list the
      // switcher read, `/tenants`, is a control route no customer user can call either.
      withTenants({ strategy: 'schema', resolver: 'header', headerKey: 'x-org' })
      expect(tenancyOf()).toEqual({ mode: 'multi', switchable: false, header: 'x-org' })
    })

    it('names no header on the control plane, where there is no tenant to declare (T-10.14)', () => {
      withTenants({ strategy: 'schema', resolver: 'header', headerKey: 'x-org' })
      expect(tenancyOf('control')).toEqual({ mode: 'multi', switchable: false })
    })

    it('offers no switcher and no header when the host is the tenant', () => {
      withTenants({ strategy: 'schema', resolver: 'subdomain' })
      const tenancy = tenancyOf()
      expect(tenancy.mode).toBe('multi')
      expect(tenancy.switchable).toBe(false)
      expect(tenancy.header).toBeUndefined()
    })
  })

  describe('one console, one plane (T-10.14)', () => {
    // The router resolves `scope: 'control'` into `tenantContext: false`.
    const PLANES = [
      ...CRUD.map((r) => ({ ...r, tenantContext: true })),
      route({ method: 'GET', path: '/tenants', tenantContext: false, roles: [{ code: 'system:admin' }] }),
      route({ method: 'POST', path: '/tenants', tenantContext: false, roles: [{ code: 'system:admin' }] })
    ]
    const names = (m: any) => m.resources.map((r: any) => r.name).sort()

    it('describes only the tenant routes to a tenant console when the planes are split', () => {
      const m = build(PLANES, { splitPlanes: true, plane: 'tenant' })
      // A customer's users must not receive the platform's route map and role codes.
      expect(names(m)).toEqual(['products'])
      expect(m.auth.plane).toBe('tenant')
      expect(m.auth.endpoints.login).toBe('/auth/login')
      // T-11.18: the console reads where its own devices are listed instead of knowing the path.
      expect(m.auth.endpoints.sessions).toBe('/auth/sessions')
    })

    it('describes only the control routes to the platform console, with the platform auth routes', () => {
      const m = build(PLANES, { splitPlanes: true, plane: 'control' })
      expect(names(m)).toEqual(['tenants'])
      expect(m.auth.plane).toBe('control')
      // The tenant login resolves users inside a container: an operator is not there.
      expect(m.auth.endpoints).toMatchObject({
        login: '/system/auth/login',
        refresh: '/system/auth/refresh-token',
        logout: '/system/auth/logout',
        me: '/system/auth/me',
        mfaVerify: '/system/auth/mfa/verify',
        // The platform sessions are their own list: an operator closing a device must not be
        // pointed at the tenant route, which resolves users inside a container.
        sessions: '/system/auth/sessions'
      })
    })

    it('filters nothing where the two planes are one identity space', () => {
      // Without tenants a control route authenticates the application's own users, so leaving
      // it out would hide screens those users can open.
      expect(names(build(PLANES, { splitPlanes: false }))).toEqual(['products', 'tenants'])
      expect(build(PLANES).auth.plane).toBe('tenant')
    })
  })

  it('stamps when it was generated, so a stale manifest is visible', () => {
    const at = '2026-09-10T12:00:00.000Z'
    expect(build(CRUD, { generatedAt: at }).generatedAt).toBe(at)
    expect(new Date(build().generatedAt).getTime()).not.toBeNaN()
  })

  it('collects the groups the routes declare, once each', () => {
    const m = build([
      route({ method: 'GET', path: '/products', group: 'catalog' }),
      route({ method: 'GET', path: '/brands', group: 'catalog' })
    ])
    expect(m.groups.map((g: any) => g.name)).toEqual(['catalog'])
  })

  describe('the input of a custom action (T-10.16)', () => {
    const impersonateSchema = {
      $id: 'impersonateSchema',
      type: 'object',
      required: ['userId'],
      properties: { userId: { type: 'string' }, reason: { type: 'string' }, ttl: { type: 'integer' } }
    }
    const destroySchema = {
      $id: 'destroySchema',
      type: 'object',
      properties: { token: { type: 'string' }, slug: { type: 'string' }, otp: { type: 'string' } }
    }
    const withActions = (actions: any[]) =>
      buildManifest({
        routes: [...CRUD, ...actions] as any,
        schemas: { productSchema, impersonateSchema, destroySchema },
        options: {}
      })
    const actionOf = (m: any, name: string) => resourceOf(m).capabilities.find((c: any) => c.name === name)

    it('derives the fields and their types from the body schema the route validates', () => {
      const m = withActions([
        route({ method: 'POST', path: '/products/:id/impersonate', doc: { body: { $ref: 'impersonateSchema#' } } })
      ])
      expect(actionOf(m, 'impersonate').input).toEqual({
        fields: [
          { name: 'userId', type: 'string', required: true },
          { name: 'reason', type: 'string' },
          { name: 'ttl', type: 'integer' }
        ]
      })
    })

    it('lets the route hint add presentation, exclusions and a required the controller enforces', () => {
      const m = withActions([
        route({
          method: 'POST',
          path: '/products/:id/impersonate',
          doc: { body: { $ref: 'impersonateSchema#' } },
          input: {
            exclude: ['ttl'],
            fields: { reason: { required: true, widget: 'textarea', label: 'input.reason' } },
            submitLabel: 'action.impersonate.go'
          }
        })
      ])
      expect(actionOf(m, 'impersonate').input).toEqual({
        fields: [
          { name: 'userId', type: 'string', required: true },
          { name: 'reason', type: 'string', required: true, widget: 'textarea', label: 'input.reason' }
        ],
        submitLabel: 'action.impersonate.go'
      })
    })

    it('asks for the destruction token: an input is typed, never read back, so nothing is filtered', () => {
      const m = withActions([route({ method: 'DELETE', path: '/products/:id/data', doc: { body: { $ref: 'destroySchema#' } } })])
      expect(actionOf(m, 'data').input.fields.map((f: any) => f.name)).toEqual(['token', 'slug', 'otp'])
    })

    it('describes no input for an action without a body, and none for CRUD', () => {
      const m = withActions([route({ method: 'POST', path: '/products/:id/publish' })])
      expect(actionOf(m, 'publish').input).toBeUndefined()
      for (const cap of resourceOf(m).capabilities.filter((c: any) => c.kind !== 'action')) {
        expect(cap.input).toBeUndefined()
      }
    })
  })

  it('survives a route whose schema is missing, instead of failing the whole manifest', () => {
    // One resource with a broken $ref must not cost the console every other resource.
    const m = build([...CRUD, route({ method: 'GET', path: '/ghosts', doc: { response: { 200: { $ref: 'nowhere#' } } } })])
    expect(m.resources.map((r: any) => r.name).sort()).toEqual(['ghosts', 'products'])
    expect(resourceOf(m, 'ghosts').fields).toEqual([])
  })
})

//
// T-10.20: a resource does not always begin at the first segment.
//
// The platform's operators live at `/system/users`, and `system` is shared with the platform
// login and the console manifest. Grouped on that first segment they are not a resource at all:
// six methods on one table land among the loose capabilities, and the console has no screen for
// deciding who administers the platform.
//
describe('manifest · a resource declared under a longer prefix (T-10.20)', () => {
  const hint = { prefix: 'system/users', name: 'systemUser', titleField: 'email' }
  const op = (over: any) => route({ resource: hint, ...over })

  const OPERATORS = [
    op({ path: '/system/users', doc: { response: { 200: { type: 'array', items: { $ref: 'productSchema#' } } } } }),
    op({ path: '/system/users/count' }),
    op({ path: '/system/users/:id', doc: { response: { 200: { $ref: 'productSchema#' } } } }),
    op({ method: 'POST', path: '/system/users', doc: { body: { $ref: 'productSchema#' } } }),
    op({ method: 'PUT', path: '/system/users/:id' }),
    op({ method: 'DELETE', path: '/system/users/:id' }),
    op({ method: 'POST', path: '/system/users/:id/block' }),
    op({ method: 'POST', path: '/system/users/:id/mfa/reset' })
  ]
  // The rest of the same first segment: no prefix declared, so they group as they always did.
  const REST = [route({ method: 'POST', path: '/system/auth/login' }), route({ path: '/system/manifest' })]
  const all = () => build([...OPERATORS, ...REST])

  it('groups on the declared prefix and gives the routes the shape of a resource', () => {
    const operators = resourceOf(all(), 'systemUser')
    expect(operators.path).toBe('system/users')
    expect(operators.titleField).toBe('email')
    const kinds = operators.capabilities.filter((c: any) => c.kind !== 'action').map((c: any) => c.kind)
    expect(kinds.sort()).toEqual(['create', 'delete', 'list', 'read', 'update'])
    // The fields are collected the same way: a resource under a prefix is a resource.
    expect(operators.fields.map((f: any) => f.name)).toContain('name')
  })

  it('reads every path from the end of the prefix, so /system/users/:id is an item', () => {
    const operators = resourceOf(all(), 'systemUser')
    expect(operators.capabilities.find((c: any) => c.kind === 'read').path).toBe('/system/users/:id')
    const actions = operators.capabilities.filter((c: any) => c.kind === 'action')
    expect(actions.map((a: any) => a.name).sort()).toEqual(['block', 'reset'])
    // Two segments deep and still a row action: the console draws it on the record, not on the
    // list, which is the difference between resetting one operator's factor and everyone's.
    expect(actions.find((a: any) => a.name === 'block').target).toEqual(['row'])
    expect(operators.capabilities.map((c: any) => c.name)).not.toContain('count')
  })

  it('leaves the rest of the first segment out of the resource', () => {
    const m = all()
    expect(m.resources.map((r: any) => r.name)).toEqual(['systemUser'])
    expect(resourceOf(m, 'systemUser').capabilities.every((c: any) => c.path.startsWith('/system/users'))).toBe(true)
    // The login and the manifest are no CRUD, so they stay loose capabilities, as before.
    expect((m.capabilities || []).map((c: any) => c.name).sort()).toEqual(['login', 'manifest'])
  })

  it('ignores a prefix the path does not start with, and groups by the URL', () => {
    // The router serves the URL; a hint that disagreed with it would file the route under a
    // resource whose every call is a 404.
    const m = build([...CRUD, route({ method: 'POST', path: '/products/:id/audit', resource: { prefix: 'system/users' } })])
    expect(m.resources.map((r: any) => r.name)).toEqual(['products'])
    expect(resourceOf(m).capabilities.map((c: any) => c.name)).toContain('audit')
  })
})
