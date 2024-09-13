'use strict'

import dotenv from 'dotenv'
dotenv.config()

import yn from './lib/util/yn'
import logger from './lib/util/logger'
import * as mark from './lib/util/mark'
import { TranslatedError } from './lib/util/errors'
import * as loaderPlugins from './lib/loader/plugins'
import * as loaderRoles from './lib/loader/roles'
import * as loaderRouter from './lib/loader/router'
import * as loaderHooks from './lib/loader/hooks'
import * as loaderSchemas from './lib/loader/schemas'
import * as loaderTracking from './lib/loader/tracking'
import * as loaderTranslation from './lib/loader/translation'
import * as loaderConfig from './lib/loader/general'
import * as loaderSchedules from './lib/loader/schedules'

import fastify, { FastifyInstance } from 'fastify'
import jwtValidator from '@fastify/jwt'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { fastifySchedule } from '@fastify/schedule'

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import rawBody from 'fastify-raw-body'

import { ApolloServer } from '@apollo/server'
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify'
import { myContextFunction, MyContext } from './lib/apollo/context'
import resolvers from './lib/apollo/resolvers'
import typeDefs from './lib/apollo/type-defs'
import { UserManagement, TokenManagement, DataBaseManagement } from './types/global'

global.log = logger

async function attachApollo(server: FastifyInstance) {
  log.info('Attach ApolloServer to Fastify')
  const apollo = new ApolloServer<MyContext>({
    typeDefs,
    resolvers,
    plugins: [fastifyApolloDrainPlugin(server)]
  })

  await apollo.start()

  return apollo
}

async function addApolloRouting(server: FastifyInstance, apollo: ApolloServer<MyContext> | null) {
  if (apollo) {
    log.trace('Add graphql routes')
    await server.register(fastifyApollo(apollo), {
      context: myContextFunction
    })

    // // OR
    // server.post(
    //   '/graphql-alt',
    //   fastifyApolloHandler(apollo, {
    //     context: myContextFunction
    //   })
    // )
  }
}

async function addFastifyRouting(server: FastifyInstance) {
  log.trace('Add server routes')

  loaderHooks.apply(server)
  loaderSchemas.apply(server)

  const routes = loaderRouter.load()
  routes && loaderRouter.apply(server, routes)
}

async function addFastifySwagger(server: FastifyInstance) {
  const { SWAGGER, SWAGGER_TITLE, SWAGGER_DESCRIPTION, SWAGGER_VERSION, SWAGGER_PREFIX_URL, SWAGGER_HOST } = process.env

  const loadSwagger = yn(SWAGGER, false)
  if (loadSwagger) {
    log.trace('Add swagger plugin')

    const fs = require('fs')
    const contents = fs.readFileSync('logo-dark.png', { encoding: 'base64' })

    await server.register(swagger, {
      swagger: {
        info: {
          title: SWAGGER_TITLE || 'Volcanic API Documentation',
          description: SWAGGER_DESCRIPTION || 'List of available APIs and schemes to use',
          version: SWAGGER_VERSION || '0.0.1'
        },
        host: SWAGGER_HOST || 'localhost:2230',
        schemes: ['https', 'http'],
        consumes: ['application/json'],
        produces: ['application/json']
      },
      openapi: {
        info: {
          title: SWAGGER_TITLE || 'Volcanic API Documentation',
          description: SWAGGER_DESCRIPTION || 'List of available APIs and schemes to use',
          version: SWAGGER_VERSION || '0.0.1'
        },
        servers: [
          {
            url: SWAGGER_HOST || 'http://localhost:2230'
          }
        ],
        components: {
          securitySchemes: {
            Bearer: {
              type: 'http',
              scheme: 'bearer'
            }
          }
        }
      }
    })

    await server.register(swaggerUI, {
      routePrefix: SWAGGER_PREFIX_URL || '/documentation',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        defaultModelsExpandDepth: 1
      },
      logo: {
        type: 'image/png',
        content: Buffer.from(contents, 'base64')
      },
      theme: {
        title: SWAGGER_TITLE
      }
    } as any)
  }
}

async function addFastifySchedule(server: FastifyInstance) {
  const { scheduler = false } = global.config?.options || {}
  if (scheduler) {
    log.trace('Add scheduler plugin')

    await server.register(fastifySchedule)
  }
}

