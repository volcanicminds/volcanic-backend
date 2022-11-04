[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-backend](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-backend)

# volcanic-backend

## Based on

Based on [Fastify](https://www.fastify.io) ([GitHub](https://github.com/fastify/fastify)).

Based on [Apollo Server](https://www.apollographql.com) ([GitHub](https://github.com/apollographql/apollo-server)).

And, what you see in [package.json](package.json).

## Environment (example)

```ruby
NODE_ENV=development

HOST=0.0.0.0
PORT=2230

# LOG_LEVEL: trace, debug, info, warn, error, fatal
LOG_LEVEL=info
LOG_COLORIZE=true
LOG_TIMESTAMP=true
LOG_TIMESTAMP_READABLE=true
LOG_FASTIFY=false

GRAPHQL=false
SWAGGER=true
SWAGGER_TITLE=API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemes to use
SWAGGER_VERSION=0.1.0

SRV_CORS=false
SRV_HELMET=false
SRV_RATELIMIT=false
SRV_COMPRESS=false
```

For docker may be useful set HOST as 0.0.0.0 (instead 127.0.0.1).

## How to upgrade packages

```js
yarn upgrade-deps
```

## How to run

```js
yarn dev
yarn start
yarn prod
```

When you execute `yarn dev` the server is restarted whenever a .js/.ts file is changed (thanks to [nodemon](https://www.npmjs.com/package/nodemon))

## How to test (logic)

```js
yarn test
yarn test -t 'Logging'
```

Refer to jest for more options.

## Logging levels

In the .env file you can change log settings in this way:

```ruby
# LOG_LEVEL: trace, debug, info, warn, error, fatal
LOG_LEVEL=debug
LOG_TIMESTAMP=true
LOG_TIMESTAMP_READABLE=false
LOG_COLORIZE=true
```

Log levels:

- **trace**: useful and useless messages, verbose mode
- **debug**: well, for debugging purposes.. you know what I mean
- **info**: minimal logs necessary for understand that everything is working fine
- **warn**: useful warnings if the environment is controlled
- **error**: print out errors even if not blocking/fatal errors
- **fatal**: ok you are dead now, but you want to know why?

a bit of code:

```js
log.trace('Annoying message')
log.debug('Where is my bug?')
log.info('Useful information')
log.warn(`Hey pay attention: ${message}`)
log.error(`Catch an exception: ${message}`)
log.fatal(`Catch an exception: ${message} even if it's too late, sorry.`)

// use the proper flag to check if the level log is active (to minimize phantom loads)
log.i && log.info('Total commissions -> %d', aHugeCalculation())

// f.e.
log.t && log.trace('print a message')
log.d && log.debug('print a message')
log.i && log.info('print a message')
log.w && log.warn('print a message')
log.e && log.error('print a message')
log.f && log.fatal('print a message')
```

Other settings:

- **LOG_TIMESTAMP** (bool): add timestamp in each line
- **LOG_TIMESTAMP_READABLE** (bool): if timestamp is enabled this specify a human-readable format (worst performance)
- **LOG_COLORIZE** (bool): add a bit of colors

Defaults, see [logger.ts](./lib/util/logger.ts):

```js
const logColorize = yn(LOG_COLORIZE, true)
const logTimestamp = yn(LOG_TIMESTAMP, true)
const logTimestampReadable = yn(LOG_TIMESTAMP_READABLE, true)
```

## Swagger

In the .env file you can change swagger settings in this way:

```ruby
SWAGGER=true
SWAGGER_TITLE=API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemes to use
SWAGGER_VERSION=0.1.0
SWAGGER_PREFIX_URL=/documentation
```

## Fastify modules

In the .env file you can activate some modules in this way:

```ruby
SRV_CORS=false
SRV_HELMET=false
SRV_RATELIMIT=false
SRV_COMPRESS=false
```

## Routes

Minimal setup (routes.ts):

```js
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/',
      handler: 'myController.test'
    }
  ]
}
```

Some notes:

- It's possible define a generic **config** (optional).
- It's possible define a **config** for a specific route (optional).
- It's possible define a list of **roles** (optional).
- It's possible define a list of **middleware** (optional).

```js
module.exports = {
  config: {
    title: 'Example of routes.ts',
    description: 'Example of routes.ts',
    controller: 'controller',
    tags: ['user', 'code'], // swagger
    enable: true,
    deprecated: false, // swagger
    version: false // swagger
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'demo.user',
      middlewares: ['global.isAuthenticated'],
      config: {
        enable: true,
        title: 'Demo title', // swagger summary
        description: 'Demo description', // swagger
        tags: ['user', 'code'], // swagger
        deprecated: false, // swagger
        version: false, // swagger
        response: {
          403: {
            description: 'Unsuccessful response',
            type: 'object',
            properties: {
              hello: { type: 'string' }
            }
          },
          200: {
            description: 'Successful response',
            type: 'object',
            properties: {
              id: { type: 'number' }
            }
          }
        } // swagger
      }
    }
  ]
}
```

## Controllers

```js
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export async function user(req: FastifyRequest, reply: FastifyReply) {
  reply.send(req.user || {})
}
```

An useful method is `req.data()` to grab **query** or **body** parameters.
An useful method is `req.pars()` to grab **params** data.

## Roles

By default, there are some basic roles:

- **public**
- **admin**
- **backoffice**

In this way you can add custom roles:

```js
import { Role } from '@volcanicminds/backend'

export const roles: Role[] = [
  {
    code: 'customer',
    name: 'Customer',
    description: 'Customer role'
  }
]
```

You can use something like this to specify which roles (routes.ts) can recall some routes:

```js
roles: [roles.admin, roles.public]
```
