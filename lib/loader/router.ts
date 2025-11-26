import yn from '../util/yn.js'
import type { Role, Route, ConfiguredRoute, RouteConfig } from '../../types/global.js'
import { FastifyReply, FastifyRequest } from 'fastify'
import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'
import path from 'path'
import { fileURLToPath } from 'url'
import require from '../util/require.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const methods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS']

async function tryToLoadFile(fileName: string) {
  try {
    const module = await import(fileName)
    return module.default || module
  } catch (err) {
    return null
  }
}

async function loadMiddleware(base: string, middleware: string = '') {
  const key = 'global.'
  const isGlobal = middleware.indexOf(key) > -1
  let loadedModule: any = null

  if (isGlobal) {
    const name = middleware.substring(key.length)
    // Prova path locali (es. src/middleware/auth.ts)
    const localPath = path.resolve(process.cwd() + '/src/middleware/' + name + '.ts') // Prova TS
    const localPathJs = path.resolve(process.cwd() + '/src/middleware/' + name + '.js') // Prova JS (dist)

    loadedModule = await tryToLoadFile(localPath)
    if (!loadedModule) loadedModule = await tryToLoadFile(localPathJs)

    // Se non trova locale, prova interno alla lib
    if (!loadedModule) {
      const libPath = path.resolve(__dirname + '/../middleware/' + name + '.js')
      loadedModule = await tryToLoadFile(libPath)
    }
  } else {
    // Middleware locale alla route
    const routeMiddPath = path.resolve(base + '/middleware/' + middleware)
    // Qui è difficile indovinare l'estensione se non fornita, assumiamo che il loader sappia cosa fa o proviamo entrambe
    loadedModule = await tryToLoadFile(routeMiddPath + '.ts')
    if (!loadedModule) loadedModule = await tryToLoadFile(routeMiddPath + '.js')
    if (!loadedModule) loadedModule = await tryToLoadFile(routeMiddPath) // Magari ha già estensione
  }

  if (!loadedModule) {
    log.error(`Middleware ${middleware} not loaded`)
    throw new Error(`Middleware ${middleware} not loaded`)
  }
  return loadedModule
}

async function loadMiddlewares(base: string, middlewares: string[] = []) {
  const midds = {}
  for (const m of middlewares) {
    const middleware = await loadMiddleware(base, m)
    // I middleware possono esportare più funzioni (preHandler, preSerialization, ecc.)
    Object.keys(middleware).map((name) => (midds[name] = [...(midds[name] || []), middleware[name]]))
  }
  return midds
}

async function load(): Promise<ConfiguredRoute[]> {
  const validRoutes: ConfiguredRoute[] = []
  const patterns = normalizePatterns(['..', 'api', '**', 'routes.{ts,js}'], ['src', 'api', '**', 'routes.{ts,js}'])
  const authMiddlewares = ['global.isAuthenticated', 'global.isAdmin']

  for (const pattern of patterns) {
    log.t && log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      if (f.endsWith('.d.ts')) continue

      const base = path.dirname(f)
      const dir = path.basename(base)
      const file = path.join(dir, path.basename(f))

      const module = await import(f)
      const routesjs = module.default || module
      const { routes = [], config: defaultConfig = {} } = routesjs || {}

      log.t && log.trace(`* Add ${routes.length} routes from ${file}`)

      routes.forEach((route: Route, index: number) => {
        const errors: string[] = []
        const {
          method: methodCase,
          path: pathName = '/',
          handler,
          roles: rs = [],
          config = {} as RouteConfig,
          middlewares = [],
          rateLimit
        } = route

        const rsp = !rs.length ? [roles.public] : rs
        let requiredRoles: Role[] = []

        try {
          requiredRoles = rsp.some((r) => r.code === roles.admin.code) ? rsp : [...rsp, roles.admin]
        } catch (err) {
          log.e && log.error(`Error in loading roles for ${methodCase} ${pathName} (${handler})`)
          log.t && log.trace(err)
          config.enable = false
        }

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
          rawBody = false
        } = config || {}

        const endpoint = `${dir}${pathName.replace(/\/+$/, '')}`
        const method = methodCase.toUpperCase()
        const num = index + 1
        const handlerParts = handler.split('.')

        if (enable) {
          if (!pathName.startsWith('/')) errors.push(`Error in [${file}] bad path [${pathName}] at route n. ${num}`)
          if (!methods.includes(method)) errors.push(`Error in [${file}] bad method [${method}] at route n. ${num}`)
          if (handlerParts.length !== 2) errors.push(`Error in [${file}] bad handler [${handler}] at route n. ${num}`)

          const key = method + endpoint + version
          if (validRoutes.some((r) => `${r.method}${r.path}${r.doc?.version}` === key)) {
            errors.push(`Error in [${file}] duplicated path [${pathName}] at route n. ${num}`)
          }

          if (errors.length > 0) {
            log.e && errors.forEach((error) => log.error(error))
          }
        }

        const toAdd = enable && errors.length === 0
        toAdd
          ? log.t &&
            log.trace(
              `* Method [${method}] path ${endpoint} handler ${handler} enabled with ${
                middlewares?.length || 0
              } middlewares`
            )
          : log.w && log.warn(`* Method [${method}] path ${endpoint} handler ${handler} disabled. Skip.`)

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

          validRoutes.push({
            handler,
            method,
            path: '/' + endpoint,
            middlewares,
            roles: requiredRoles,
            enable,
            rawBody,
            rateLimit,
            base,
            file: path.join(base, defaultConfig.controller || 'controller', handlerParts[0]),
            func: handlerParts[1],
            doc: doc
          })
        }
      })
    }
  }

  log.d && log.debug(`Routes loaded: ${validRoutes.length}`)
  return validRoutes
}

async function applyRoutes(server: any, routes: ConfiguredRoute[]): Promise<void> {
  if (!routes || routes.length === 0) {
    log.w && log.warn('No routes to apply to server')
    return
  }

  log.t && log.trace(`Apply ${routes.length} routes to server with pid ${process.pid}`)

  for (const route of routes) {
    if (route?.enable) {
      const { handler, method, path, middlewares, roles, rawBody, rateLimit, base, file, func, doc } = route

      log.t && log.trace(`* Add path ${method} ${path} on handle ${handler}`)
      const midds = await loadMiddlewares(base, middlewares)

      server.route({
        method: method,
        path: path,
        schema: doc,
        ...midds,
        config: {
          requiredRoles: roles || [],
          rawBody: rawBody || false,
          rateLimit: rateLimit || undefined
        },
        handler: async function (req: FastifyRequest, reply: FastifyReply) {
          try {
            // Import dinamico del controller
            // Dobbiamo assicurarci che 'file' abbia l'estensione corretta o che il resolver la trovi
            // In ESM strict, meglio provare ad aggiungere .js se manca, o lasciare che Node risolva se è un path assoluto
            let module
            try {
              module = await import(file + '.js')
            } catch {
              try {
                module = await import(file + '.ts')
              } catch {
                module = await import(file)
              }
            }

            return await module[func](req, reply)
          } catch (err) {
            log.e && log.error(`Cannot find ${file} or method ${func}: ${err}`)
            return reply.code(500).send(`Invalid handler ${handler}`)
          }
        }
      })
    }
  }
}

export async function apply(server: any): Promise<void> {
  const routes = await load()
  return await applyRoutes(server, routes)
}
