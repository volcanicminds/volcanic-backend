/* eslint-disable @typescript-eslint/no-explicit-any */
import yn from '../util/yn.js'
import type { Role, Route, ConfiguredRoute, RouteConfig } from '../../types/global.js'
import { FastifyReply, FastifyRequest } from 'fastify'
import { normalizePatterns } from '../util/path.js'
import { normalizeRouteCache, buildCacheHooks, cacheEnabled } from '../util/cache.js'
import { isSystemRoleCode, SYSTEM_CAPABILITIES, SYSTEM_PREFIX } from './roles.js'
import { globSync } from 'glob'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const methods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS']

async function tryToLoadFile(fileName: string) {
  try {
    const module = await import(fileName)
    return module.default || module
  } catch (_err) {
    return null
  }
}

async function loadMiddleware(base: string, middleware: string = '') {
  const key = 'global.'
  const isGlobal = middleware.indexOf(key) > -1
  let loadedModule: any = null

  if (isGlobal) {
    const name = middleware.substring(key.length)
    const localPath = path.resolve(process.cwd() + '/src/middleware/' + name + '.ts')
    const localPathJs = path.resolve(process.cwd() + '/src/middleware/' + name + '.js')

    loadedModule = await tryToLoadFile(localPath)
    if (!loadedModule) loadedModule = await tryToLoadFile(localPathJs)

    if (!loadedModule) {
      const libPath = path.resolve(__dirname + '/../middleware/' + name + '.js')
      loadedModule = await tryToLoadFile(libPath)
    }
  } else {
    const routeMiddPath = path.resolve(base + '/middleware/' + middleware)
    loadedModule = await tryToLoadFile(routeMiddPath + '.ts')
    if (!loadedModule) loadedModule = await tryToLoadFile(routeMiddPath + '.js')
    if (!loadedModule) loadedModule = await tryToLoadFile(routeMiddPath)
  }

  if (!loadedModule) {
    log.error(`Middleware ${middleware} not loaded`)
    throw new Error(`Middleware ${middleware} not loaded`)
  }
  return loadedModule
}

async function loadMiddlewares(base: string, middlewares: string[] = []) {
  const midds: { [key: string]: any[] } = {}
  for (const m of middlewares) {
    const middleware = await loadMiddleware(base, m)
    for (const name in middleware) {
      if (!midds[name]) midds[name] = []
      midds[name].push(middleware[name])
    }
  }
  return midds
}


// Resolve a route's declared roles (Role objects or string codes) plus its optional
// capability into the final allowed-role set. Object refs are trusted; string codes and
// undefined entries that don't resolve against the `roles` catalog are collected in
// `roleErrors` for the fail-fast at load. admin is always appended (universal superuser);
// a route with neither roles nor a capability defaults to public.
function resolveRequiredRoles(
  rs: (Role | string)[],
  capability: string | undefined,
  where: string,
  roleErrors: string[],
  scope: 'tenant' | 'control' = 'tenant'
): Role[] {
  // Which catalogue the route is judged against, and it is the whole of T-4.1's boot half:
  // a control route resolves against the control roles, a tenant route against the tenant
  // ones, and the two maps never see each other's codes.
  const isControl = scope === 'control'
  // Read off globalThis, not as a bare identifier: a deployment that has not loaded the
  // control catalogue must get an empty map and a legible error, not a ReferenceError from
  // three frames down.
  const system = ((globalThis as { systemRoles?: Record<string, Role> }).systemRoles ?? {}) as Record<string, Role>
  const catalogue: Record<string, Role> = isControl ? system : roles
  const catalogueName = isControl ? 'config/systemRoles.ts' : 'config/roles.ts'
  const superuser: Role = isControl ? system['system:admin'] : roles.admin

  const declared: Role[] = []
  for (const ref of rs) {
    if (ref == null) {
      roleErrors.push(`${where} → references an undefined role`)
      continue
    }

    const code = typeof ref === 'string' ? ref : ref.code
    if (!code) {
      roleErrors.push(`${where} → a declared role has no code`)
      continue
    }

    // docs/AUTHORIZATION_V5.md §2.1, the two refusals TypeScript cannot make: a route that
    // mixes the scopes is a hole, and it must be impossible to ship rather than logged.
    if (isControl && !isSystemRoleCode(code)) {
      roleErrors.push(`${where} → control route lists the tenant role '${code}'. Control routes take '${SYSTEM_PREFIX}' roles only`)
      continue
    }
    if (!isControl && isSystemRoleCode(code)) {
      roleErrors.push(`${where} → tenant route lists the control role '${code}'. A control role never grants anything inside a tenant`)
      continue
    }

    if (typeof ref === 'string') {
      const resolved = catalogue[ref]
      if (resolved) declared.push(resolved)
      else roleErrors.push(`${where} → unknown role '${ref}' (not declared in ${catalogueName})`)
    } else {
      declared.push(ref as Role)
    }
  }

  if (capability) {
    if (isControl && !SYSTEM_CAPABILITIES.includes(capability as never)) {
      roleErrors.push(`${where} → '${capability}' is not in the control catalogue: ${SYSTEM_CAPABILITIES.join(', ')}`)
    }
    if (!isControl && SYSTEM_CAPABILITIES.includes(capability as never)) {
      roleErrors.push(`${where} → '${capability}' is a control capability and cannot gate a tenant route`)
    }
  }

  const capRoles: Role[] = capability
    ? Object.values(catalogue).filter((r) => Array.isArray(r.capabilities) && r.capabilities.includes(capability))
    : []
  if (capability && capRoles.length === 0 && log?.w) {
    log.warn(`Route ${where} requires capability '${capability}' held by no role: superuser only`)
  }

  const seen = new Set<string>()
  const out: Role[] = []
  for (const r of [...declared, ...capRoles]) {
    if (r?.code && !seen.has(r.code)) {
      seen.add(r.code)
      out.push(r)
    }
  }
  // A control route is never open to `public`: the platform has no anonymous surface.
  if (out.length === 0 && !capability && !isControl) out.push(roles.public)
  if (superuser && !out.some((r) => r.code === superuser.code)) out.push(superuser)
  return out
}

