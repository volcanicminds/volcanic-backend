[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-backend](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-backend)
[![npm](https://img.shields.io/badge/package-npm-white)](https://www.npmjs.com/package/@volcanicminds/backend)

# volcanic-backend

## Based on

Based on [Fastify](https://www.fastify.io) ([GitHub](https://github.com/fastify/fastify)).

Based on [Apollo Server](https://www.apollographql.com) ([GitHub](https://github.com/apollographql/apollo-server)).

And, what you see in [package.json](package.json).

## How to install

```ts
yarn add @volcanicminds/backend
```

## How to upgrade packages

```ts
yarn upgrade-deps
```

## Environment (example)

```ruby
NODE_ENV=development

HOST=0.0.0.0
PORT=2230

JWT_SECRET=yourSecret
JWT_EXPIRES_IN=5d

JWT_REFRESH=true
JWT_REFRESH_SECRET=yourRefreshSecret
JWT_REFRESH_EXPIRES_IN=180d

# LOG_LEVEL: trace, debug, info, warn, error, fatal
LOG_LEVEL=info
LOG_COLORIZE=true
LOG_TIMESTAMP=true
LOG_TIMESTAMP_READABLE=true
LOG_FASTIFY=false

GRAPHQL=false
SWAGGER=true
SWAGGER_HOST=myawesome.backend.com
SWAGGER_TITLE=API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemas to use
SWAGGER_VERSION=0.1.0
```

For docker may be useful set HOST as 0.0.0.0 (instead 127.0.0.1).

## How to run

```ts
yarn dev
yarn start
yarn prod
```

When you execute `yarn dev` the server is restarted whenever a .js/.ts file is changed (thanks to [nodemon](https://www.npmjs.com/package/nodemon))

## How to test (logic)

```ts
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

```ts
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

```ts
const logColorize = yn(LOG_COLORIZE, true)
const logTimestamp = yn(LOG_TIMESTAMP, true)
const logTimestampReadable = yn(LOG_TIMESTAMP_READABLE, true)
```

## Bearer token

```ruby
JWT_SECRET=yourSecret
JWT_EXPIRES_IN=5d

JWT_REFRESH=true
JWT_REFRESH_SECRET=yourRefreshSecret
JWT_REFRESH_EXPIRES_IN=180d
```

With `reply.jwtSign(payload)` is possible obtain a fresh JWT token. Each authenticated calls must be recalled specifying in the header:

`Authorization: Bearer <generated-token>`

With `await reply.server.jwt['refreshToken'].sign(payload)` is possible obtain a new Refresh JWT token.

All tokens (authorization and refresh) can be invalidated through the appropriate route.
**Example**: Both `JWT_SECRET` and `JWT_REFRESH_SECRET` can be generated with a command like `openssl rand -base64 64`

## Swagger

In the .env file you can change swagger settings in this way:

```ruby
SWAGGER=true
SWAGGER_HOST=http://localhost:2230
SWAGGER_TITLE=Volcanic API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemes to use
SWAGGER_VERSION=0.1.0
SWAGGER_PREFIX_URL=/documentation
```

## Fastify modules

Under the folder `src/config` is possible add a file `plugin.ts` where you can activate/customize some modules in this way:

```ts
// src/config/plugins.ts
module.exports = [
  {
    name: 'cors',
    enable: false,
    options: {}
  },
  {
    name: 'rateLimit',
    enable: false,
    options: {}
  },
  {
    name: 'helmet',
    enable: false,
    options: {}
  },
  {
    name: 'compress',
    enable: false,
    options: {}
  },
  {
    name: 'multipart',
    enable: false,
    options: {}
  },
  {
    name: 'rawBody',
    enable: false,
    options: {}
  }
]
```

Here the plugins used:

```js
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import rawBody from 'fastify-raw-body'
```

## Routes

Minimal setup (routes.ts):

```ts
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

```ts
// src/api/example/routes.ts
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

```ts
// src/api/example/controller/demo.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export function user(req: FastifyRequest, reply: FastifyReply) {
  reply.send(req.user || {})
}
```

Useful methods / objects:

- `req.user` to grab **user** data (validated and linked by JWT).
- `req.data()` to grab **query** or **body** parameters.
- `req.parameters()` to grab **params** data.
- `req.roles()` to grab **Roles** (as `string[]`) from `req.user` if compiled.
- `req.hasRole(role:Role)` to check if the **Role** is appliable for `req.user`.

## Roles

By default, there are some basic roles:

- **public**
- **admin**
- **backoffice**

In this way you can add custom roles:

```ts
// src/config/roles.ts
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

```ts
roles: [roles.admin, roles.public]
```

## Database

Use package [`@volcaniminds/typeorm`](https://github.com/volcanicminds/volcanic-database-typeorm) ([npm](https://www.npmjs.com/package/@volcanicminds/typeorm))

```ts
yarn add @volcanicminds/typeorm
```

## Hooks

It's possible add hook to application or request/reply lifecycles. More info on [Fastify Hooks](https://www.fastify.io/docs/latest/Reference/Hooks/).

Available hooks are:

```ts
const hooks = [
  'onRequest',
  'onError',
  'onSend',
  'onResponse',
  'onTimeout',
  'onReady',
  'onClose',
  'onRoute',
  'onRegistry',
  'preParsing',
  'preValidation',
  'preSeralization',
  'preHandler'
]
```

Under `src` create the `hooks` folder and inside add the hook as shown in the fastify docs, for example:

```ts
// src/hooks/onRequest.ts

async function hook(req, reply) {
  log.debug('onRequest called')
}

export { hook }
```

## Schemas

It's possible add schemas referenceable by `$ref`. More info on [Fastify Validation & Serialization](https://www.fastify.io/docs/latest/Reference/Validation-and-Serialization/).

Under `src` create the `schemas` folder and inside add the schema as shown in the fastify docs, for example:

```ts
// src/schemas/commonSchemas.ts

export const commonSchema = {
  $id: 'commonSchema',
  type: 'object',
  properties: {
    hello: { type: 'string' }
  }
}

export const commonSchemaAlt = {
  $id: 'commonSchemaAlt',
  type: 'object',
  properties: {
    world: { type: 'string' }
  }
}
```

So, in your `routes.ts` (under the section `config`) you'll can use something like this:

```ts
  params: { $ref: 'commonSchema#' },
  query: { $ref: 'commonSchema#' },
  body: { $ref: 'commonSchema#' },
  headers: { $ref: 'commonSchema#' }
```

## Reset tokens on login

It's possible to specify that all JWT tokens belonging to the user who logs in are reset at each login. To enable this feature, it's necessary to add or change the property `reset_external_id_on_login` to `true` (the default is `false`).

```ts
// src/config/general.ts
'use strict'

module.exports = {
  name: 'general',
  enable: true,
  options: {
    reset_external_id_on_login: true
  }
}
```

## Job Scheduler

It's possible to add a job scheduler. For more information, go to [Fastify Schedule](https://github.com/fastify/fastify-schedule). To enable this feature, it's necessary to add or change the property `scheduler` to `true` (the default is `false`).

```ts
// src/config/general.ts
'use strict'

module.exports = {
  name: 'general',
  enable: true,
  options: {
    scheduler: true
  }
}
```

All jobs are to be created and placed in appropriate files under the /src/schedules/ folder.
Each file name must follow the pattern \*.job.ts (for example, test.job.ts).

Inside each job, both the configuration part and the job to be executed must be included using this syntax:

```ts
// src/schedules/test.job.ts
import { JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true,
  interval: {
    seconds: 2
  }
}

export async function job() {
  log.info('tick job 2 every 2 seconds')
}
```

The job scheduling can have this configuration:

```ts
export interface JobSchedule {
  active: boolean // boolean (required)
  type?: string // cron|interval, default: interval
  async?: boolean // boolean, default: true
  preventOverrun?: boolean // boolean, default: true

  cron?: {
    expression?: string // required if type = 'cron', use cron syntax (if not specified, cron will be disabled)
    timezone?: string // optional, like "Europe/Rome" (to test)
  }

  interval?: {
    days?: number // number, default 0
    hours?: number // number, default 0
    minutes?: number // number, default 0
    seconds?: number // number, default 0
    milliseconds?: number // number, default 0
    runImmediately?: boolean // boolean, default: false
  }
}
```

The active property is a boolean and is mandatory.
The `type` property can have values of `cron` or `interval` (default).
If the type is **cron**, the properties defined under `cron` are also considered.
If the type is **interval**, the properties defined under `interval` are also considered.

For cron type, the `cron.expression` property is mandatory and indicates the scheduling to be executed.
The `timezone` property is considered experimental and should be defined, for example, as `"Europe/Rome"`.

Below an example:

```ts
// src/schedules/test.job.ts
import { JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true,
  type: 'cron',

  // Run a task every 2 seconds
  cron: {
    expression: '*/2 * * * * *'
  }
}
```

Below the cron schema:

```
┌──────────────── (optional) second (0 - 59)
│ ┌────────────── minute (0 - 59)
│ │ ┌──────────── hour (0 - 23)
│ │ │ ┌────────── day of month (1 - 31)
│ │ │ │ ┌──────── month (1 - 12, January - December)
│ │ │ │ │ ┌────── day of week (0 - 6, Sunday-Monday, Sunday is equal 0 or 7)
│ │ │ │ │ │
│ │ │ │ │ │
* * * * * *

// f.e. for every 2 seconds
const expression = '*/2 * * * * *'

```

A useful site that can be used to check a cron configuration is [crontab.guru](https://crontab.guru/)

For interval type, the sum of the properties `days, hours, minutes, seconds, milliseconds` (properly converted) must be equal to or greater than 1 second, otherwise the job will not be executed.

The `runImmediately` property indicates that the **interval** task will be executed for the first time immediately and not after the defined wait time.

Below an example:

```ts
// src/schedules/test.job.ts
import { JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true,
  type: 'interval',

  // Run a task every 1h 5m 30s
  interval: {
    days: 0,
    hours: 1,
    minutes: 5,
    seconds: 30,
    milliseconds: 0,
    runImmediately: false
  }
}
```

Other properties common to both types of jobs are:

- The **async** property, if true, indicates that a task will be executed as an async function.
- The **preventOverrun** property, if true, prevents the second instance of a task from being started while the first one is still running.

## Raw Body

Sometiomes, it’s useful to have the original raw body of the incoming request. For this purpose, the `rawBody` plugin is available out-of-the-box.

Under `config/plugins.ts`, modify your plugin configuration as follows to activate it:

```js
  {
    name: 'rawBody',
    enable: true,
    options: {}
  }
```

Fot the options refers to (fastify-raw-body - github)[https://github.com/Eomm/fastify-raw-body] but for common use, you can configure it in this way:

```js
{
  name: 'rawBody',
  enable: true,
  options: {
    global: false, // adds the rawBody to every request. **Default is true**. If false, you need to enable it for specific routes.
    runFirst: true, // get the body before any preParsing hook change/uncompress it. **Default false**
  }
}
```

Normally, it's a good choice set **global** to `false`and **runFirst** to `true`.

Please, do not change the `field` value in the options above. The default is `rawBody`, and this field name will be used in each request.

### Warning

Setting `global: false` and then the route configuration { config: { rawBody: true } } will _save memory_ and _imporove perfromance_ of your server since the rawBody is a copy of the body and it will double the memory usage.
So use it only for the routes that you need to.

## rawBody on specific route

If you set **global** to `false`, you can enable the rawBody for a specific route (common use, hooks to validate Stripe signature). Alternatively, if you set **global** to `true` or leave global not specified/undefined, it will enable rawBody on all routes, and you can disable it for single route in the following way.

A simple note: in the example below, you can see rawBody enabled on the `/example` endpoint. You can also disable rawBody by setting it to `false` instead of `true`.

```js
// f.e. /api/example/routes.ts

 {
      method: 'GET',
      path: '/',
      roles: [],
      handler: 'example.test',
      middlewares: [],
      config: {
        title: 'How to use req.rawBody',
        description: 'How to use req.rawBody',
        rawBody: true,
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
```
