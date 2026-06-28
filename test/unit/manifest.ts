/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { buildManifest } from '../../lib/manifest/generator.js'

const schemas: Record<string, any> = {
  vehicleBody: {
    $id: 'vehicleBody',
    type: 'object',
    required: ['name'],
    properties: {
      name: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'published'] },
      price: { type: 'number', minimum: 0 },
      password: { type: 'string' }
    }
  },
  vehicle: {
    $id: 'vehicle',
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      status: { type: 'string', enum: ['draft', 'published'] },
      price: { type: 'number' },
      externalId: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' }
    }
  }
}

const R = (method: string, path: string, doc: any = {}, resource?: any, group?: string) => ({
  method,
  path,
  roles: [{ code: 'admin' }],
  doc,
  resource,
  group
})

const routes: any[] = [
  R('GET', '/vehicles', { response: { 200: { $ref: 'vehicle#' } } }, { name: 'vehicle', titleField: 'name', globalSearch: ['name'] }, 'catalog'),
  R('GET', '/vehicles/:id', { response: { 200: { $ref: 'vehicle#' } } }, { name: 'vehicle' }),
  R('POST', '/vehicles', { body: { $ref: 'vehicleBody#' } }, { name: 'vehicle' }),
  R('PUT', '/vehicles/:id', { body: { $ref: 'vehicleBody#' } }, { name: 'vehicle' }),
  R('DELETE', '/vehicles/:id', {}, { name: 'vehicle' }),
  R('DELETE', '/vehicles', {}, { name: 'vehicle' }),
  R('GET', '/vehicles/count', {}, { name: 'vehicle' }),
  R('PATCH', '/vehicles/:id/status', {}, { name: 'vehicle' }),
  R('POST', '/public/sitemap/rebuild', {})
]

export default () => {
  describe('Manifest generator (v2)', () => {
    const m = buildManifest({
      routes,
      schemas,
      options: { authMode: 'bearer', generatedAt: '2026-01-01T00:00:00.000Z' }
    })
    const vehicle = m.resources.find((r) => r.name === 'vehicle')!
    const capName = (n: string) => vehicle.capabilities.find((c) => c.name === n)
    const fieldName = (n: string) => vehicle.fields.find((f) => f.name === n)

    it('emits a v2 manifest with the given metadata', () => {
      expect(m.version).toBe(2)
      expect(m.generatedAt).toBe('2026-01-01T00:00:00.000Z')
      expect(m.auth.mode).toBe('bearer')
      expect(m.tenancy.mode).toBe('single')
    })

    it('builds the resource from the route hints', () => {
      expect(vehicle).toBeDefined()
      expect(vehicle.path).toBe('vehicles')
      expect(vehicle.group).toBe('catalog')
      expect(vehicle.titleField).toBe('name')
      expect(vehicle.search).toEqual({ fields: ['name'], operator: 'containsi' })
    })

    it('derives CRUD capabilities (deduped) + custom actions', () => {
      for (const k of ['list', 'read', 'create', 'update', 'delete']) {
        expect(capName(k)?.kind).toBe(k)
      }
      // both item and collection delete present -> target row + bulk, single capability
      expect(vehicle.capabilities.filter((c) => c.kind === 'delete')).toHaveLength(1)
      expect(capName('delete')?.target).toEqual(['row', 'bulk'])
      expect(capName('delete')?.path).toBe('/vehicles/:id')
      // custom action from /vehicles/:id/status
      const status = capName('status')
      expect(status?.kind).toBe('action')
      expect(status?.method).toBe('PATCH')
      expect(status?.target).toEqual(['row'])
      // roles carried through
      expect(capName('list')?.roles).toEqual(['admin'])
    })

    it('ignores the /count helper route', () => {
      expect(vehicle.capabilities.some((c) => c.path.endsWith('/count'))).toBe(false)
    })

    it('collapses body + response onto canonical fields with types', () => {
      expect(fieldName('name')?.type).toBe('string')
      expect(fieldName('name')?.required).toBe(true)
      expect(fieldName('status')?.type).toBe('enum')
      expect(fieldName('status')?.enum?.map((e) => e.value)).toEqual(['draft', 'published'])
      expect(fieldName('email')?.type).toBe('email')
      expect(fieldName('createdAt')?.type).toBe('datetime')
      expect(fieldName('id')?.type).toBe('uuid')
      expect(fieldName('price')?.validation).toEqual({ min: 0 })
    })

    it('marks response-only fields read-only', () => {
      expect(fieldName('createdAt')?.readOnly).toBe(true)
      expect(fieldName('id')?.readOnly).toBe(true)
      expect(fieldName('name')?.readOnly).toBeUndefined() // in body too
    })

    it('applies the sensitive policy (password write-only, externalId excluded)', () => {
      // password is in the body (write) but must never be readable
      expect(fieldName('password')).toBeDefined()
      expect(fieldName('password')?.readOnly).toBeUndefined()
      // externalId is always excluded
      expect(fieldName('externalId')).toBeUndefined()
    })

    it('classifies non-CRUD segments as top-level operation sections', () => {
      const ops = m.capabilities || []
      const rebuild = ops.find((c) => c.path === '/public/sitemap/rebuild')
      expect(rebuild?.kind).toBe('action')
      expect(rebuild?.target).toEqual(['collection'])
      // and it is NOT a resource
      expect(m.resources.some((r) => r.name === 'public')).toBe(false)
    })
  })
}
