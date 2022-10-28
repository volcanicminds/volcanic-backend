import { FastifyReply, FastifyRequest } from 'fastify'

const glob = require('glob')
const path = require('path')
const methods = ['get', 'post', 'put', 'delete', 'head', 'patch', 'options']

export function load(): ConfiguredRoute[] {
  const check = true,
    print = true,
    load = true

  const validRoutes: ConfiguredRoute[] = []
  const patterns = [`${__dirname}/../api/**/routes.ts`, `${process.cwd()}/src/api/**/routes.ts`]

  patterns.forEach((pattern) => {
    check && log.i && log.info('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string, index: number, values: string[]) => {
      const base = path.dirname(f)
      const dir = path.basename(base)
      const file = path.join(dir, path.basename(f))

      log.debug('f ' + f)

      // allow array or structure
      const routesjs = require(f)

      const { routes = [], config: defaultConfig = {} } = routesjs?.default

      // adjust default config
      if (!defaultConfig.enable) defaultConfig.enable = true
      if (defaultConfig.deprecated == null) defaultConfig.deprecated = false
      if (defaultConfig.controller == null) defaultConfig.controller = 'controller'

      check && log.i && log.info(`Load ${file} with ${routes.length} routes defined`)
      print && log.d && log.debug(`Valid routes loaded from ${file}`)

      routes.forEach((route: Route, index: number) => {
        const errors = []
        const { method: methodCase, path: pathName = '/', handler, config, middlewares = [], roles = [] } = route

        // specific route config
        const {
          title = '',
          description = '',
          enable = defaultConfig.enable || true,
          deprecated = defaultConfig.deprecated || false,
          version = defaultConfig.version || ''
        } = config || {}

        // adjust something
        const endpoint = `${dir}${pathName.replace(/\/+$/, '')}`
        const method = methodCase.toLowerCase()
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
          if (validRoutes.some((r) => `${r.method}${r.path}${r.version}` === key)) {
            errors.push(`Error in [${file}] duplicated path [${pathName}] at route n. ${num}`)
          }

          if (errors.length > 0) {
            check && log.e && errors.forEach((error) => log.error(error))
          }
        }

        if (errors.length == 0) {
          enable && print
            ? log.d &&
              log.debug(
                `* Method [${method}] path ${endpoint} handler ${handler}, has middleware? ${
                  (middlewares && middlewares.length) || 'no'
                }`
              )
            : !enable
            ? log.w && log.warn(`* Method [${method}] path ${endpoint} handler ${handler} disabled. Skip.`)
            : log.i && log.info(`* Method [${method}] path ${endpoint} handler ${handler} enabled.`)

          validRoutes.push({
            title,
            description,
            method,
            path: '/' + endpoint,
            handler,

            file: path.join(base, defaultConfig.controller, handlerParts[0]),
            func: handlerParts[1],
            base,

            middlewares,
            roles,
            enable,
            deprecated,
            version
          })
        }
      })
    })
  })

  return validRoutes
}

export function apply(server: any, routes: ConfiguredRoute[]): void {
  log.t && log.trace(`Apply ${routes.length} routes to server with pid ${process.pid}`)

  routes.forEach(({ handler, method, path, middlewares, roles, enable, base, file, func }) => {
    if (enable) {
      log.t && log.trace(`Add path ${method.toUpperCase()} ${path} on handle ${handler}`)

      server[method](path, (request: FastifyRequest, reply: FastifyReply) => {
        try {
          if (roles?.length > 0) {
            const userRoles = request.user?.roles || []
            const resolvedRole = roles.filter((r) => userRoles.includes(r.code))
            if (!resolvedRole || resolvedRole.length === 0) {
              log.w && log.warn(`Not allowed to call ${method.toUpperCase()} ${path}`)
              return reply.code(403).send()
            }
          }
          return require(file + '.ts')[func](request, reply)
        } catch (err) {
          log.e && log.error(`Cannot find ${file}.js or method ${func}: ${err}`)
          return reply.code(500).send(`Invalid handler ${handler}`)
        }
      })
    }
  })
}
