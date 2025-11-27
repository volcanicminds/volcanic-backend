'use strict'

import dotenv from 'dotenv'
dotenv.config()

import yn from './lib/util/yn.js'
import logger from './lib/util/logger.js'
import * as mark from './lib/util/mark.js'
import { TranslatedError } from './lib/util/errors.js'
import * as loaderPlugins from './lib/loader/plugins.js'
import * as loaderRoles from './lib/loader/roles.js'
import * as loaderRouter from './lib/loader/router.js'
import * as loaderHooks from './lib/loader/hooks.js'
import * as loaderSchemas from './lib/loader/schemas.js'
import * as loaderTracking from './lib/loader/tracking.js'
import * as loaderTranslation from './lib/loader/translation.js'
import * as loaderConfig from './lib/loader/general.js'
import * as loaderSchedules from './lib/loader/schedules.js'

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
import { myContextFunction, MyContext } from './lib/apollo/context.js'
import resolvers from './lib/apollo/resolvers.js'
import typeDefs from './lib/apollo/type-defs.js'
import require from './lib/util/require.js'

import type { UserManagement, TokenManagement, DataBaseManagement, MfaManagement } from './types/global.js'

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
  }
}

async function addFastifyRouting(server: FastifyInstance) {
  log.trace('Add server routes')

  await loaderHooks.apply(server)
  await loaderSchemas.apply(server)
  await loaderRouter.apply(server)
}

async function addFastifySwagger(server: FastifyInstance) {
  const { SWAGGER, SWAGGER_TITLE, SWAGGER_DESCRIPTION, SWAGGER_VERSION, SWAGGER_PREFIX_URL, SWAGGER_HOST } = process.env

  const loadSwagger = yn(SWAGGER, false)
  if (loadSwagger) {
    log.trace('Add swagger plugin')

    const fs = require('fs')
    const path = require('path')
    const logoPath = path.resolve(process.cwd(), 'logo-dark.png')

    let content = ''
    try {
      content = fs.readFileSync(logoPath, { encoding: 'base64' })
    } catch (e) {
      log.w && log.warn('Swagger logo not found at ' + logoPath)
    }

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
      routePrefix: SWAGGER_PREFIX_URL || '/api-docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        defaultModelsExpandDepth: 1
      },
      logo: {
        type: 'image/png',
        content: Buffer.from(content, 'base64')
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

const start = async (decorators = {}) => {
  const begin = new Date().getTime()
  mark.print(logger)

  global.config = await loaderConfig.load()
  global.roles = await loaderRoles.load()
  global.t = loaderTranslation.load()

  const { tracking, trackingConfig } = await loaderTracking.load()
  global.tracking = tracking
  global.trackingConfig = trackingConfig

  const opts = yn(process.env.LOG_FASTIFY, false) ? { logger: { development: logger } } : { logger: true }
  const server: FastifyInstance = fastify()
  global.server = server

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
  const plugins = await loaderPlugins.load()

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

  decorators = {
    userManager: {
      isImplemented() {
        return false
      },
      isValidUser(data: any) {
        throw new Error('Not implemented.')
      },
      createUser(data: any) {
        throw new Error('Not implemented.')
      },
      deleteUser(data: any) {
        throw new Error('Not implemented.')
      },
      resetExternalId(data: any) {
        throw new Error('Not implemented.')
      },
      updateUserById(id: string, user: any) {
        throw new Error('Not implemented.')
      },
      retrieveUserById(id: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByEmail(email: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByConfirmationToken(code: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByResetPasswordToken(code: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByUsername(username: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByExternalId(externalId: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByPassword(email: string, password: string) {
        throw new Error('Not implemented.')
      },
      changePassword(email: string, password: string, oldPassword: string) {
        throw new Error('Not implemented.')
      },
      forgotPassword(email: string) {
        throw new Error('Not implemented.')
      },
      userConfirmation(user: any) {
        throw new Error('Not implemented.')
      },
      resetPassword(user: any, password: string) {
        throw new Error('Not implemented.')
      },
      blockUserById(id: string, reason: string) {
        throw new Error('Not implemented.')
      },
      unblockUserById(data: any) {
        throw new Error('Not implemented.')
      },
      countQuery(data: any) {
        throw new Error('Not implemented.')
      },
      findQuery(data: any) {
        throw new Error('Not implemented.')
      },
      disableUserById(id: string) {
        throw new Error('Not implemented.')
      },
      saveMfaSecret(userId: string, secret: string) {
        throw new Error('Not implemented.')
      },
      retrieveMfaSecret(userId: string) {
        throw new Error('Not implemented.')
      },
      enableMfa(userId: string) {
        throw new Error('Not implemented.')
      },
      disableMfa(userId: string) {
        throw new Error('Not implemented.')
      }
    } as UserManagement,
    tokenManager: {
      isImplemented() {
        return false
      },
      isValidToken(data: any) {
        throw new Error('Not implemented.')
      },
      createToken(data: any) {
        throw new Error('Not implemented.')
      },
      resetExternalId(id: string) {
        throw new Error('Not implemented.')
      },
      updateTokenById(id: string, token: any) {
        throw new Error('Not implemented.')
      },
      retrieveTokenById(id: string) {
        throw new Error('Not implemented.')
      },
      retrieveTokenByExternalId(id: string) {
        throw new Error('Not implemented.')
      },
      blockTokenById(id: string, reason: string) {
        throw new Error('Not implemented.')
      },
      unblockTokenById(id: string) {
        throw new Error('Not implemented.')
      },
      countQuery(data: any) {
        throw new Error('Not implemented.')
      },
      findQuery(data: any) {
        throw new Error('Not implemented.')
      },
      removeTokenById(id: string) {
        throw new Error('Not implemented.')
      }
    } as TokenManagement,
    dataBaseManager: {
      isImplemented() {
        return false
      },
      synchronizeSchemas() {
        throw new Error('Not implemented.')
      },
      retrieveBy(entityName, entityId) {
        throw new Error('Not implemented.')
      },
      addChange(entityName, entityId, status, userId, contents, changeEntity) {
        throw new Error('Not implemented.')
      }
    } as DataBaseManagement,
    mfaManager: {
      generateSetup(appName: string, email: string) {
        throw new Error('Not implemented.')
      },
      verify(token: string, secret: string) {
        throw new Error('Not implemented.')
      }
    } as MfaManagement,
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
      loadSwagger && log.info(`Swagger ready ✨ at ${address}${process.env.SWAGGER_PREFIX_URL || '/api-docs'}`)
    })

  await loaderSchedules.start(server, schedules)
  return server
}

export type {
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
  MfaManagement,
  JobSchedule
} from './types/global.js'

export { yn, start, TranslatedError }
