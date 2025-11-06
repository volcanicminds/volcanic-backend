[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-backend](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-backend)
[![npm](https://img.shields.io/badge/package-npm-white)](https://www.npmjs.com/package/@volcanicminds/backend)

# volcanic-backend

A Node.js framework based on Fastify to build robust APIs quickly, featuring an automatic routing system, integrated authentication, and a powerful data access layer.

## ⚠️ Breaking Changes in v2.x

- Change package manager from yarn to npm.
- Updated all dependencies to their latest versions.
- Increase minimum Node.js version to 24.x.

## Based on

**Volcanic Backend** is a powerful, opinionated, and extensible Node.js framework for creating robust and scalable RESTful and GraphQL APIs. It's built on modern, high-performance libraries like [Fastify](https://www.fastify.io) and can be optionally paired with [Apollo Server](https://www.apollographql.com).

The framework provides a comprehensive set of built-in features including a filesystem-based router, JWT authentication, role-based access control, task scheduling, and seamless database integration, allowing developers to focus on business logic rather than boilerplate.

And, what you see in [package.json](package.json).

## Core Philosophy

- **Convention over Configuration**: A clear and consistent project structure for APIs, controllers, and routes simplifies development and reduces boilerplate.
- **Extensibility**: Easily extendable with custom plugins, hooks, and middleware to fit any project's needs.
- **Database Agnostic**: Designed to work seamlessly with `@volcanicminds/typeorm`, supporting both SQL (e.g., PostgreSQL) and NoSQL (e.g., MongoDB) databases.
- **Feature-Rich**: Out-of-the-box support for JWT authentication, role-based access control (RBAC), automatic Swagger/OpenAPI documentation, and much more.

## Quick Start

### Installation

```sh
npm install @volcanicminds/backend
```

For database interactions, it is highly recommended to also install the companion package:

```sh
npm install @volcanicminds/typeorm
```

### Minimal Working Example

This example demonstrates how to set up a basic server with a single endpoint.

**1. Create your server entrypoint (`index.ts`):**

```typescript
// index.ts
import { start } from '@volcanicminds/backend'
import { start as startDatabase, userManager } from '@volcanicminds/typeorm'
import { myDbConfig } from './src/config/database' // Assume you have a db config file

async function main() {
  // 1. Initialize the database connection (optional but recommended)
  await startDatabase(myDbConfig)

  // 2. Start the Volcanic Backend server
  // We pass the 'userManager' from the typeorm package to enable authentication
  await start({ userManager })
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
```

**2. Define a route (`src/api/hello/routes.ts`):**

```typescript
// src/api/hello/routes.ts
module.exports = {
  routes: [
    {
      method: 'GET',
      path: '/',
      handler: 'world.sayHello'
    }
  ]
}
```

**3. Create the controller (`src/api/hello/controller/world.ts`):**

```typescript
// src/api/hello/controller/world.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export function sayHello(req: FastifyRequest, reply: FastifyReply) {
  reply.send({ message: 'Hello, World!' })
}
```

**4. Run your server:**

```sh
npm run dev
```

Now you can visit `http://localhost:2230/hello` and you will see `{"message":"Hello, World!"}`.

## How to upgrade packages

```ts
npm run upgrade-deps
```

## Project Structure

A typical project using `volcanic-backend` follows a convention-based structure to keep your code organized and predictable.

```
.
├── src/
│   ├── api/
│   │   └── products/                  # A feature or resource module
│   │       ├── controller/
│   │       │   └── product.ts         # Business logic for products
│   │       └── routes.ts              # Route definitions for products
│   │
│   ├── config/
│   │   ├── database.ts                # Database connection settings
│   │   ├── plugins.ts                 # Configuration for Fastify plugins (CORS, Helmet, etc.)
│   │   └── roles.ts                   # Custom role definitions
│   │
│   ├── entities/
│   │   └── product.e.ts               # TypeORM entity definitions
│   │
│   ├── hooks/
│   │   └── onRequest.ts               # Custom logic for the 'onRequest' lifecycle hook
│   │
│   ├── middleware/
│   │   └── myMiddleware.ts            # Custom middleware functions
│   │
│   └── schemas/
│       └── product.ts                 # JSON schemas for validation and Swagger
│
├── .env                               # Environment variables
└── index.ts                           # Server entrypoint
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
npm run dev
npm run start
npm run prod
```

When you execute `npm run dev` the server is restarted whenever a .js/.ts file is changed (thanks to [nodemon](https://www.npmjs.com/package/nodemon))

## How to test (logic)

```ts
npm run test
npm run test -t 'Logging'
```

Refer to jest for more options.

## Configuration Reference

### Environment Variables

The framework is configured via `.env` variables. Below is a comprehensive list:

| Variable                 | Description                                                             | Required | Default             |
| ------------------------ | ----------------------------------------------------------------------- | :------: | ------------------- |
| `NODE_ENV`               | The application environment.                                            |    No    | `development`       |
| `HOST`                   | The host address for the server to listen on. Use `0.0.0.0` for Docker. |    No    | `0.0.0.0`           |
| `PORT`                   | The port for the server to listen on.                                   |    No    | `2230`              |
| `JWT_SECRET`             | Secret key for signing JWTs.                                            | **Yes**  |                     |
| `JWT_EXPIRES_IN`         | Expiration time for JWTs (e.g., `5d`, `12h`).                           |    No    | `5d`                |
| `JWT_REFRESH`            | Enable refresh tokens.                                                  |    No    | `true`              |
| `JWT_REFRESH_SECRET`     | Secret key for signing refresh tokens.                                  | **Yes**¹ |                     |
| `JWT_REFRESH_EXPIRES_IN` | Expiration time for refresh tokens.                                     |    No    | `180d`              |
| `LOG_LEVEL`              | Logging verbosity (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). |    No    | `info`              |
| `LOG_COLORIZE`           | Enable colorized log output.                                            |    No    | `true`              |
| `LOG_TIMESTAMP`          | Enable timestamps in logs.                                              |    No    | `true`              |
| `LOG_TIMESTAMP_READABLE` | Use a human-readable timestamp format.                                  |    No    | `true`              |
| `LOG_FASTIFY`            | Enable Fastify's built-in logger.                                       |    No    | `false`             |
| `GRAPHQL`                | Enable the Apollo Server for GraphQL.                                   |    No    | `false`             |
| `SWAGGER`                | Enable Swagger/OpenAPI documentation.                                   |    No    | `true`              |
| `SWAGGER_HOST`           | The base URL for the API, used in Swagger docs.                         |    No    | `localhost:2230`    |
| `SWAGGER_TITLE`          | The title of the API documentation.                                     |    No    | `API Documentation` |
| `SWAGGER_DESCRIPTION`    | The description for the API documentation.                              |    No    |                     |
| `SWAGGER_VERSION`        | The version of the API.                                                 |    No    | `0.1.0`             |
| `SWAGGER_PREFIX_URL`     | The path where Swagger UI is available.                                 |    No    | `/api-docs`         |

¹ Required if `JWT_REFRESH` is enabled.

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
SWAGGER_HOST=localhost:2230
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

## Core Concepts: Routes and Controllers

The routing system is one of the core strengths of the framework. It's file-system based, meaning the framework automatically discovers and registers any `routes.ts` file within the `src/api/` directory.

## Routes

At its simplest, a route needs only a `method`, `path`, and `handler`. The handler is a string that points to a function in a controller file.

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
            $description: 'Successful response',
            type: 'object',
            properties: {
              id: { type: 'number' }
            }$
          }
        } // swagger
      }
    }
  ]
}
```

**Securing a Route with Roles:**
You can easily protect routes using Role-Based Access Control (RBAC). The framework includes built-in roles (`public`, `admin`) and allows you to define your own.

```typescript
{
  method: 'POST',
  path: '/',
  handler: 'product.create',
  roles: [roles.admin] // Only users with the 'admin' role can access this
}
```

**Adding Middleware:**
Apply custom logic before your controller is executed using middleware. The framework comes with `global.isAuthenticated` to ensure a user is logged in.

```typescript
{
  method: 'GET',
  path: '/:id',
  handler: 'product.findOne',
  middlewares: ['global.isAuthenticated'] // Requires a valid JWT, accessible to any role
}
```

**Documenting with Swagger (`config`):**
The `config` object allows you to enrich your route with information for the automatically generated Swagger/OpenAPI documentation.

```typescript
{
  method: 'GET',
  path: '/:id',
  handler: 'product.findOne',
  middlewares: ['global.isAuthenticated'],
  config: {
    title: 'Find a Product',
    description: 'Retrieves a single product by its unique ID.',
    params: { $ref: 'onlyIdSchema#' }, // References a JSON schema for validation
    response: {
      200: {
        description: 'Successful response',
        $ref: 'productSchema#'
      }
    }
  }
}
```

## Controllers

Controllers contain the functions that handle requests. The `req` object is enriched with helpers to simplify data access.

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

### Advanced Data Access with `req.data()` and `@volcanicminds/typeorm`

The real power is unlocked when combining `req.data()` with `@volcanicminds/typeorm`.

```typescript
// src/api/products/controller/product.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { executeFindQuery } from '@volcanicminds/typeorm'

