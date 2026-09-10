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
import { buildManifest } from '../../lib/manifest/generator.js'

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
    // The segment, without a leading slash: the console composes it under its own base path
    // (`/admin/<path>`), so a leading slash here would produce `//products`.
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
    expect(fieldOf(m, 'id', 'things').readOnly).toBeFalsy()
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

  it('survives a route whose schema is missing, instead of failing the whole manifest', () => {
    // One resource with a broken $ref must not cost the console every other resource.
    const m = build([...CRUD, route({ method: 'GET', path: '/ghosts', doc: { response: { 200: { $ref: 'nowhere#' } } } })])
    expect(m.resources.map((r: any) => r.name).sort()).toEqual(['ghosts', 'products'])
    expect(resourceOf(m, 'ghosts').fields).toEqual([])
  })
})
