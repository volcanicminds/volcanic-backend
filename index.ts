'use strict'

import dotenv from 'dotenv'
dotenv.config()

import yn from './lib/util/yn'
import logger from './lib/util/logger'
import * as mark from './lib/util/mark'
import * as loaderRoles from './lib/loader/roles'
import * as loaderRouter from './lib/loader/router'
import * as loaderHooks from './lib/loader/hooks'
import * as loaderSchemas from './lib/loader/schemas'

import Fastify, { FastifyInstance } from 'fastify'
import jwtValidator from '@fastify/jwt'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'

import { ApolloServer } from '@apollo/server'
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify'
import { myContextFunction, MyContext } from './lib/apollo/context'
import resolvers from './lib/apollo/resolvers'
import typeDefs from './lib/apollo/type-defs'

global.log = logger

async function attachApollo(fastify: FastifyInstance) {
  log.info('Attach ApolloServer to Fastify')
  const apollo = new ApolloServer<MyContext>({
    typeDefs,
    resolvers,
    plugins: [fastifyApolloDrainPlugin(fastify)]
  })

  await apollo.start()

  return apollo
}

async function addApolloRouting(fastify: FastifyInstance, apollo: ApolloServer<MyContext> | null) {
  if (apollo) {
    log.trace('Add graphql routes')
    await fastify.register(fastifyApollo(apollo), {
      context: myContextFunction
    })

    // // OR
    // fastify.post(
    //   '/graphql-alt',
    //   fastifyApolloHandler(apollo, {
    //     context: myContextFunction
    //   })
    // )
  }
}

async function addFastifyRouting(fastify: FastifyInstance) {
  log.trace('Add fastify routes')

  loaderHooks.apply(fastify)
  loaderSchemas.apply(fastify)

  const routes = loaderRouter.load()
  routes && loaderRouter.apply(fastify, routes)
}

async function addFastifySwagger(fastify: FastifyInstance) {
  const { SWAGGER, SWAGGER_TITLE, SWAGGER_DESCRIPTION, SWAGGER_VERSION, SWAGGER_PREFIX_URL, SWAGGER_HOST } = process.env

  const loadSwagger = yn(SWAGGER, false)
  if (loadSwagger) {
    log.trace('Add swagger plugin')

    await fastify.register(swagger, {
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

    await fastify.register(swaggerUI, {
      routePrefix: SWAGGER_PREFIX_URL || '/documentation',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        defaultModelsExpandDepth: 1
      }
      // uiHooks: {
      //   onRequest: function (request, reply, next) {
      //     next()
      //   },
      //   preHandler: function (request, reply, next) {
      //     next()
      //   }
      // }
      // staticCSP: true,
      // transformStaticCSP: (header) => header
    })

    // await fastify.put(
    //   '/some-route/:id',
    //   {
    //     schema: {
    //       description: 'post some data',
    //       tags: ['user', 'code'],
    //       deprecated: true,
    //       summary: 'qwerty',
    //       params: {
    //         type: 'object',
    //         properties: {
    //           id: {
    //             type: 'string',
    //             description: 'user id'
    //           }
    //         }
    //       },
    //       body: {
    //         type: 'object',
    //         properties: {
    //           hello: { type: 'string' },
    //           obj: {
    //             type: 'object',
    //             properties: {
    //               some: { type: 'string' }
    //             }
    //           }
    //         }
    //       },
    //       response: {
    //         201: {
    //           description: 'Successful response',
    //           type: 'object',
    //           properties: {
    //             hello: { type: 'string' }
    //           }
    //         },
    //         default: {
    //           description: 'Default response',
    //           type: 'object',
    //           properties: {
    //             foo: { type: 'string' }
    //           }
    //         }
    //       }
    //     }
    //   },
    //   (req, reply) => {}
    // )
  }
}

const start = async () => {
  const begin = new Date().getTime()
  mark.print(logger)
  global.roles = loaderRoles.load()

  const opts = yn(process.env.LOG_FASTIFY, false) ? { logger: logger } : {}
  const fastify = await Fastify(opts)

  const { HOST: host = '0.0.0.0', PORT: port = '2230', GRAPHQL } = process.env
  const { SRV_CORS, SRV_HELMET, SRV_RATELIMIT, SRV_COMPRESS, JWT_SECRET, JWT_EXPIRES_IN = '15d' } = process.env

  const loadApollo = yn(GRAPHQL, false)
  const addPluginCors = yn(SRV_CORS, false)
  const addPluginHelmet = yn(SRV_HELMET, false)
  const addPluginRateLimit = yn(SRV_RATELIMIT, false)
  const addPluginCompress = yn(SRV_COMPRESS, false)

  log.t && log.trace(`Attach Apollo Server ${loadApollo}`)
  log.t && log.trace(`Add plugin CORS: ${addPluginCors}`)
  log.t && log.trace(`Add plugin HELMET: ${!loadApollo ? addPluginHelmet : 'Not usable with Apollo'}`)
  log.t && log.trace(`Add plugin COMPRESS: ${addPluginCompress}`)
  log.t && log.trace(`Add plugin RATELIMIT: ${addPluginRateLimit}`)

  // Helmet is not usable with Apollo Server
  !loadApollo && addPluginHelmet && (await fastify.register(helmet))
  addPluginRateLimit && (await fastify.register(rateLimit))
  addPluginCors && (await fastify.register(cors))
  addPluginCompress && (await fastify.register(compress))

  // JWT Validator
  await fastify.register(jwtValidator, {
    secret: JWT_SECRET || 'supersecret',
    sign: { expiresIn: JWT_EXPIRES_IN }
  })

  log.t && log.trace(`Add JWT - expiresIn: ${JWT_EXPIRES_IN}`)

  const apollo = loadApollo ? await attachApollo(fastify) : null

  await addFastifySwagger(fastify)
  await addApolloRouting(fastify, apollo)
  await addFastifyRouting(fastify)

  await fastify
    .listen({
      port: Number(port),
      host: host
    })
    .then((address) => {
      const elapsed = (new Date().getTime() - begin) / 100
      log.info(`All stuff loaded in ${elapsed} sec`)
      log.info(`Server ready at ${address} 🚀`)

      const loadSwagger = yn(process.env.SWAGGER, false)
      loadSwagger && log.info(`Swagger ready at ${address}${process.env.SWAGGER_PREFIX_URL || '/documentation'} 📄`)
    })

  return fastify
}

export {
  global,
  FastifyReply,
  FastifyRequest,
  AuthenticatedUser,
  Role,
  Data,
  Roles,
  Route,
  RouteConfig,
  ConfiguredRoute
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
module.exports = { yn, start }
module.exports.server = { yn, start }
module.exports.default = { yn, start }