export function processRoute(
  route: Route,
  index: number,
  file: string,
  dir: string,
  base: string,
  defaultConfig: any,
  authMiddlewares: string[],
  validRoutes: ConfiguredRoute[],
  integrityErrors: string[] = []
): ConfiguredRoute | null {
  const errors: string[] = []
  const {
    method: methodCase,
    path: pathName = '/',
    handler,
    roles: rs = [],
    requireCapability,
    config = {} as RouteConfig,
    middlewares = [],
    rateLimit,
    cache: cacheInput
  } = route

  // Which plane the route acts on. Read before the roles are resolved, because it decides
  // WHICH CATALOGUE they are resolved against (T-4.1).
  const scope: 'tenant' | 'control' = (config?.scope || defaultConfig.scope || 'tenant') as 'tenant' | 'control'

  const requiredRoles = resolveRequiredRoles(
    rs,
    requireCapability,
    `${methodCase} ${pathName} (${handler})`,
    integrityErrors,
    scope === 'control' ? 'control' : 'tenant'
  )

  const reqAuth: boolean =
    middlewares.some((m) => authMiddlewares.includes(m)) ||
    requiredRoles.every((r) => r.code !== roles.public.code)

  if (!config?.security && reqAuth) {
    config.security = 'bearer'
  }

  const {
    title = '',
    description = '',
    enable = yn(defaultConfig.enable, true),
    deprecated = yn(defaultConfig.deprecated, false),
    tags = defaultConfig.tags,
    version = defaultConfig.version || '',
    security = defaultConfig.security,
    query,
    params,
    body,
    response,
    consumes,
    rawBody = false,
    // Audit trail behaviour for this route (T-3.5). What is tracked lives in
    // `config/tracking.ts`; this says what happens when the write fails, and the default
    // is strict: an untracked write on a system that promises an audit trail is worse than
    // a visible error.
    tracking
  } = config || {}

  // Which plane the route acts on, and nothing else decides it (T-3.3).
  //
  // `tenantContext` was the v4 spelling and it is refused, not translated: v5 is breaking
  // and a silent translation is how two spellings of one decision start disagreeing
  // (invariant 9). Refusing at boot rather than at the first request is the point: a route
  // that meant "the platform" and is read as "a tenant" would not fail, it would answer
  // from the wrong container.
  // `scope` is the v5 spelling (docs/AUTHORIZATION_V5.md §2): 'tenant' by default, 'control'
  // for a route that acts on the platform. It is resolved into the internal flag the hooks
  // honour, so a route that declares it actually gets it: a field that is documented, typed
  // and never read is defect D-11.
  const where = `${methodCase.toUpperCase()} ${pathName} (${handler}) in ${file}`
  if (config && Object.prototype.hasOwnProperty.call(config, 'tenantContext')) {
    const meant = (config as unknown as Record<string, unknown>).tenantContext === false ? 'control' : 'tenant'
    integrityErrors.push(`${where}: \`tenantContext\` is the v4 spelling. Write \`scope: '${meant}'\`.`)
  }
  if (defaultConfig && Object.prototype.hasOwnProperty.call(defaultConfig, 'tenantContext')) {
    integrityErrors.push(`${file}: \`tenantContext\` in the file-level config is the v4 spelling. Write \`scope\`.`)
  }
  if (scope !== 'tenant' && scope !== 'control') {
    integrityErrors.push(`${where}: unknown scope '${scope}'. The two planes are 'tenant' (default) and 'control'.`)
  }

  // The internal flag the hooks read. It is derived here, in one place, and it is the only
  // thing downstream sees: `scope` is what a consumer writes, this is what the framework
  // runs on. The default stays the safe one, a route works inside the tenant unless it says
  // otherwise, exactly as in v4.
  const tenantContext = scope !== 'control'

  const endpoint = `${dir}${pathName.replace(/\/+$/, '')}`
  const method = methodCase.toUpperCase()
  const num = index + 1
  const handlerParts = handler.split('.')

  if (enable) {
    if (!pathName.startsWith('/')) errors.push(`Error in [${file}] bad path [${pathName}] at route n. ${num}`)
    if (!methods.includes(method)) errors.push(`Error in [${file}] bad method [${method}] at route n. ${num}`)
    if (handlerParts.length !== 2) errors.push(`Error in [${file}] bad handler [${handler}] at route n. ${num}`)

    // Stored routes keep a leading slash in `path` ('/' + endpoint), so the key
    // must include it too — otherwise 'GETusers' never equals 'GET/users' and the
    // duplicate check silently never fires.
    const key = `${method}/${endpoint}${version}`
    if (validRoutes.some((r) => `${r.method}${r.path}${r.doc?.version}` === key)) {
      errors.push(`Error in [${file}] duplicated path [${pathName}] at route n. ${num}`)
    }

    if (errors.length > 0) {
      if (log.e) errors.forEach((error) => log.error(error))
    }
  }

  const toAdd = enable && errors.length === 0
  if (toAdd) {
    if (log.t)
      log.trace(
        `* Method [${method}] path ${endpoint} handler ${handler} enabled with ${
          middlewares?.length || 0
        } middlewares`
      )
  } else {
    if (log.w) log.warn(`* Method [${method}] path ${endpoint} handler ${handler} disabled. Skip.`)
  }

  if (toAdd) {
    const doc = {
      summary: title,
      description,
      deprecated,
      tags,
      version,
      security: security === 'bearer' ? [{ Bearer: [] }] : security,
      response
    } as any

    if (query) doc.querystring = query
    if (params) doc.params = params
    if (body) doc.body = body
    if (consumes) doc.consumes = consumes

    return {
      handler,
      method,
      path: '/' + endpoint,
      middlewares,
      roles: requiredRoles,
      enable,
      tenantContext,
      rawBody,
      rateLimit,
      tracking,
      // Per-route cache (falls back to the file-level `config.cache`); the default
      // key-group is the api folder (`dir`), overridable.
      cache: normalizeRouteCache(cacheInput ?? defaultConfig?.cache, dir),
      base,
      file: path.join(base, defaultConfig.controller || 'controller', handlerParts[0]),
      func: handlerParts[1],
      doc: doc,
      // Structural hints (manifest L1): authored under `config.manifest`, taken from the
      // file-level `config` (defaultConfig) with optional per-route override.
      group: config?.manifest?.group ?? defaultConfig?.manifest?.group,
      resource: config?.manifest?.resource ?? defaultConfig?.manifest?.resource
    }
  }

  return null
}

