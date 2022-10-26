'use strict'

import dotenv from 'dotenv'
dotenv.config()

import yn from './util/yn'
import logger from './util/logger'
import { print } from './util/mark'

import Fastify, { FastifyInstance } from 'fastify'
import guard from 'fastify-guard'
import swagger from '@fastify/swagger'
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

interface AuthenticatedUser {
  id: number
  name: string
  roles: string[]
  scope: string[]
}

declare module 'fastify' {
  export interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

export interface global {}
declare global {
  var log: any
}

global.log = logger
print()

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
      name: 'Huseyin2222',
      roles: ['user', 'admin', 'editor'],
      scope: ['profile', 'email', 'openid']
    }
  })

  fastify.addHook('preParsing', async (req) => {
    req.user = {
      id: 42,
      name: 'Jane Doe',
      roles: ['admin'],
      scope: ['profile', 'email', 'openid']
    }
  })

  fastify.get('/me/is-admin', async function (req, reply) {
    return { isAdmin: (req.user?.roles || []).includes('admin') || false }
  })

  fastify.get('/hello', async (req, reply) => {
    return reply.send('world 123 ' + new Date().getTime())
  })

  // this route can only be called by users who has 'cto' and 'admin' roles
  fastify.get('/admin', { preHandler: [fastify.guard.role(['cto', 'admin'])] }, async (req, reply) => {
    // 'user' should already be defined in req object
    return reply.send(req.user)
  })

  fastify.get('/a/b/c', async (req, reply) => {
    // 'user' should already be defined in req object
    return reply.send(req.user)
  })

  fastify.get('/admin2', async (req, reply) => {
    // 'user' should already be defined in req object
    return reply.send(req.user)
  })

  fastify.get('/admin3', async () => {
    log.debug('recall GET admin')
    // 'user' should already be defined in req object
    return 'aiut'
  })
}

async function addFastifySwagger(fastify: FastifyInstance) {
  const { SWAGGER } = process.env
  const loadSwagger = yn(SWAGGER, false)

  if (loadSwagger) {
    log.info('Add swagger plugin')

    await fastify.register(swagger, {
      swagger: {
        info: {
          title: 'Test swagger',
          description: 'Testing the Fastify swagger API',
          version: '0.1.0'
        },
        externalDocs: {
          url: 'https://swagger.io',
          description: 'Find more info here'
        },
        host: 'localhost',
        schemes: ['http'],
        consumes: ['application/json'],
        produces: ['application/json'],
        tags: [
          { name: 'user', description: 'User related end-points' },
          { name: 'code', description: 'Code related end-points' }
        ],
        definitions: {
          User: {
            type: 'object',
            required: ['id', 'email'],
            properties: {
              id: { type: 'string', format: 'uuid' },
              firstName: { type: 'string' },
              lastName: { type: 'string' },
              email: { type: 'string', format: 'email' }
            }
          }
        },
        securityDefinitions: {
          apiKey: {
            type: 'apiKey',
            name: 'apiKey',
            in: 'header'
          }
        }
      }
    })
  }
}

Fastify().then(async (fastify) => {
  const defaultPort = 2230
  const { PORT: port = defaultPort, GRAPHQL } = process.env
  const loadApollo = yn(GRAPHQL, true)

  const apollo = loadApollo ? await attachApollo(fastify) : null
  !loadApollo && (await fastify.register(helmet))

  await fastify.register(rateLimit)
  await fastify.register(cors)
  await fastify.register(compress)
  await fastify.register(guard, {
    errorHandler: (result, req, reply) => {
      return reply.send('you are not allowed to call this route')
    }
  })

  await addFastifySwagger(fastify)
  await addApolloRouting(fastify, apollo)
  await addFastifyRouting(fastify)

  fastify
    .listen({
      port: Number(port || defaultPort)
    })
    .then((address) => {
      const a = (new Date().getTime() - begin) / 100
      log.info(`All stuff loaded in ${a} sec`)
      log.info(`🚀 Server ready at ${address}`)
    })
})
