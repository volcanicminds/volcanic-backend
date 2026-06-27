[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![opensource](https://img.shields.io/badge/open-source-blue)](https://en.wikipedia.org/wiki/Open_source)
[![volcanic-backend](https://img.shields.io/badge/volcanic-minds-orange)](https://github.com/volcanicminds/volcanic-backend)
[![npm](https://img.shields.io/badge/package-npm-white)](https://www.npmjs.com/package/@volcanicminds/backend)
[![CI](https://github.com/volcanicminds/volcanic-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/volcanicminds/volcanic-backend/actions/workflows/ci.yml)

# volcanic-backend

A Node.js framework based on Fastify to build robust APIs quickly, featuring an automatic routing system, integrated authentication, and a powerful data access layer.

## Two layers in one package

`@volcanicminds/backend` ships a **DB-agnostic HTTP core** and an **optional data layer**, cleanly separated:

- **HTTP Core** (`@volcanicminds/backend`) — Fastify wrapper: routing autodiscovery, JSON-Schema validation,
  JWT/cookie auth, RBAC, MFA gatekeeper, scheduler, and a native API (`/auth`, `/users`, `/token`, `/tenants`,
  `/health`, `/tool`). **Runs with no database.**
- **Data Layer** (subpath `@volcanicminds/backend/typeorm`) — TypeORM wrapper: Magic Query, base entities,
  multi-tenant context, and the managers you inject. Its deps are **optional peer dependencies**.

The layers meet at one seam: `start(decorators)` on the core, into which you inject **managers** (or nothing — it
falls back to Null-Object defaults). See `llms.txt` **Part 0** for the model and **Part 12** for end-to-end
scenarios (public/private, Bearer/Cookie, with/without DB, single/multi-tenant, with `@volcanicminds/tools`).

## Runtime requirements & notable behavior (v3)

- **Node.js ≥ 24**, **pure ESM** (`NodeNext`); CommonJS/`require` is not supported. REST-only (no GraphQL).
- `helmet` security headers are enabled by default.
- Startup **fails fast** on a missing or weak signing secret (`JWT_SECRET`, `JWT_REFRESH_SECRET`, and
  `COOKIE_SECRET` in cookie mode): minimum 32 characters — fatal in production, a warning otherwise.

## Documentation & Guides

**`llms.txt`** is the single, exhaustive, self-contained guide (for humans **and** LLM/Context7 agents): mental
model, configuration, Magic Query, auth, the manager contract, the native API surface, and usage scenarios. The
focused docs below drill into specific topics:

- **[Advanced Architecture](docs/ADVANCED_ARCHITECTURE.md)**: Service Layer pattern, BaseService abstraction, and dependency injection.
- **[Data Layer Magic](docs/DATA_LAYER_MAGIC.md)**: How `req.data()` works and how to turn URLs into complex SQL queries with `@volcanicminds/backend/typeorm`.
- **[Embedded database (PGlite)](docs/PGLITE.md)**: Plug & play in‑process Postgres for dev/test/demos (zero setup), pgvector support, and Postgres‑vs‑PGlite trade‑offs.
- **[Schema Customization](docs/SCHEMA_OVERRIDING.md)**: How to extend core schemas (like Login Response) without forking the framework.
- **[Security & MFA](docs/SECURITY_MFA.md)**: Deep dive into Multi-Factor Authentication policies, Gatekeeper flow, and emergency resets.
- **[TypeScript Guide](docs/TYPESCRIPT_GUIDE.md)**: How to properly extend Request types, global scopes, and inject User Contexts.

## Based on

**Volcanic Backend** is a powerful, opinionated, and extensible Node.js framework for creating robust and scalable RESTful APIs. It's built on modern, high-performance libraries like [Fastify](https://www.fastify.io).

The framework provides a comprehensive set of built-in features including a filesystem-based router, JWT authentication, role-based access control, task scheduling, and seamless database integration, allowing developers to focus on business logic rather than boilerplate.

And, what you see in [package.json](package.json).

## Core Philosophy

- **Convention over Configuration**: A clear and consistent project structure for APIs, controllers, and routes simplifies development and reduces boilerplate.
- **Extensibility**: Easily extendable with custom plugins, hooks, and middleware to fit any project's needs.
- **Database Agnostic**: Designed to work seamlessly with `@volcanicminds/backend/typeorm`, supporting both SQL (e.g., PostgreSQL) and NoSQL (e.g., MongoDB) databases.
- **Feature-Rich**: Out-of-the-box support for JWT authentication, role-based access control (RBAC), automatic Swagger/OpenAPI documentation, and much more.

## Project sample

[Volcanic Backend Sample - GitHub](https://github.com/volcanicminds/volcanic-backend-sample)

## Quick Start

### Installation

```sh
npm install @volcanicminds/backend
```

For database interactions, the data layer is the subpath `@volcanicminds/backend/typeorm`. Install its
optional **peer dependencies** only if you use it:

```sh
npm install typeorm bcrypt pluralize reflect-metadata pg
```

### Minimal Working Example

This example demonstrates how to set up a basic server with a single endpoint.

**1. Create your server entrypoint (`index.ts`):**

```typescript
// index.ts
import { start } from '@volcanicminds/backend'
import { start as startDatabase, userManager } from '@volcanicminds/backend/typeorm'
import { myDbConfig } from './src/config/database.js' // Assume you have a db config file

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
export default {
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
│   │   ├── general.ts                 # General configuration settings
│   │   ├── database.ts                # Database connection settings
│   │   ├── plugins.ts                 # Configuration for Fastify plugins (CORS, Helmet, etc.)
│   │   ├── roles.ts                   # Custom role definitions
│   │   └── tracking.ts                # Auto tracking changes configuration (sperimental)
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
│   ├── schedules/
│   │   └── example.job.ts             # Custom Job schedules (cron, interval)
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

SWAGGER=true
SWAGGER_HOST=myawesome.backend.com
SWAGGER_TITLE=API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemas to use
SWAGGER_VERSION=0.1.0

# MFA
MFA_POLICY=OPTIONAL
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

| Variable                       | Description                                                             | Required | Default             |
| ------------------------------ | ----------------------------------------------------------------------- | :------: | ------------------- |
| `NODE_ENV`                     | The application environment.                                            |    No    | `development`       |
| `HOST`                         | The host address for the server to listen on. Use `0.0.0.0` for Docker. |    No    | `0.0.0.0`           |
| `PORT`                         | The port for the server to listen on.                                   |    No    | `2230`              |
| `JWT_SECRET`                   | Secret key for signing JWTs.                                            | **Yes**  |                     |
| `JWT_EXPIRES_IN`               | Expiration time for JWTs (e.g., `5d`, `12h`).                           |    No    | `5d`                |
| `JWT_REFRESH`                  | Enable refresh tokens.                                                  |    No    | `true`              |
| `JWT_REFRESH_SECRET`           | Secret key for signing refresh tokens.                                  | **Yes**¹ |                     |
| `JWT_REFRESH_EXPIRES_IN`       | Expiration time for refresh tokens.                                     |    No    | `180d`              |
| `LOG_LEVEL`                    | Logging verbosity (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). |    No    | `info`              |
| `LOG_COLORIZE`                 | Enable colorized log output.                                            |    No    | `true`              |
| `LOG_TIMESTAMP`                | Enable timestamps in logs.                                              |    No    | `true`              |
| `LOG_TIMESTAMP_READABLE`       | Use a human-readable timestamp format.                                  |    No    | `true`              |
| `LOG_FASTIFY`                  | Enable Fastify's built-in logger.                                       |    No    | `false`             |
| `SWAGGER`                      | Enable Swagger/OpenAPI documentation.                                   |    No    | `true`              |
| `SWAGGER_HOST`                 | The base URL for the API, used in Swagger docs.                         |    No    | `localhost:2230`    |
| `SWAGGER_TITLE`                | The title of the API documentation.                                     |    No    | `API Documentation` |
| `SWAGGER_DESCRIPTION`          | The description for the API documentation.                              |    No    |                     |
| `SWAGGER_VERSION`              | The version of the API.                                                 |    No    | `0.1.0`             |
| `SWAGGER_PREFIX_URL`           | The path where Swagger UI is available.                                 |    No    | `/api-docs`         |
| `MFA_POLICY`                   | MFA Security Policy (`OPTIONAL`, `MANDATORY`, `ONE_WAY`)                |    No    | `OPTIONAL`          |
| `AUTH_CODE_SIZE`               | Length of the generated authorization codes (nanoid).                   |    No    | `10`                |
| `MFA_APP_NAME`                 | Name of the application displayed in Authenticator apps.                |    No    | `VolcanicApp`       |
| `MFA_ADMIN_FORCED_RESET_EMAIL` | Admin email for emergency MFA reset                                     |    No    |                     |
| `MFA_ADMIN_FORCED_RESET_UNTIL` | ISO Date string until which the reset is active                         |    No    |                     |
| `MFA_ADMIN_FORCED_RESET_UNTIL` | ISO Date string until which the reset is active                         |    No    |                     |
| `AUTH_MODE`                    | Authentication mode: `BEARER` (default) or `COOKIE`                     |    No    | `BEARER`            |
| `COOKIE_SECRET`                | Secret for signing cookies (Required if `AUTH_MODE=COOKIE`)             | **Yes**² |                     |
| `HIDE_ERROR_DETAILS`           | Prevent error details (message) from being sent in response.            |    No    | `true` (prod)       |

² Required if `AUTH_MODE` is `COOKIE`.

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

# Auth Mode: BEARER (default) or COOKIE
AUTH_MODE=BEARER
COOKIE_SECRET=super_secret_cookie_key_change_me
```

## Authentication Modes: Bearer vs Cookie

The framework supports two mutually exclusive authentication modes, controlled by `AUTH_MODE` in `.env`.

### 1. Bearer Token Mode (`AUTH_MODE=BEARER`) - Default

- **Standard API behavior**.
- Login returns `{ token: "...", user: ... }` in the JSON body.
- Client must send `Authorization: Bearer <token>` header for requests.
- **Best for:** Mobile Apps, Server-to-Server.

### 2. Cookie Mode (`AUTH_MODE=COOKIE`)

- **Browser-secure behavior**.
- Login sets an `HttpOnly`, `Secure`, `SameSite=Strict` cookie named `auth_token`.
- Login returns `{ user: ... }` (Token is hidden from JavaScript).
- Authorization header is ignored; the server validates the cookie.
- **Best for:** Single Page Applications (React, Vue, etc.) to prevent XSS token theft.

To enable Cookie mode, you must set `COOKIE_SECRET` in `.env`.

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
export default [
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

## Database Context (`req.db`)

One of the most important features of Volcanic Backend is the **Universal Database Context**.
Every request object (`req`) is guaranteed to have a `req.db` property populated with a valid TypeORM `EntityManager`.

- **Single-Tenant**: `req.db` points to the global default connection.
- **Multi-Tenant**: `req.db` points to an isolated `QueryRunner` for that specific tenant/request.

This allows you to write code that works **Out-Of-The-Box** for both single-tenant and multi-tenant applications without changing a single line of business logic.

**Usage:**

```typescript
// In your controller
const { headers, records } = await myService.use(req.db).findAll(...)
```

---

## Core Concepts: Routes and Controllers

The routing system is one of the core strengths of the framework. It's file-system based, meaning the framework automatically discovers and registers any `routes.ts` file within the `src/api/` directory.

## Routes

At its simplest, a route needs only a `method`, `path`, and `handler`. The handler is a string that points to a function in a controller file.

Minimal setup (routes.ts):

```ts
export default {
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
export default {
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

### Advanced Data Access with `req.data()` and `@volcanicminds/backend/typeorm`

The real power is unlocked when combining `req.data()` with `@volcanicminds/backend/typeorm`.

```typescript
// src/api/products/controller/product.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { executeFindQuery } from '@volcanicminds/backend/typeorm'
import { Product } from '../../../entities/product.e.js'

export async function find(req: FastifyRequest, reply: FastifyReply) {
  // Always resolve the repository from the request-scoped EntityManager (`req.db`):
  // it is multi-tenant safe. NEVER use the `global.repository.X` accessor — it is
  // forbidden at runtime by a fail-fast Proxy.
  const productRepo = req.db.getRepository(Product)

  // req.data() automatically gets all query string (or body!) parameters
  // executeFindQuery translates them into a full TypeORM query with pagination, sorting, and filtering
  const { headers, records } = await executeFindQuery(
    productRepo,
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

**Database Synergy with `@volcanicminds/backend/typeorm`**

While `volcanic-backend` can run with any data layer (or none), it ships a built-in one as the subpath `@volcanicminds/backend/typeorm`. This combination provides a powerful, query-string-driven API out-of-the-box.

**How it Works:**

1.  **Client Request**: A client sends a request with query parameters for filtering, sorting, and pagination.
    `GET /api/products?page=1&sort=name:asc&price:gt=100`

2.  **`volcanic-backend` Controller**: The controller uses the `req.data()` helper to grab all query parameters.

3.  **Data-layer Translation**: The `executeFindQuery` function from `@volcanicminds/backend/typeorm` receives these parameters and uses its internal `applyQuery` engine to translate them into a rich TypeORM query object, including `where`, `order`, `skip`, and `take` clauses. It automatically handles the syntax for different databases (e.g., `ILIKE` for PostgreSQL, `$regex` for MongoDB).

4.  **Database Execution**: TypeORM executes the optimized query against the database.

5.  **Response with Headers**: `executeFindQuery` returns the records and a set of custom pagination headers (`v-total`, `v-pageCount`, etc.), which the controller then sends back to the client.

This powerful synergy allows you to build complex, high-performance data endpoints with minimal effort. See the **[Database (data layer)](#database-data-layer)** section below for the complete query syntax, multi-tenancy rules, and API reference (also in `llms.txt`, Part 3).

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

## Database (data layer)

The data layer (Magic Query + multi-tenant) is the subpath **`@volcanicminds/backend/typeorm`**. It dynamically
translates HTTP query-string parameters into complex pagination, sorting, and filtering queries, with a
database-agnostic abstraction layer that works with both SQL (e.g. PostgreSQL) and NoSQL (e.g. MongoDB) for most
common use cases. Import it directly:

```ts
import { start as startDatabase, userManager, DataSource } from '@volcanicminds/backend/typeorm'
```

Install its optional **peer dependencies** in your app (only if you use the data layer):

```sh
npm install typeorm bcrypt pluralize reflect-metadata pg
```

For the full options and environment variables see `docs/CONFIGURATION.md`; `llms.txt` (Part 3) is the exhaustive
reference. The essentials you need day-to-day are below.

### Embedded engine (PGlite) — zero‑setup Postgres

For local dev, tests, demos and prototypes you can swap the external Postgres for **PGlite**, an in‑process WASM
Postgres — no server, no Docker. Same dialect, same code; just change the config `type`:

```ts
export const database: Database = {
  default: { type: 'pglite', vector: true, synchronize: true } // in-memory; add dataDir to persist
}
```

```sh
npm install typeorm-pglite @electric-sql/pglite   # + @electric-sql/pglite-pgvector for vector:true
```

A real Postgres server stays the production‑grade choice. See **[docs/PGLITE.md](docs/PGLITE.md)** for the full
options, the Postgres‑vs‑PGlite trade‑off table, pgvector usage and multi‑tenant caveats. Run the embedded
integration suite with `npm run test:pglite`.

### Core features

- **Server-Side Pagination**: handle large datasets with `page` and `pageSize`.
- **Multi-Field Sorting**: define complex sort orders directly from the URL.
- **Advanced Dynamic Filtering**: a rich set of filter operators, well beyond simple equality.
- **Nested Relation Queries**: filter and sort on fields of related entities using dot notation.
- **Complex Boolean Logic**: nested `AND`/`OR` conditions via the `_logic` parameter.
- **Hybrid Database Support**: one endpoint that works transparently with PostgreSQL and MongoDB for standard queries.
- **Standalone or Integrated**: use it inside the framework or as a plain TypeORM utility.
- **Security Hardening**: built-in protections against SQL Injection (strict operator control), Prototype Pollution, and ReDoS.

### Core concept

The library bridges flat HTTP query strings and the structured query objects TypeORM expects:

`HTTP Query String` → `applyQuery()` → `TypeORM Query Object`

### Usage

**Integrated (recommended) — `executeFindQuery` does everything:**

```typescript
// src/api/users/controller/user.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { executeFindQuery } from '@volcanicminds/backend/typeorm'
import { User } from '../../../entities/user.e.js' // Your Entity

export async function find(req: FastifyRequest, reply: FastifyReply) {
  // 1. Resolve the repository from the request context (multi-tenant safe)
  const userRepo = req.db.getRepository(User)

  // 2. executeFindQuery handles pagination, sorting, filtering and headers
  const { headers, records } = await executeFindQuery(
    userRepo,
    { company: true }, // Optional relations to include
    req.data()
  )

  return reply.type('application/json').headers(headers).send(records)
}
```

**Standalone — use `applyQuery` directly in any TypeORM project:**

```typescript
import { applyQuery } from '@volcanicminds/backend/typeorm'
import { myUserRepository } from './repositories' // Your TypeORM repository instance

app.get('/users', async (req, reply) => {
  // applyQuery translates the request query into a TypeORM query object
  const typeOrmQuery = applyQuery(req.query, {}, myUserRepository)

  const [records, total] = await myUserRepository.findAndCount(typeOrmQuery)

  reply.send({ data: records, total })
})
```

### Query string guide

**Pagination** — `page` (default `1`) and `pageSize` (default `25`).
`GET /users?page=2&pageSize=50`

**Sorting** — `sort=field` (asc) or `sort=field:desc`; repeat for multi-field sorting.
`GET /users?sort=lastName:asc&sort=createdAt:desc`

**Filtering** — `field:operator=value`. With no operator it defaults to equality (`:eq`).

> **Case sensitivity (since v3).** The text operators are **case-INsensitive by default**: `?name=mario` matches
> "Mario". The convention is **base = insensitive**, suffix **`s` = strict/case-sensitive**, suffix **`i` =
> insensitive (explicit alias)**. So `:eq` ⇄ `:eqi` (insensitive) and `:eqs` (sensitive). `:eq` stays
> **type-aware**: numbers/booleans/null use exact matching (no `ILIKE` on an `int` column). Flip the global default
> with the data-layer option `caseInsensitiveByDefault: false` (or env `VOLCANIC_CASE_INSENSITIVE_DEFAULT=false`)
> to restore legacy case-sensitive base operators. Note: insensitive matching can't use a plain B-tree index —
> prefer `*s` for indexed exact lookups.

| Operator | Description | Example | PostgreSQL | MongoDB |
| :--- | :--- | :--- | :--: | :--: |
| `:eq` · `:eqi` · `:eqs` | Equals — insensitive · insensitive · **strict** | `...&country=it` | ✅ | ✅ |
| `:neq` · `:neqi` · `:neqs` | Not equals (same scheme) | `...&status:neq=archived` | ✅ | ✅ |
| `:gt` `:ge` `:lt` `:le` | Greater/less than (or equal) | `...&visits:gt=100` | ✅ | ✅ |
| `:between` · `:nbetween` | (NOT) between two values, colon-sep. | `...&created:between=2024-01-01:2024-12-31` | ✅ | ✅ |
| `:in` · `:nin` | (NOT) included in a comma list | `...&status:in=active,pending` | ✅ | ✅ |
| `:null` · `:notNull` | Is (not) null | `...&deletedAt:null=true` | ✅ | ✅ |
| `:isEmpty` · `:isNotEmpty` | Equals (not) empty string `''` | `...&note:isEmpty=1` | ✅ | ✅ |
| `:contains` · `:containss` · `:containsi` | Contains — insensitive · **strict** · insensitive | `...&name:contains=corp` | ✅ | ✅* |
| `:ncontains` · `:ncontainss` · `:ncontainsi` | Does NOT contain | `...&tag:ncontains=old` | ✅ | ✅* |
| `:starts` · `:startss` · `:startsi` · `:nstarts…` | (NOT) starts with | `...&code:starts=inv-` | ✅ | ✅* |
| `:ends` · `:endss` · `:endsi` · `:nends…` | (NOT) ends with | `...&file:ends=.pdf` | ✅ | ✅* |
| `:like` · `:likes` · `:likei` · `:nlike…` | (NOT) manual `LIKE` pattern | `...&code:like=a-%` | ✅ | ✅* |
| `:overlap` | Array overlap `&&` (common elements) | `...&tags:overlap=acme,globex` | ✅ | ✅ |
| `:arrayContains` | Array contains all `@>` | `...&tags:arrayContains=fruit,red` | ✅ | ✅ |
| `:arrayContainedBy` | Array contained by `<@` | `...&tags:arrayContainedBy=a,b,c` | ✅ | ✅ |
| `:raw` | Raw SQL ⚠️ **Dangerous** — disabled by default (see security note). | `...&age:raw=> 18` | ✅ | ✅ |

\* The `s`/`i` text variants map to `LIKE`/`ILIKE` on Postgres and to (case-insensitive) `RegExp` on MongoDB.

**Nested relation filters** — dot notation on related entities:
`GET /users?company.name:eq=Volcanic Minds`

**Complex boolean logic with `_logic`** — give conditions short aliases and combine them with nested `AND`/`OR`.
Syntax: `field:operator[alias]=value` (the `[alias]` is optional; it defaults to the full parameter key).

```text
# Find users whose first name is 'Mario' OR last name is 'Rossi'
?firstName:eq[fn]=Mario&lastName:eq[ln]=Rossi&_logic=(fn OR ln)

# (active users from Italy) OR (pending users from Germany)
?status:eq[s1]=active&country:eq[c1]=IT&status:eq[s2]=pending&country:eq[c2]=DE&_logic=((s1 AND c1) OR (s2 AND c2))
```

### Security: sensitive fields & the `:raw` operator

- **Sensitive fields are blocked from filtering** by default: `password`, `mfaSecret`, `resetPasswordToken`,
  `confirmationToken`. Override the list via `start({ ..., sensitiveFields: ['password', 'ssn'] })` or at runtime
  with `configureSensitiveFields(fields)`.
- The **`:raw` operator is disabled by default** (it allows raw SQL fragments → SQL-injection risk). Enable it
  only if you fully control the input by setting `VOLCANIC_CUSTOM_QUERY_OPERATORS=true` in your environment. Use
  with **extreme caution**.

### Multi-Tenancy (Unified Context Pattern)

Postgres multi-tenancy is enforced via schema isolation (`SET search_path`) with a strict, leak-proof pattern.

**Global context switching is forbidden.** `switchContext(tenant)` without an `EntityManager` throws a fatal
error — changing the global `search_path` would poison the shared pool and leak data across tenants. Always pass
the `EntityManager` of a dedicated `QueryRunner`:

```typescript
// ❌ FORBIDDEN — throws "CRITICAL: Attempted UNSAFE global context switch"
await tenantManager.switchContext(tenant)

// ✅ CORRECT — bound to a single QueryRunner
const qr = dataSource.createQueryRunner()
await qr.connect()
await tenantManager.switchContext(tenant, qr.manager)
```

**Tenant resolution is strict.** `resolveTenant(req)` requires the tenant header (default `x-tenant-id`). If the
JWT carries a tenant binding (`req.user.tid`) and it does **not** match the header, the request is **rejected**
(tenant-isolation / IDOR protection). Only `active` tenants resolve.

**Background jobs / system tasks** must use the helper, which creates, switches, and safely releases a
`QueryRunner` (always resetting `search_path` to `public` on exit):

```typescript
await tenantManager.runInTenantContext('tenant-slug', async (em) => {
  // `em` is an isolated EntityManager already bound to the tenant schema
  return em.getRepository(Order).find()
})
```

### API reference

- **`start(options)`** — initializes the database connection. `options` may include `sensitiveFields` (string[]) to customize the blocked-filter list.
- **`configureSensitiveFields(fields)`** — update the sensitive-fields list at runtime.
- **`executeFindQuery(repo, relations, data, extraWhere?, extraOptions?)`** — high-level find-and-count: processes all parameters and returns `{ headers, records }`.
- **`executeCountQuery(repo, data, extraWhere?)`** — count records matching the filters.
- **`applyQuery(data, extraWhere, repo)`** — the core translation function: raw query params → TypeORM query object.
- **`useWhere(where, repo)`** — translate only the filter part of the query.
- **`useOrder(order)`** — translate only the sorting part of the query.

`executeFindView` / `executeCountView` are the view-backed counterparts, with the same signatures.

### Useful scripts

- `node generate-hash.js <my-string>` — generate a bcrypt hash for a given string (passwords / seeding / testing).

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

export default {
  name: 'general',
  options: {
    reset_external_id_on_login: true
  }
}
```

## Multi-Factor Authentication (MFA)

The framework provides a robust, built-in Multi-Factor Authentication system based on TOTP (Time-Based One-Time Password).

For detailed configuration, security policies, and setup flows, please refer to the **[Security & MFA Guide](docs/SECURITY_MFA.md)**.

MFA behavior is controlled globally via environment variables (`MFA_POLICY`) or the configuration file `src/config/general.ts`.

### MFA Policies

- **OPTIONAL** (Default): Users can choose to enable or disable MFA from their profile.
- **MANDATORY**: MFA is enforced for all users.
  - If a user has not set up MFA yet, upon login, they receive a `202 Accepted` response with a temporary token and must complete the setup to proceed.
  - Users cannot disable MFA.
- **ONE_WAY**: MFA is optional to start with, but once enabled, the user cannot disable it themselves. Only an admin can reset it.

**_Note_**: In all cases, an administrator **can** force an MFA reset for a user.

## Disable embedded authorization

Out-of-the-box, the framework automatically secures all routes by checking for a valid (Bearer) JWT token if roles are defined for that route. However, if you want to disable this automatic authorization check and handle it manually within your controllers or middleware, you can do so by setting the `embedded_auth` option to `false`.

```ts
// src/config/general.ts
'use strict'

export default {
  name: 'general',
  options: {
    embedded_auth: false
  }
}
```

## Job Scheduler

It's possible to add a job scheduler. For more information, go to [Fastify Schedule](https://github.com/fastify/fastify-schedule). To enable this feature, it's necessary to add or change the property `scheduler` to `true` (the default is `false`).

```ts
// src/config/general.ts
'use strict'

export default {
  name: 'general',
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
