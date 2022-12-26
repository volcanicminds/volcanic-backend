import yn from '../util/yn'
import { Route, ConfiguredRoute, RouteConfig } from '../../types/global'
import { FastifyReply, FastifyRequest } from 'fastify'

const fs = require('fs')
const glob = require('glob')
const path = require('path')
const methods = ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'PATCH', 'OPTIONS']

export function load(): ConfiguredRoute[] {
  const validRoutes: ConfiguredRoute[] = []
  const patterns = [`${__dirname}/../api/**/routes.{ts,js}`, `${process.cwd()}/src/api/**/routes.{ts,js}`]
  const authMiddlewares = ['global.isAuthenticated', 'global.isAdmin']

  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string, index: number, values: string[]) => {
      const base = path.dirname(f)
      const dir = path.basename(base)
      const file = path.join(dir, path.basename(f))

      // allow array or structure
      const routesjs = require(f)
      const { routes = [], config: defaultConfig = {} } = routesjs || {}

      log.t && log.trace(`* Add ${routes.length} routes from ${file}`)

      routes.forEach((route: Route, index: number) => {
        const errors: string[] = []
        const {
          method: methodCase,
          path: pathName = '/',
          handler,
          config = {} as RouteConfig,
          middlewares = [],
          roles: rs = []
        } = route

        const requiredRoles = !rs.length ? [roles.public] : rs
        const reqAuth: boolean =
          middlewares.some((m) => authMiddlewares.includes(m)) ||
          requiredRoles.every((r) => r.code !== roles.public.code)

        if (!config?.security && reqAuth) {
          config.security = 'bearer'
        }

        // specific route config
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

        const toAdd = enable && errors.length === 0
        toAdd
          ? log.t &&
            log.trace(
              `* Method [${method}] path ${endpoint} handler ${handler} enabled with ${
                middlewares?.length || 0
              } middlewares`
            )
          : log.w && log.warn(`* Method [${method}] path ${endpoint} handler ${handler} disabled. Skip.`)

        toAdd &&
          validRoutes.push({
            handler,
            method,
            path: '/' + endpoint,
            middlewares,
            roles: requiredRoles,
            enable,
            base,
            file: path.join(base, defaultConfig.controller || 'controller', handlerParts[0]),
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
      })
    })
  })

  log.d && log.debug(`Routes loaded: ${validRoutes.length}`)
  return validRoutes
}

async function tryToLoadFile(fileName: string) {
  return new Promise((resolve, reject) => {
    try {
      const required = fileName ? require(fileName) : null
      resolve(required)
    } catch (err) {
      reject(err)
    }
  })
}

async function loadMiddleware(base: string, middleware: string = '') {
  const key = 'global.'
  const isGlobal = middleware.indexOf(key) > -1
  let required: any = null

  if (isGlobal) {
    const name = middleware.substring(key.length)
    required = await tryToLoadFile(path.resolve(__dirname + '/../middleware/' + name)).catch(async () => {
      return await tryToLoadFile(path.resolve(process.cwd() + '/src/middleware/' + name))
    })
  } else {
    required = await tryToLoadFile(path.resolve(base + '/middleware/' + middleware))
  }

  if (!required) {
    log.error(`Middleware ${middleware} not loaded`)
    throw new Error(`Middleware ${middleware} not loaded`)
  }
  return required
}

// preParsing, preValidation, preHandler, preSerialization, ..

export function apply(server: any, routes: ConfiguredRoute[]): void {
  log.t && log.trace(`Apply ${routes.length} routes to server with pid ${process.pid}`)

  routes.forEach(async ({ handler, method, path, middlewares, roles, enable, base, file, func, doc }) => {
    if (enable) {
      log.t && log.trace(`* Add path ${method} ${path} on handle ${handler}`)

      server.route({
        method: method,
        path: path,
        schema: doc,
        // preHandler: (middlewares || []).map((m) => require(normalizeMiddlewarePath(base, m))),
        preHandler: await Promise.all((middlewares || []).map(async (m) => await loadMiddleware(base, m))),
        config: {
          requiredRoless: roles || []
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
