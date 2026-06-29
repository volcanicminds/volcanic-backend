/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Admin Manifest generator (v2) — schema-only, core, no data-layer access.
 *
 * Composes a Manifest from `global.routes` (BE-1/BE-2) + the registered JSON Schemas
 * (`server.getSchemas()`). Contract: `manifest.v2.schema.json` in @volcanicminds/admin
 * (see MANIFEST_DESIGN.md §2/§3). Relations are emitted "magre" (no kind/foreignKey:
 * enriched via admin overrides). First cut — type breadth/relation detection is hardened
 * by BE-7 tests.
 */
import type { ConfiguredRoute, ResourceHints } from '../../types/global.js'

// ── Output types (mirror the v2 JSON Schema; the engine owns the canonical TS type) ──
type CapabilityKind = 'list' | 'read' | 'create' | 'update' | 'delete' | 'action'
type FieldType =
  | 'string' | 'text' | 'richtext' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime'
  | 'enum' | 'relation' | 'email' | 'url' | 'uuid' | 'json' | 'image' | 'file'

export interface CapabilitySpec {
  name: string
  kind: CapabilityKind
  method: string
  path: string
  roles: string[]
  label?: string
  target?: ('row' | 'bulk' | 'collection')[]
}
export interface FieldSpec {
  name: string
  type: FieldType
  required?: boolean
  readOnly?: boolean
  enum?: { value: string; label: string }[]
  validation?: Record<string, any>
}
export interface ResourceSpec {
  name: string
  path: string
  label: { singular: string; plural: string }
  group?: string
  titleField?: string | string[]
  subtitleField?: string | string[]
  capabilities: CapabilitySpec[]
  search?: { fields: string[]; operator?: string }
  fields: FieldSpec[]
}
export interface Manifest {
  version: 2
  generatedAt: string
  i18n: { defaultLocale: string; locales: string[] }
  auth: { mode: 'cookie' | 'bearer'; endpoints: { login: string; refresh: string; logout: string; [k: string]: string } }
  tenancy: { mode: 'single' | 'multi'; switchable?: boolean; header?: string; listEndpoint?: string }
  groups: { name: string; label: string }[]
  enums: Record<string, { value: string; label: string }[]>
  resources: ResourceSpec[]
  capabilities?: CapabilitySpec[]
}

// Sensitive fields: never exposed vs write-only (form only, never read/list).
const SENSITIVE_ALWAYS = ['token', 'externalId', 'mfaSecret', 'refreshToken', 'resetPasswordToken', 'confirmationToken']
const SENSITIVE_WRITE_ONLY = ['password']

export interface BuildOptions {
  authMode?: 'cookie' | 'bearer'
  tenancy?: Manifest['tenancy']
  i18n?: Manifest['i18n']
  authEndpoints?: Manifest['auth']['endpoints']
  generatedAt?: string
  sensitiveAlways?: string[]
  sensitiveWriteOnly?: string[]
}

function segments(p: string): string[] {
  return (p || '').split('/').filter(Boolean)
}

function rolesOf(route: ConfiguredRoute): string[] {
  const rs = (route.roles || []) as any[]
  return [...new Set(rs.map((r) => (r && typeof r === 'object' ? r.code : String(r))).filter(Boolean))]
}

