import { Route, ConfiguredRoute, RouteConfig } from '../../types/global'
import { FastifyReply, FastifyRequest } from 'fastify'

const glob = require('glob')
const path = require('path')
const methods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS']

export function load(): ConfiguredRoute[] {
  const validRoutes: ConfiguredRoute[] = []
  const patterns = [`${__dirname}/../api/**/routes.{ts,js}`, `${process.cwd()}/src/api/**/routes.{ts,js}`]

  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string, index: number, values: string[]) => {
      const base = path.dirname(f)
      const dir = path.basename(base)
      const file = path.join(dir, path.basename(f))

      // allow array or structure
      const routesjs = require(f)
      const { routes = [], config: defaultConfig = {} } = routesjs || {}

      // adjust default config
      if (!defaultConfig.enable) defaultConfig.enable = true
      if (defaultConfig.deprecated == null) defaultConfig.deprecated = false
      if (defaultConfig.controller == null) defaultConfig.controller = 'controller'

      log.i && log.info(`Routes loaded: ${file} with ${routes.length} routes defined`)

      routes.forEach((route: Route, index: number) => {
        const errors: string[] = []
        const {
          method: methodCase,
          path: pathName = '/',
          handler,
          config = {} as RouteConfig,
          middlewares = [],
          roles: requiredRole = []
        } = route

        if (
          !config?.security &&
          (requiredRole.some((r) => r.code !== roles.public.code) ||
            middlewares.some((m) => m === 'global.isAuthenticated'))
        ) {
          config.security = 'bearer'
        }

        // specific route config
        const {
          title = '',
          description = '',
          enable = defaultConfig.enable || true,
          deprecated = defaultConfig.deprecated || false,
          tags = defaultConfig.tags || false,
          version = defaultConfig.version || '',
          security = defaultConfig.security || undefined,
          query,
          params,
          body,
          response
        } = config || {}

        // adjust something
        const endpoint = `${dir}${pathName.replace(/\/+$/, '')}`
        const method = methodCase.toUpperCase()
        const num = index + 1
        const handlerParts = handler.split('.')

        if (enable) {
          if (!pathName.startsWith('/')) {
            errors.push(`Error in [${file}] bad path [${pathName}] at route n. ${num}`)
          }

          if (!methods.includes(method)) {
            errors.push(`Error in [${file}] bad method [${method}] at route n. ${num}`)
          }

          if (handlerParts.length !== 2) {
            errors.push(`Error in [${file}] bad handler [${handler}] at route n. ${num}`)
          }

          const key = method + endpoint + version
          if (validRoutes.some((r) => `${r.method}${r.path}${r.doc?.version}` === key)) {
            errors.push(`Error in [${file}] duplicated path [${pathName}] at route n. ${num}`)
          }

          if (errors.length > 0) {
            log.e && errors.forEach((error) => log.error(error))
          }
        }

        if (errors.length == 0) {
          enable
            ? log.d &&
              log.debug(
                `* Method [${method}] path ${endpoint} handler ${handler} enabled with ${
                  middlewares?.length || 0
                } middlewares`
              )
            : log.w && log.warn(`* Method [${method}] path ${endpoint} handler ${handler} disabled. Skip.`)

          validRoutes.push({
            handler,
            method,
            path: '/' + endpoint,
            middlewares,
            roles: requiredRole,
            enable,
            base,
            file: path.join(base, defaultConfig.controller, handlerParts[0]),
            func: handlerParts[1],
            // swagger: doc
            doc: {
              summary: title,
              description,
              deprecated,
              tags,
              version,
              security: security === 'bearer' ? [{ Bearer: [] }] : security,
              querystring: query,
              params,
              body,
              response
            }
          })
        }
      })
    })
  })

  return validRoutes
}

function normalizeMiddlewarePath(base: string, middleware: string = '') {
  const key = 'global.'
  const idx = middleware.indexOf(key)
  return idx == 0
    ? path.resolve(__dirname + '/../middleware/' + middleware.substring(key.length))
    : path.resolve(base + '/middleware/' + middleware)
}

export function apply(server: any, routes: ConfiguredRoute[]): void {
  log.t && log.trace(`Apply ${routes.length} routes to server with pid ${process.pid}`)

  routes.forEach(async ({ handler, method, path, middlewares, roles, enable, base, file, func, doc }) => {
    if (enable) {
      log.t && log.trace(`* Add path ${method} ${path} on handle ${handler}`)

      server.route({
        method: method,
        path: path,
        schema: doc,
        preHandler: (middlewares || []).map((m) => require(normalizeMiddlewarePath(base, m))),
        config: {
          requiredRoles: roles || []
        },
        handler: function (req: FastifyRequest, reply: FastifyReply) {
          try {
            return require(file)[func](req, reply)
          } catch (err) {
            log.e && log.error(`Cannot find ${file} or method ${func}: ${err}`)
            return reply.code(500).send(`Invalid handler ${handler}`)
          }
        }
      })
    }
  })
}
