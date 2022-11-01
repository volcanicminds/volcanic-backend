'use strict'

import dotenv from 'dotenv'
dotenv.config()

import yn from './util/yn'
import logger from './util/logger'
import * as mark from './util/mark'
import * as loaderRoles from './loader/roles'
import * as loaderRouter from './loader/router'

import Fastify, { FastifyInstance } from 'fastify'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'

import { ApolloServer } from '@apollo/server'
import fastifyApollo, { fastifyApolloHandler, fastifyApolloDrainPlugin } from '@as-integrations/fastify'
import { myContextFunction, MyContext } from './apollo/context'
import resolvers from './apollo/resolvers'
import typeDefs from './apollo/type-defs'

const begin = new Date().getTime()
mark.print(logger)

export interface global {}
declare global {
  var log: any
  var roles: Roles
}

global.log = logger
global.roles = loaderRoles.load()

declare module 'fastify' {
  export interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

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
    log.info('Add graphql routes')
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
  log.info('Add fastify routes')

  fastify.addHook('onSend', async (req, reply) => {
    log.debug('onSend')
  })

  fastify.addHook('onResponse', async (req, reply) => {
    log.debug('onResponse')
  })

  fastify.addHook('onTimeout', async (req, reply) => {
    log.debug('onTimeout')
  })

  fastify.addHook('onReady', async () => {
    log.debug('onReady')
  })

  fastify.addHook('onClose', async (instance) => {
    log.debug('onClose')
  })

  fastify.addHook('onError', async (req, reply, error) => {
    log.debug(`onError ${error}`)
  })

  fastify.addHook('onRequest', async (req, reply) => {
    log.debug(`onRequest ${req.method} ${req.url}`)
    req.user = {
      id: 306,
      name: 'Huseyin',
      roles: ['admin', 'public']
    }
  })

  fastify.addHook('preParsing', async (req) => {
    log.debug(`preParsing ${req.method} ${req.url}`)
    req.user = {
      id: 42,
      name: 'Jane Doe',
      roles: ['admin', 'public']
    }
  })

  const routes = loaderRouter.load()
  routes && loaderRouter.apply(fastify, routes)
}

async function addFastifySwagger(fastify: FastifyInstance) {
  const { NODE_ENV, SWAGGER, SWAGGER_TITLE, SWAGGER_DESCRIPTION, SWAGGER_VERSION } = process.env
  const loadSwagger = yn(SWAGGER, false)

  if (loadSwagger && NODE_ENV !== 'production') {
    log.info('Add swagger plugin')

    await fastify.register(swagger, {
      swagger: {
        info: {
          title: SWAGGER_TITLE || 'API Documentation',
          description: SWAGGER_DESCRIPTION || 'List of available APIs and schemes to use',
          version: SWAGGER_VERSION || '0.1.0'
        },
        consumes: ['application/json'],
        produces: ['application/json']
      }
    })

    await fastify.register(swaggerUI, {
      routePrefix: '/documentation',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        defaultModelsExpandDepth: 1
      },
      uiHooks: {
        onRequest: function (request, reply, next) {
          next()
        },
        preHandler: function (request, reply, next) {
          next()
        }
      },
      staticCSP: true,
      transformStaticCSP: (header) => header
    })

    await fastify.put(
      '/some-route/:id',
      {
        schema: {
          description: 'post some data',
          tags: ['user', 'code'],
          deprecated: true,
          summary: 'qwerty',
          params: {
            type: 'object',
            properties: {
              id: {
                type: 'string',
                description: 'user id'
              }
            }
          },
          body: {
            type: 'object',
            properties: {
              hello: { type: 'string' },
              obj: {
                type: 'object',
                properties: {
                  some: { type: 'string' }
                }
              }
            }
          },
          response: {
            201: {
              description: 'Successful response',
              type: 'object',
              properties: {
                hello: { type: 'string' }
              }
            },
            default: {
              description: 'Default response',
              type: 'object',
              properties: {
                foo: { type: 'string' }
              }
            }
          }
        }
      },
      (req, reply) => {}
    )
  }
}

Fastify({ logger: logger }).then(async (fastify) => {
  const { HOST: host = '0.0.0.0', PORT: port = '2230', GRAPHQL } = process.env
  const { SRV_CORS, SRV_HELMET, SRV_RATELIMIT, SRV_COMPRESS } = process.env

  const loadApollo = yn(GRAPHQL, true)
  const addPluginCors = yn(SRV_CORS, true)
  const addPluginHelmet = yn(SRV_HELMET, true)
  const addPluginRateLimit = yn(SRV_RATELIMIT, true)
  const addPluginCompress = yn(SRV_COMPRESS, true)

  log.t && log.trace(`Attach Apollo Server ${loadApollo}`)
  log.t && log.trace(`Add plugin CORS: ${addPluginCors}`)
  log.t && log.trace(`Add plugin HELMET: ${!loadApollo ? addPluginHelmet : 'Not usable with Apollo'}`)
  log.t && log.trace(`Add plugin COMPRESS: ${addPluginCompress}`)
  log.t && log.trace(`Add plugin RATELIMIT: ${addPluginRateLimit}`)

  const apollo = loadApollo ? await attachApollo(fastify) : null
  // Helmet is not usable with Apollo Server
  !loadApollo && addPluginHelmet && (await fastify.register(helmet))

  // Usable with Apollo Server
  addPluginRateLimit && (await fastify.register(rateLimit))
  addPluginCors && (await fastify.register(cors))
  addPluginCompress && (await fastify.register(compress))

  await addFastifySwagger(fastify)
  await addApolloRouting(fastify, apollo)
  await addFastifyRouting(fastify)

  fastify
    .listen({
      port: Number(port),
      host: host
    })
    .then((address) => {
      const elapsed = (new Date().getTime() - begin) / 100
      log.info(`All stuff loaded in ${elapsed} sec`)
      log.info(`🚀 Server ready at ${address}`)
    })
})