// The 'repository' global is populated by @volcanicminds/typeorm
declare var repository: any

export async function find(req: FastifyRequest, reply: FastifyReply) {
  // req.data() automatically gets all query string (or body!) parameters
  // executeFindQuery translates them into a full TypeORM query with pagination, sorting, and filtering
  const { headers, records } = await executeFindQuery(
    repository.products, // The TypeORM repository for the 'Product' entity
    { category: true }, // Eagerly load the 'category' relation
    req.data()
  )

  // The 'headers' object contains pagination metadata (v-total, v-pageCount, etc.)
  return reply.headers(headers).send(records)
}
```

This single controller function can handle a wide variety of requests without any additional code, such as:

- `GET /products?pageSize=10`
- `GET /products?sort=price:desc`
- `GET /products?name:containsi=widget&category.name:eq=Tools`

**Database Synergy with `@volcanicminds/typeorm`**

While `volcanic-backend` can be used with any data layer, it is designed for seamless integration with its companion package, `@volcanicminds/typeorm`. This combination provides a powerful, query-string-driven API out-of-the-box.

**How it Works:**

1.  **Client Request**: A client sends a request with query parameters for filtering, sorting, and pagination.
    `GET /api/products?page=1&sort=name:asc&price:gt=100`

2.  **`volcanic-backend` Controller**: The controller uses the `req.data()` helper to grab all query parameters.

3.  **`volcanic-typeorm` Translation**: The `executeFindQuery` function from `@volcanicminds/typeorm` receives these parameters and uses its internal `applyQuery` engine to translate them into a rich TypeORM query object, including `where`, `order`, `skip`, and `take` clauses. It automatically handles the syntax for different databases (e.g., `ILIKE` for PostgreSQL, `$regex` for MongoDB).

4.  **Database Execution**: TypeORM executes the optimized query against the database.

5.  **Response with Headers**: `executeFindQuery` returns the records and a set of custom pagination headers (`v-total`, `v-pageCount`, etc.), which the controller then sends back to the client.

This powerful synergy allows you to build complex, high-performance data endpoints with minimal effort. Please refer to the `@volcanicminds/typeorm` `README.md` for a complete guide on its advanced query syntax.

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
npm install @volcanicminds/typeorm
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

Sometimes, it’s useful to have the original raw body of the incoming request. For this purpose, the `rawBody` plugin is available out-of-the-box.

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

## Rate Limit

It is possible to enable rate limiting either globally or at the individual route level. All configuration and functionality are managed by the [Fastify Rate Limit](https://github.com/fastify/fastify-rate-limit) plugin.

At the global configuration level, you can set something like:

```js
// config/plugin.ts
{
    name: 'rateLimit',
    enable: true,
    options: {
      global: true, // default true
      max: 40, // default 1000
      timeWindow: 3000, // default 1000 * 60
      cache: 10000, // default 5000
      nameSpace: 'your-application-ratelimit-', // default is 'fastify-rate-limit-'
      skipOnError: true // default false
    }
  },
```

While at the route level, if necessary, you can redefine or set different rate limits:

```js
// f.e. /api/example/routes.ts
{
      method: 'GET',
      path: '/test',
      roles: [],
      handler: 'example.test',
      middlewares: [],
      rateLimit: {
        max: 10,
        timeWindows: 20000 // milliseconds
      },
      config: {
        title: 'Rate limit example',
        description: 'Rate limit example',
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }

```

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
