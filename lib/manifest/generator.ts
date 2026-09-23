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
import { tenantsConfig, isTenancyEnabled } from '../util/tenancy.js'
import { isCookieMode } from '../util/credential.js'

// ── Output types (mirror the v2 JSON Schema; the engine owns the canonical TS type) ──
type CapabilityKind = 'list' | 'read' | 'create' | 'update' | 'delete' | 'action'
// The first line is what `mapType` infers from JSON Schema. The second arrives only from admin
// overrides, because a schema cannot tell those apart from a string or an object: long and rich
// text are presentations, a relation needs its target and foreign key, an image or a file needs
// upload endpoints. Identical to `FieldType` in @volcanicminds/admin and to
// manifest.v2.schema.json (T-10.17).
type FieldType =
  | 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'email' | 'url' | 'uuid' | 'json'
  | 'text' | 'textarea' | 'richtext' | 'relation' | 'image' | 'file'

export interface CapabilitySpec {
  name: string
  kind: CapabilityKind
  method: string
  path: string
  roles: string[]
  label?: string
  target?: ('row' | 'bulk' | 'collection')[]
  /** What the action's dialog asks before calling it (T-10.16). Actions only, and only with a body. */
  input?: ActionInput
}
export interface ActionInputField {
  name: string
  type: FieldType
  label?: string
  widget?: string
  required?: boolean
  placeholder?: string
}
export interface ActionInput {
  fields: ActionInputField[]
  submitLabel?: string
}
export interface FieldSpec {
  name: string
  type: FieldType
  required?: boolean
  readOnly?: boolean
  /**
   * Written and never read back: it appears in a body schema and in no response.
   *
   * The opposite of `readOnly`, and it has to be said out loud. Without it a console cannot tell
   * `password` apart from a field the server simply never filled in, so it draws a column of
   * empty cells and a detail row that can never have a value. The form is the one place such a
   * field belongs.
   */
  writeOnly?: boolean
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
/** The identity space a console works in: a customer's users, or the platform's operators. */
export type Plane = 'tenant' | 'control'

export interface Manifest {
  version: 2
  generatedAt: string
  i18n: { defaultLocale: string; locales: string[] }
  auth: {
    mode: 'cookie' | 'bearer'
    plane: Plane
    endpoints: { flowOptions: string; flowStart: string; flowStep: string; refresh: string; logout: string; [k: string]: string }
  }
  tenancy: { mode: 'single' | 'multi'; switchable?: boolean; header?: string; listEndpoint?: string }
  groups: { name: string; label: string }[]
  enums: Record<string, { value: string; label: string }[]>
  resources: ResourceSpec[]
  capabilities?: CapabilitySpec[]
}

// Sensitive fields: never exposed vs write-only (form only, never read/list).
const SENSITIVE_ALWAYS = ['token', 'externalId', 'mfaSecret', 'refreshToken', 'resetPasswordToken', 'confirmationToken']
const SENSITIVE_WRITE_ONLY = ['password']

/** The login flow of a plane (F31): the routes a console drives, under the plane's prefix. */
const flowEndpoints = (prefix: string) => ({
  flowOptions: `${prefix}/flow/options`,
  flowStart: `${prefix}/flow/start`,
  flowStep: `${prefix}/flow/step`,
  flowChallenge: `${prefix}/flow/challenge`,
  flowCancel: `${prefix}/flow/cancel`
})

/**
 * The auth routes of each plane. A console that read the tenant ones on the control plane would
 * log an operator in as nobody: `/auth/flow/*` resolves users inside a container.
 *
 * There is no login route to name: a login is the flow, and `flowOptions` says which methods it
 * starts with. The second factor has no route of its own either; it is a stage of the flow.
 */
export const AUTH_ENDPOINTS: Record<Plane, Manifest['auth']['endpoints']> = {
  // `sessions` is announced rather than left to the console to know (T-11.18). The list of a
  // caller's own devices is not a resource of the manifest, because it is not a collection
  // anybody can query: it is the sessions of whoever is asking. So it travels here, where the
  // console already reads the routes it must not hardcode, and a build without a session
  // registry simply answers 404 on it.
  tenant: { ...flowEndpoints('/auth'), refresh: '/auth/refresh-token', logout: '/auth/logout', sessions: '/auth/sessions' },
  control: {
    ...flowEndpoints('/system/auth'),
    refresh: '/system/auth/refresh-token',
    logout: '/system/auth/logout',
    sessions: '/system/auth/sessions',
    me: '/system/auth/me',
    // Account management of an operator already logged in (F45), not a step of the login.
    mfaSetup: '/system/auth/mfa/setup',
    mfaEnable: '/system/auth/mfa/enable'
  }
}

export interface BuildOptions {
  /**
   * The plane of the console that reads this manifest (T-10.14). Default `tenant`. When the
   * planes are split, only that plane's routes are described and its auth routes are named.
   */
  plane?: Plane
  /**
   * Whether the two planes are distinct identity spaces, i.e. tenants are declared.
   * `generateManifest` reads it from the deployment; without it nothing is filtered, because
   * a deployment without tenants authenticates its own users on control routes too.
   */
  splitPlanes?: boolean
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

/**
 * The path a route's resource is grouped under (T-10.20).
 *
 * The first segment, unless the route declares a longer prefix. A prefix the path does not
 * actually start with is ignored rather than trusted: the URL is what the router serves, and a
 * hint that disagreed with it would file a route under a resource nobody can call.
 */
function resourceBase(route: ConfiguredRoute, segs: string[]): string {
  const declared = segments(route.resource?.prefix || '')
  if (declared.length && declared.every((s, i) => segs[i] === s)) return declared.join('/')
  return segs[0]
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
  const plane: Plane = options.plane ?? 'tenant'

  // One console, one plane (T-10.14). A route belongs to the control plane when the router
  // resolved `scope: 'control'` into `tenantContext: false`. Describing the other plane's routes
  // would hand a customer's users the platform's route map and role codes, and would draw
  // screens whose every call is refused with SCOPE_MISMATCH.
  const described = options.splitPlanes
    ? routes.filter((r) => (r.tenantContext === false ? 'control' : 'tenant') === plane)
    : routes

  // group routes by the path their resource lives under: the first URL segment, or the longer
  // prefix a route declares (T-10.20)
  const bySegment = new Map<string, ConfiguredRoute[]>()
  for (const r of described) {
    const segs = segments(r.path)
    if (!segs.length) continue
    const base = resourceBase(r, segs)
    if (!bySegment.has(base)) bySegment.set(base, [])
    bySegment.get(base)!.push(r)
  }

  const resources: ResourceSpec[] = []
  const topCapabilities: CapabilitySpec[] = []
  const groupNames = new Set<string>()

  for (const [base, segRoutes] of bySegment) {
    const hint: ResourceHints | undefined = segRoutes.find((r) => r.resource)?.resource
    const name = hint?.name || base
    // Everything below reads a path RELATIVE to the resource, so it counts from the end of the
    // base and not from the first segment: under a two-segment base `/system/users/:id` is an
    // item and not an unnamed action.
    const depth = segments(base).length
    const group = segRoutes.find((r) => r.group)?.group
    if (group) groupNames.add(group)

    // capabilities (CRUD deduped by kind + custom actions)
    const crud = new Map<CapabilityKind, CapabilitySpec>()
    const actions: CapabilitySpec[] = []
    const usedNames = new Set<string>()
    let hasItemDelete = false
    let hasCollDelete = false
    for (const r of segRoutes) {
      const rest = segments(r.path).slice(depth)
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
        const action: CapabilitySpec = {
          name: actName,
          kind: 'action',
          method: r.method,
          path: r.path,
          roles: rolesOf(r),
          label: `action.${name}.${actName}`,
          target: rest.some((s) => s.startsWith(':')) ? ['row'] : ['collection']
        }
        const input = inputOf(r, schemas)
        if (input) action.input = input
        actions.push(action)
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
    const fields = collectFields(segRoutes, schemas, sensitiveAlways, sensitiveWriteOnly, depth)

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
      // The framework default since T-10.37: a manifest built without saying otherwise
      // describes a deployment that keeps the session in a cookie.
      mode: options.authMode || 'cookie',
      plane,
      endpoints: options.authEndpoints || AUTH_ENDPOINTS[plane]
    },
    tenancy: options.tenancy || { mode: 'single' },
    groups: [...groupNames].map((n) => ({ name: n, label: `group.${n}` })),
    enums: {},
    resources
  }
  if (topCapabilities.length) manifest.capabilities = topCapabilities
  return manifest
}

/**
 * The input of a custom action, derived from the body schema of its route (T-10.16).
 *
 * The schema is the one description of the body that cannot drift from what the route accepts,
 * because it is what Fastify validates. Field names, types and the schema's `required` come from
 * it; the route's `config.manifest.input` hint adds presentation, exclusions, and `required` for a
 * field the controller refuses with its own code. No sensitive filter here, unlike `collectFields`:
 * an input is typed by the operator and never read back, and the destruction `token` is precisely
 * what the dialog has to ask for.
 */
function inputOf(route: ConfiguredRoute, schemas: Record<string, any>): ActionInput | undefined {
  const body = deref(route.doc?.body, schemas)
  const props = body?.properties
  if (!props || typeof props !== 'object') return undefined

  const hint = route.input
  const required: string[] = Array.isArray(body.required) ? body.required : []
  const excluded = new Set(hint?.exclude ?? [])
  const fields: ActionInputField[] = []

  for (const [name, ps] of Object.entries<any>(props)) {
    if (excluded.has(name)) continue
    const extra = hint?.fields?.[name] ?? {}
    const field: ActionInputField = { name, type: mapType(ps) }
    if (required.includes(name) || extra.required) field.required = true
    if (extra.widget) field.widget = extra.widget
    if (extra.label) field.label = extra.label
    if (extra.placeholder) field.placeholder = extra.placeholder
    fields.push(field)
  }

  if (!fields.length) return undefined
  return hint?.submitLabel ? { fields, submitLabel: hint.submitLabel } : { fields }
}

function collectFields(
  segRoutes: ConfiguredRoute[],
  schemas: Record<string, any>,
  sensitiveAlways: string[],
  sensitiveWriteOnly: string[],
  // How many segments of the path belong to the resource itself (T-10.20). Counted from the
  // wrong end, a resource under a prefix has no create and no list, so it draws a form with no
  // fields: not an error, just an empty screen.
  depth = 1
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
    const rest = segments(r.path).slice(depth)
    const kind = crudKind(r.method, rest)
    // Write side: create/update bodies, plus a PUT/PATCH on the BASE path — the singleton
    // update (e.g. PUT /company), which crudKind classifies as 'action'. Restricted to the
    // base path so sub-route action payloads (e.g. /posts/:id/attachments/reorder) don't leak in.
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
    if (_write && !_read) rest.writeOnly = true
    out.push(rest)
  }
  return out
}

/** Build the manifest from the live server (`global.routes` + registered schemas). */
export function generateManifest(server: any, options: BuildOptions = {}): Manifest {
  const routes: ConfiguredRoute[] = ((global as any).routes as ConfiguredRoute[]) || []
  const schemas: Record<string, any> = typeof server?.getSchemas === 'function' ? server.getSchemas() : {}
  const authMode: 'cookie' | 'bearer' = isCookieMode() ? 'cookie' : 'bearer'
  const plane: Plane = options.plane ?? 'tenant'
  return buildManifest({
    routes,
    schemas,
    options: {
      authMode,
      plane,
      splitPlanes: isTenancyEnabled(),
      tenancy: tenancyOf(plane),
      generatedAt: new Date().toISOString(),
      ...options
    }
  })
}

/**
 * What the manifest says about tenancy, asked the way the rest of the framework asks (T-10.5).
 *
 * `multi` comes from `isTenancyEnabled()`, i.e. from a declared STRATEGY, and not from the mere
 * presence of the block. A `tenants` block with no strategy boots as single tenant
 * (`resolveTenancy` falls back to 'none') while the manifest used to announce `multi`: a
 * console then drew a tenant switcher and sent a header a single-tenant backend never reads.
 *
 * `header` is named only where a console must send it: on the tenant plane, under the `header`
 * resolver, from the login on (T-10.15). Under `subdomain` the host is the tenant; on the control
 * plane there is no tenant to declare. `switchable` is always false: from the login the token
 * binds the tenant (T-3.2), and a different one is a new login, not a switch under the session.
 */
export function tenancyOf(plane: Plane = 'tenant'): Manifest['tenancy'] {
  const tenants = tenantsConfig()
  if (!tenants || !isTenancyEnabled()) return { mode: 'single' }
  if (plane === 'control' || (tenants.resolver ?? 'header') === 'subdomain') return { mode: 'multi', switchable: false }
  return { mode: 'multi', switchable: false, header: tenants.headerKey || 'x-tenant-id' }
}