/** Resolve a (possibly $ref) schema against the registered schema map. */
function deref(schema: any, schemas: Record<string, any>, depth = 0): any {
  if (!schema || depth > 10) return schema || null
  if (typeof schema === 'object' && schema.$ref) {
    const id = String(schema.$ref).replace(/#.*$/, '')
    const found =
      schemas[id] || schemas[`${id}#`] || Object.values(schemas).find((s: any) => s && (s.$id === id || s.$id === `${id}#`))
    return found ? deref(found, schemas, depth + 1) : null
  }
  // list responses: unwrap arrays to their item schema
  if (schema.type === 'array' && schema.items) return deref(schema.items, schemas, depth + 1)
  return schema
}

function mapType(ps: any): FieldType {
  if (!ps) return 'string'
  if (Array.isArray(ps.enum) && ps.enum.length) return 'enum'
  switch (ps.type) {
    case 'integer':
      return 'integer'
    case 'number':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'array':
    case 'object':
      return 'json'
    case 'string':
      switch (ps.format) {
        case 'email':
          return 'email'
        case 'uri':
        case 'url':
          return 'url'
        case 'uuid':
          return 'uuid'
        case 'date-time':
          return 'datetime'
        case 'date':
          return 'date'
        default:
          return 'string'
      }
    default:
      return 'string'
  }
}

function validationOf(ps: any): Record<string, any> | undefined {
  const v: Record<string, any> = {}
  if (typeof ps.minimum === 'number') v.min = ps.minimum
  if (typeof ps.maximum === 'number') v.max = ps.maximum
  if (typeof ps.minLength === 'number') v.minLength = ps.minLength
  if (typeof ps.maxLength === 'number') v.maxLength = ps.maxLength
  if (typeof ps.pattern === 'string') v.pattern = ps.pattern
  return Object.keys(v).length ? v : undefined
}

interface FieldAcc extends FieldSpec {
  _read?: boolean
  _write?: boolean
}

/** Map a CRUD verb (or null for a custom action) from method + relative path. */
function crudKind(method: string, rest: string[]): CapabilityKind | null {
  if (rest.length === 0) {
    if (method === 'GET') return 'list'
    if (method === 'POST') return 'create'
    if (method === 'DELETE') return 'delete'
    return null
  }
  if (rest.length === 1 && rest[0].startsWith(':')) {
    if (method === 'GET') return 'read'
    if (method === 'PUT' || method === 'PATCH') return 'update'
    if (method === 'DELETE') return 'delete'
    return null
  }
  return null
}

export function buildManifest(input: {
  routes: ConfiguredRoute[]
  schemas: Record<string, any>
  options?: BuildOptions
}): Manifest {
  const { routes = [], schemas = {}, options = {} } = input
  const sensitiveAlways = options.sensitiveAlways ?? SENSITIVE_ALWAYS
  const sensitiveWriteOnly = options.sensitiveWriteOnly ?? SENSITIVE_WRITE_ONLY

  // group routes by URL base segment
  const bySegment = new Map<string, ConfiguredRoute[]>()
  for (const r of routes) {
    const segs = segments(r.path)
    if (!segs.length) continue
    const base = segs[0]
    if (!bySegment.has(base)) bySegment.set(base, [])
    bySegment.get(base)!.push(r)
  }

  const resources: ResourceSpec[] = []
  const topCapabilities: CapabilitySpec[] = []
  const groupNames = new Set<string>()

  for (const [base, segRoutes] of bySegment) {
    const hint: ResourceHints | undefined = segRoutes.find((r) => r.resource)?.resource
    const name = hint?.name || base
    const group = segRoutes.find((r) => r.group)?.group
    if (group) groupNames.add(group)

    // capabilities (CRUD deduped by kind + custom actions)
    const crud = new Map<CapabilityKind, CapabilitySpec>()
    const actions: CapabilitySpec[] = []
    const usedNames = new Set<string>()
    let hasItemDelete = false
    let hasCollDelete = false
    for (const r of segRoutes) {
      const rest = segments(r.path).slice(1)
      if (rest[rest.length - 1] === 'count') continue // internal pagination helper
      const kind = crudKind(r.method, rest)
      if (kind) {
        if (kind === 'delete') {
          if (rest.length === 0) hasCollDelete = true
          else hasItemDelete = true
        }
        // prefer the item path (/:id) for the delete capability binding
        if (!crud.has(kind) || (kind === 'delete' && rest.length === 1)) {
          crud.set(kind, { name: kind, kind, method: r.method, path: r.path, roles: rolesOf(r) })
        }
      } else {
        const lastNamed = [...rest].reverse().find((s) => !s.startsWith(':'))
        let actName = lastNamed || r.method.toLowerCase()
        while (usedNames.has(actName)) actName = `${actName}_${r.method.toLowerCase()}`
        usedNames.add(actName)
        actions.push({
          name: actName,
          kind: 'action',
          method: r.method,
          path: r.path,
          roles: rolesOf(r),
          label: `action.${name}.${actName}`,
          target: rest.some((s) => s.startsWith(':')) ? ['row'] : ['collection']
        })
      }
    }
    const del = crud.get('delete')
    if (del) {
      const t: ('row' | 'bulk')[] = []
      if (hasItemDelete) t.push('row')
      if (hasCollDelete) t.push('bulk')
      if (t.length) del.target = t
    }
    const caps: CapabilitySpec[] = [...crud.values(), ...actions]

    const isResource = crud.size > 0
    if (!isResource) {
      topCapabilities.push(...caps)
      continue
    }

    // fields — collapse body (writable) + response (readable) onto (resource, field)
    const fields = collectFields(segRoutes, schemas, sensitiveAlways, sensitiveWriteOnly)

    const resource: ResourceSpec = {
      name,
      path: base,
      label: { singular: `res.${name}.singular`, plural: `res.${name}.plural` },
      capabilities: caps,
      fields
    }
    if (group) resource.group = group
    if (hint?.titleField) resource.titleField = hint.titleField
    if (hint?.subtitleField) resource.subtitleField = hint.subtitleField
    if (hint?.globalSearch?.length) resource.search = { fields: hint.globalSearch, operator: 'containsi' }
    resources.push(resource)
  }

  const manifest: Manifest = {
    version: 2,
    generatedAt: options.generatedAt || '1970-01-01T00:00:00.000Z',
    i18n: options.i18n || { defaultLocale: 'en', locales: ['en'] },
    auth: {
      mode: options.authMode || 'bearer',
      endpoints: options.authEndpoints || { login: '/auth/login', refresh: '/auth/refresh-token', logout: '/auth/logout' }
    },
    tenancy: options.tenancy || { mode: 'single' },
    groups: [...groupNames].map((n) => ({ name: n, label: `group.${n}` })),
    enums: {},
    resources
  }
  if (topCapabilities.length) manifest.capabilities = topCapabilities
  return manifest
}

function collectFields(
  segRoutes: ConfiguredRoute[],
  schemas: Record<string, any>,
  sensitiveAlways: string[],
  sensitiveWriteOnly: string[]
): FieldSpec[] {
  const byName = new Map<string, FieldAcc>()

  const addSide = (schema: any, side: 'read' | 'write') => {
    const s = deref(schema, schemas)
    const props = s?.properties
    if (!props) return
    const required: string[] = Array.isArray(s.required) ? s.required : []
    for (const [fname, ps] of Object.entries<any>(props)) {
      if (sensitiveAlways.includes(fname)) continue
      if (side === 'read' && sensitiveWriteOnly.includes(fname)) continue // never readable
      let f = byName.get(fname)
      if (!f) {
        f = { name: fname, type: mapType(ps) }
        byName.set(fname, f)
      }
      // a typed side wins over a bare 'string' fallback; merge validation/enum from either side
      if (f.type === 'string' && mapType(ps) !== 'string') f.type = mapType(ps)
      if (!f.validation) {
        const val = validationOf(ps)
        if (val) f.validation = val
      }
      if (!f.enum && Array.isArray(ps.enum) && ps.enum.length) {
        f.enum = ps.enum.map((v: any) => ({ value: String(v), label: `enum.${fname}.${v}` }))
      }
      if (required.includes(fname)) f.required = true
      if (side === 'read') f._read = true
      if (side === 'write') f._write = true
    }
  }

  for (const r of segRoutes) {
    const rest = segments(r.path).slice(1)
    const kind = crudKind(r.method, rest)
    // Write side: create/update bodies, plus a PUT/PATCH on the BASE path — the singleton
    // update (e.g. PUT /company), which crudKind classifies as 'action'. Restricted to the
    // base path so sub-route action payloads (e.g. /vehicles/:id/images/reorder) don't leak in.
    const isSingletonWrite = rest.length === 0 && (r.method === 'PUT' || r.method === 'PATCH')
    if (kind === 'create' || kind === 'update' || isSingletonWrite) addSide(r.doc?.body, 'write')
    if (kind === 'read' || kind === 'list') {
      const resp = r.doc?.response
      const schema = resp && typeof resp === 'object' && !resp.type && !resp.$ref ? resp['200'] || resp[200] || Object.values(resp)[0] : resp
      addSide(schema, 'read')
    }
  }

  const out: FieldSpec[] = []
  for (const f of byName.values()) {
    const { _read, _write, ...rest } = f
    if (_read && !_write) rest.readOnly = true
    out.push(rest)
  }
  return out
}

/** Build the manifest from the live server (`global.routes` + registered schemas). */
export function generateManifest(server: any, options: BuildOptions = {}): Manifest {
  const routes: ConfiguredRoute[] = ((global as any).routes as ConfiguredRoute[]) || []
  const schemas: Record<string, any> = typeof server?.getSchemas === 'function' ? server.getSchemas() : {}
  const authMode: 'cookie' | 'bearer' = process.env.AUTH_MODE === 'COOKIE' ? 'cookie' : 'bearer'
  const mt = (global as any).config?.options?.multi_tenant
  const tenancy: Manifest['tenancy'] = mt?.enabled
    ? { mode: 'multi', switchable: true, header: mt.header_key || 'x-tenant-id', listEndpoint: '/tenants' }
    : { mode: 'single' }
  return buildManifest({
    routes,
    schemas,
    options: { authMode, tenancy, generatedAt: new Date().toISOString(), ...options }
  })
}
