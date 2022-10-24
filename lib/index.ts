'use strict'

import dotenv from 'dotenv'
dotenv.config()

import yn from './util/yn'
import logger from './util/logger'
import { print } from './util/mark'

import Fastify, { FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'

import { ApolloServer } from '@apollo/server'
import fastifyApollo, { fastifyApolloHandler, fastifyApolloDrainPlugin } from '@as-integrations/fastify'
import { myContextFunction, MyContext } from './apollo/context'
import resolvers from './apollo/resolvers'
import typeDefs from './apollo/type-defs'

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
  fastify.get('/hello', () => {
    return 'world ' + new Date().getTime()
  })
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

  await addApolloRouting(fastify, apollo)
  await addFastifyRouting(fastify)

  fastify
    .listen({
      port: Number(port || defaultPort)
    })
    .then((address) => {
      log.info(`🚀 Server ready at ${address}`)
    })
})