async function load(): Promise<ConfiguredRoute[]> {
  const validRoutes: ConfiguredRoute[] = []
  const integrityErrors: string[] = []
  const patterns = normalizePatterns(['..', 'api', '**', 'routes.{ts,js}'], ['src', 'api', '**', 'routes.{ts,js}'])
  const authMiddlewares = ['global.isAuthenticated', 'global.isAdmin']

  for (const pattern of patterns) {
    if (log.t) log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      if (f.endsWith('.d.ts')) continue

      const base = path.dirname(f)
      const dir = path.basename(base)
      const file = path.join(dir, path.basename(f))

      const module = await import(f)
      const routesjs = module.default || module
      const { routes = [], config: defaultConfig = {} } = routesjs || {}

      if (log.t) log.trace(`* Add ${routes.length} routes from ${file}`)

      routes.forEach((route: Route, index: number) => {
        const configuredRoute = processRoute(
          route,
          index,
          file,
          dir,
          base,
          defaultConfig,
          authMiddlewares,
          validRoutes,
          integrityErrors
        )
        if (configuredRoute) {
          validRoutes.push(configuredRoute)
        }
      })
    }
  }

  if (integrityErrors.length) {
    const message = `Route integrity check failed. Every route role must be declared in config/roles.ts, and every route must name a plane it acts on:\n  - ${integrityErrors.join(
      '\n  - '
    )}`
    if (log?.f) log.fatal(message)
    throw new Error(message)
  }

  return validRoutes
}