const start = async (decorators) => {
  const begin = new Date().getTime()
  mark.print(logger)

  global.config = loaderConfig.load()
  global.roles = loaderRoles.load()
  global.t = loaderTranslation.load()

  const { tracking, trackingConfig } = loaderTracking.load()
  global.tracking = tracking
  global.trackingConfig = trackingConfig

  const opts = yn(process.env.LOG_FASTIFY, false) ? { logger: { development: logger } } : { logger: true }
  const server: FastifyInstance = fastify()

  const { HOST: host = '0.0.0.0', PORT: port = '2230', GRAPHQL } = process.env
  const {
    JWT_SECRET = '',
    JWT_EXPIRES_IN = '15d',
    JWT_REFRESH = 'true',
    JWT_REFRESH_SECRET = '',
    JWT_REFRESH_EXPIRES_IN = '180d'
  } = process.env

  const loadRefreshJWT = yn(JWT_REFRESH, true)
  const loadApollo = yn(GRAPHQL, false)
  const plugins = loaderPlugins.load()

  // Helmet is not usable with Apollo Server
  plugins?.rawBody && (await server.register(rawBody, plugins.rawBody || {}))
  !loadApollo && plugins?.helmet && (await server.register(helmet, plugins.helmet || {}))

  if (plugins?.rateLimit) {
    await server.register(rateLimit, plugins.rateLimit || {})
    server.setNotFoundHandler(
      {
        preHandler: server.rateLimit({
          max: 30,
          timeWindow: 30000
        })
      },
      function (req, reply) {
        reply.code(404).send()
      }
    )
  }

  plugins?.multipart && (await server.register(multipart, plugins.multipart || {}))
  plugins?.cors && (await server.register(cors, plugins.cors || {}))
  plugins?.compress && (await server.register(compress, plugins.compress || {}))

  // JWT Validator
  log.t && log.trace(`Add JWT - expiresIn: ${JWT_EXPIRES_IN}`)
  await server.register(jwtValidator, {
    secret: JWT_SECRET,
    sign: { expiresIn: JWT_EXPIRES_IN }
  })

  if (loadRefreshJWT) {
    await server.register(jwtValidator, {
      namespace: 'refreshToken',
      secret: JWT_REFRESH_SECRET || JWT_SECRET,
      sign: { expiresIn: JWT_REFRESH_EXPIRES_IN }
    })
  }

  const apollo = loadApollo ? await attachApollo(server) : null
  await addFastifySwagger(server)
  await addApolloRouting(server, apollo)
  await addFastifyRouting(server)
  await addFastifySchedule(server)

  const schedules = loaderSchedules.load()

  // defaults
  decorators = {
    userManager: {
      isImplemented() {
        return false
      },
      isValidUser(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      createUser(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      resetExternalId(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      updateUserById(id: string, user: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveUserById(id: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveUserByEmail(email: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveUserByConfirmationToken(code: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveUserByResetPasswordToken(code: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveUserByUsername(username: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveUserByExternalId(externalId: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveUserByPassword(email: string, password: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      changePassword(email: string, password: string, oldPassword: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      forgotPassword(email: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      userConfirmation(user: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      resetPassword(user: any, password: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      blockUserById(id: string, reason: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      unblockUserById(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      countQuery(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      findQuery(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      disableUserById(id: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      }
    } as UserManagement,
    tokenManager: {
      isImplemented() {
        return false
      },
      isValidToken(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      createToken(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      resetExternalId(id: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      updateTokenById(id: string, token: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveTokenById(id: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveTokenByExternalId(id: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      blockTokenById(id: string, reason: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      unblockTokenById(id: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      countQuery(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      findQuery(data: any) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      removeTokenById(id: string) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      }
    } as TokenManagement,
    dataBaseManager: {
      isImplemented() {
        return false
      },
      synchronizeSchemas() {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      retrieveBy(entityName, entityId) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      },
      addChange(entityName, entityId, status, userId, contents, changeEntity) {
        throw new Error('Not implemented. You need to define the specific decorator (manager).')
      }
    } as DataBaseManagement,
    ...decorators
  }

  await Promise.all(
    Object.keys(decorators || {}).map(async (key) => {
      await server.decorate(key, decorators[key])
    })
  )

  await server
    .listen({
      port: Number(port),
      host: host
    })
    .then((address) => {
      const elapsed = (new Date().getTime() - begin) / 100
      log.info(`All stuff loaded in ${elapsed} sec`)
      log.info(`Server ready 🚀 at ${address}`)

      const loadSwagger = yn(process.env.SWAGGER, false)
      loadSwagger && log.info(`Swagger ready ✨ at ${address}${process.env.SWAGGER_PREFIX_URL || '/documentation'}`)
    })

  global.server = server

  // Ok, it's time to start the scheduler jobs
  await loaderSchedules.start(server, schedules)
  return server
}

export {
  global,
  FastifyReply,
  FastifyRequest,
  AuthenticatedUser,
  AuthenticatedToken,
  Role,
  Data,
  Roles,
  Route,
  RouteConfig,
  ConfiguredRoute,
  UserManagement,
  TokenManagement,
  DataBaseManagement,
  JobSchedule
} from './types/global'

/**
 * These export configurations enable JS and TS developers
 * to consumer BE in whatever way best suits their needs.
 * Some examples of supported import syntax includes:
 * - `const server = require('@volcanicminds/backend')`
 * - `const { server } = require('@volcanicminds/backend')`
 * - `import * as Server from '@volcanicminds/backend'`
 * - `import { server, TSC_definition } from '@volcanicminds/backend'`
 * - `import server from '@volcanicminds/backend'`
 * - `import server, { TSC_definition } from '@volcanicminds/backend'`
 */
export { yn, start, TranslatedError }
module.exports = { yn, start, TranslatedError }
module.exports.server = { yn, start, TranslatedError }
module.exports.default = { yn, start, TranslatedError }
