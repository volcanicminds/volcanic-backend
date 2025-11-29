'use strict'

import dotenv from 'dotenv'
dotenv.config()

import dayjs from 'dayjs'
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
import general from './lib/config/general.js'

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
    } catch (_e) {
      if (log.w) log.warn('Swagger logo not found at ' + logoPath)
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
    })
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
  global.t = loaderTranslation.load()
  global.roles = await loaderRoles.load()

  const { tracking, trackingConfig } = await loaderTracking.load()
  global.tracking = tracking
  global.trackingConfig = trackingConfig

  // const opts = yn(process.env.LOG_FASTIFY, false) ? { logger: { development: logger } } : { logger: true }
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

  if (plugins?.rawBody) await server.register(rawBody, plugins.rawBody || {})
  if (!loadApollo && plugins?.helmet) await server.register(helmet, plugins.helmet || {})

  if (plugins?.rateLimit) {
    await server.register(rateLimit, plugins.rateLimit || {})
    server.setNotFoundHandler(
      {
        preHandler: server.rateLimit({
          max: 30,
          timeWindow: 30000
        })
      },
      function (_req, reply) {
        reply.code(404).send()
      }
    )
  }

  if (plugins?.multipart) await server.register(multipart, plugins.multipart || {})
  if (plugins?.cors) await server.register(cors, plugins.cors || {})
  if (plugins?.compress) await server.register(compress, plugins.compress || {})

  if (log.t) log.trace(`Add JWT - expiresIn: ${JWT_EXPIRES_IN}`)
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
      isValidUser(_data: unknown) {
        throw new Error('Not implemented.')
      },
      createUser(_data: unknown) {
        throw new Error('Not implemented.')
      },
      deleteUser(_data: unknown) {
        throw new Error('Not implemented.')
      },
      resetExternalId(_data: unknown) {
        throw new Error('Not implemented.')
      },
      updateUserById(_id: string, _user: unknown) {
        throw new Error('Not implemented.')
      },
      retrieveUserById(_id: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByEmail(_email: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByConfirmationToken(_code: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByResetPasswordToken(_code: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByUsername(_username: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByExternalId(_externalId: string) {
        throw new Error('Not implemented.')
      },
      retrieveUserByPassword(_email: string, _password: string) {
        throw new Error('Not implemented.')
      },
      changePassword(_email: string, _password: string, _oldPassword: string) {
        throw new Error('Not implemented.')
      },
      forgotPassword(_email: string) {
        throw new Error('Not implemented.')
      },
      userConfirmation(_user: unknown) {
        throw new Error('Not implemented.')
      },
      resetPassword(_user: unknown, _password: string) {
        throw new Error('Not implemented.')
      },
      blockUserById(_id: string, _reason: string) {
        throw new Error('Not implemented.')
      },
      unblockUserById(_data: unknown) {
        throw new Error('Not implemented.')
      },
      countQuery(_data: unknown) {
        throw new Error('Not implemented.')
      },
      findQuery(_data: unknown) {
        throw new Error('Not implemented.')
      },
      disableUserById(_id: string) {
        throw new Error('Not implemented.')
      },
      saveMfaSecret(_userId: string, _secret: string) {
        throw new Error('Not implemented.')
      },
      retrieveMfaSecret(_userId: string) {
        throw new Error('Not implemented.')
      },
      enableMfa(_userId: string) {
        throw new Error('Not implemented.')
      },
      disableMfa(_userId: string) {
        throw new Error('Not implemented.')
      },
      forceDisableMfaForAdmin(_email: string) {
        throw new Error('Not implemented.')
      }
    } as UserManagement,
    tokenManager: {
      isImplemented() {
        return false
      },
      isValidToken(_data: unknown) {
        throw new Error('Not implemented.')
      },
      createToken(_data: unknown) {
        throw new Error('Not implemented.')
      },
      resetExternalId(_id: string) {
        throw new Error('Not implemented.')
      },
      updateTokenById(_id: string, _token: unknown) {
        throw new Error('Not implemented.')
      },
      retrieveTokenById(_id: string) {
        throw new Error('Not implemented.')
      },
      retrieveTokenByExternalId(_id: string) {
        throw new Error('Not implemented.')
      },
      blockTokenById(_id: string, _reason: string) {
        throw new Error('Not implemented.')
      },
      unblockTokenById(_id: string) {
        throw new Error('Not implemented.')
      },
      countQuery(_data: unknown) {
        throw new Error('Not implemented.')
      },
      findQuery(_data: unknown) {
        throw new Error('Not implemented.')
      },
      removeTokenById(_id: string) {
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
      retrieveBy(_entityName, _entityId) {
        throw new Error('Not implemented.')
      },
      addChange(_entityName, _entityId, _status, _userId, _contents, _changeEntity) {
        throw new Error('Not implemented.')
      }
    } as DataBaseManagement,
    mfaManager: {
      generateSetup(_appName: string, _email: string) {
        throw new Error('Not implemented.')
      },
      verify(_token: string, _secret: string) {
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

  // --- STARTUP CHECKS (Admin MFA Reset) ---
  // Read directly from Environment Variables for security/emergency overrides
  const resetEmail = process.env.MFA_ADMIN_FORCED_RESET_EMAIL
  const resetUntil = process.env.MFA_ADMIN_FORCED_RESET_UNTIL

  if (resetEmail && resetUntil) {
    const now = dayjs()
    const untilDate = dayjs(resetUntil)

    if (untilDate.isValid()) {
      const diffMinutes = untilDate.diff(now, 'minute')

      if (diffMinutes < 0) {
        if (log.i) log.info('Startup: MFA Admin Reset window expired. Ignoring.')
      } else if (diffMinutes > 10) {
        if (log.f)
          log.fatal(
            `Startup Error: MFA_ADMIN_FORCED_RESET_UNTIL is too far in the future (>10 min). Fix configuration.`
          )
        process.exit(1)
      } else {
        if (log.w) log.warn(`Startup: executing FORCE MFA RESET for admin ${resetEmail}`)
        try {
          // Use the decorator directly if userManager is injected
          if (server['userManager'] && server['userManager'].isImplemented()) {
            await server['userManager'].forceDisableMfaForAdmin(resetEmail)
            if (log.w) log.warn(`Startup: MFA RESET SUCCESSFUL for ${resetEmail}`)
          } else {
            if (log.e) log.error('Startup: userManager not found or not implemented, cannot reset MFA')
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (log.e) log.error(`Startup: MFA RESET FAILED: ${message}`)
        }
      }
    }
  }
  // -------------------------------------------------

  await server
    .listen({
      port: Number(port),
      host: host
    })
    .then((address) => {
      if (log.i) {
        const elapsed = (new Date().getTime() - begin) / 100
        log.info(`All stuff loaded 🟢 in ${elapsed}s`)
      }

      if (log.w && general.options.mfa_policy !== 'OPTIONAL') {
        log.warn(`Security MFA 🔑 enforced to ${general.options.mfa_policy}`)
      } else if (log.i) {
        log.info(`Security MFA 🔑 set to ${general.options.mfa_policy}`)
      }

      if (log.i) {
        log.info(`Server up 🚀 at ${address}`)

        const loadSwagger = yn(process.env.SWAGGER, false)
        if (loadSwagger) {
          log.info(`Swagger ✨ available at ${address}${process.env.SWAGGER_PREFIX_URL || '/api-docs'}`)
        }
      }
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

export { MfaPolicy } from './lib/config/constants.js'

export { yn, start, TranslatedError }