async function applyRoutes(server: any, routes: ConfiguredRoute[]): Promise<void> {
  if (!routes || routes.length === 0) {
    if (log.w) log.warn('No routes to apply to server')
    return
  }

  if (log.t) log.trace(`Apply ${routes.length} routes to server with pid ${process.pid}`)

  let countRoutes = 0
  for (const route of routes) {
    if (route?.enable) {
      const { handler, method, path, middlewares, roles, rawBody, rateLimit, base, file, func, doc, tenantContext, cache, tracking } =
        route

      if (log.d) log.debug(`* Add path ${method} ${path} on handle ${handler}`)
      const midds = await loadMiddlewares(base, middlewares)

      // Attach the cache read (preHandler, runs after auth) and write (onSend)
      // hooks only when the route opts in — no overhead on uncached routes.
      const cacheHooks = cache && (cache.enabled || cache.invalidates?.length) ? buildCacheHooks(cache) : null

      // Courtesy log at wiring time: describe each cache-declaring route, and warn
      // when a route opts in while the global master switch is off (hooks are inert).
      if (cacheHooks) {
        if (!cacheEnabled()) {
          if (log.w)
            log.warn(
              `Cache 🧊 route ${method} ${path} declares cache/invalidation but global cache is disabled (options.cache.enabled) — inert`
            )
        } else if (log.d) {
          const parts: string[] = []
          if (cache?.enabled) parts.push(`read+write ttl ${cache.ttl ?? 'default'}s keyGroup '${cache.keyGroup}'`)
          if (cache?.invalidates?.length) parts.push(`invalidates [${cache.invalidates.join(', ')}]`)
          log.debug(`Cache 🧊 route ${method} ${path} — ${parts.join(', ')}`)
        }
      }

      const routeDef: any = {
        method: method,
        path: path,
        schema: doc,
        ...midds,
        config: {
          requiredRoles: roles || [],
          rawBody: rawBody || false,
          rateLimit: rateLimit || undefined,
          tenantContext: tenantContext,
          cache: cache || undefined,
          tracking: tracking || undefined
        },
        handler: async function (req: FastifyRequest, reply: FastifyReply) {
          let module
          try {
            try {
              module = await import(file + '.js')
            } catch {
              try {
                module = await import(file + '.ts')
              } catch {
                module = await import(file)
              }
            }
          } catch (err) {
            if (log.e) log.error(`Cannot load module ${file}: ${err}`)
            return reply.code(500).send(`Invalid handler module ${handler}`)
          }

          if (!module || typeof module[func] !== 'function') {
            if (log.e) log.error(`Method ${func} not found in ${file}`)
            return reply.code(500).send(`Invalid handler method ${handler}`)
          }

          return await module[func](req, reply)
        }
      }

      if (cacheHooks?.preHandler) {
        // Cache read runs before the route middlewares; auth/roles are already
        // enforced in the global onRequest hook, so this is safe.
        routeDef.preHandler = [cacheHooks.preHandler, ...((midds as any).preHandler || [])]
      }
      if (cacheHooks?.onSend) routeDef.onSend = cacheHooks.onSend

      server.route(routeDef)

      countRoutes++
    }
  }

  if (log.i) log.info(`Routes loaded: ${countRoutes}`)
}

export async function apply(server: any): Promise<void> {
  const routes = await load()
  // Expose the mounted routes (enabled + valid) for introspection — e.g. the admin
  // manifest generator. Read-only by convention; rebuilt on every apply().
  global.routes = routes
  return await applyRoutes(server, routes)
}
