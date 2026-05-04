# Index: The Volcanic Stack - Definitive Backend Guide

1.  **[Part 1: Foundations and Infrastructure](#part-1-foundations-and-infrastructure)**
    - **1.1 Introduction and Stack Philosophy**
      - The Three Pillars (`backend`, `typeorm`, `tools`)
      - Architectural Principles (Thin Controllers, Fat Services)
      - The "Globals" Pattern
    - **1.2 Project Structure**
      - Folder Anatomy and Autodiscovery
    - **1.3 Bootstrapping (`index.ts`)**
      - DB and Server startup orchestration
    - **1.4 Database Configuration (Production Grade)**
      - Custom Naming Strategy
      - SSL Management and Connection Pool (`pg` driver)
    - **1.5 Environment Variables (Reference)**

2.  **[Part 2: Deep Dive Data Modeling & Entities](#part-2-deep-dive-data-modeling--entities)**
    - **2.1 Anatomy of a Volcanic Entity**
      - Active Record (`BaseEntity`) and Decorators
      - Global Access (`global.entity`)
    - **2.2 Type and Enum Management**
      - TypeScript Enum vs Postgres Enum
    - **2.3 Advanced Relationship Management**
      - One-to-One, Many-to-One, One-to-Many
      - Avoiding Circular Dependencies (using strings)
    - **2.4 Relationship Options: Performance Tuning**
      - `eager` vs `lazy` strategies
      - Referential integrity (`onDelete: CASCADE`)
    - **2.5 Logic in Entities: Computed Fields & Hooks**
      - Virtual fields and `@AfterLoad` decorator
    - **2.6 SQL Views and `@ViewEntity`**
      - Complex reporting and aggregations
    - **2.7 Modeling Best Practices**

3.  **[Part 3: Magic Queries & Data Access](#part-3-magic-queries--data-access)**
    - **3.1 Translation Layer: URL to SQL**
      - Translation flow and usage (`executeFindQuery`)
    - **3.2 Filter Operator Reference**
      - Complete table (`:eq`, `:gt`, `:like`, `:in`, `:null`, etc.)
    - **3.3 Deep Filtering (Relational Filters)**
      - Dot Notation on relations (e.g., `client.name`)
    - **3.4 Advanced Boolean Logic (`_logic`)**
      - Building complex queries `(A OR B) AND C`
    - **3.5 Pagination and Sorting**
      - Input Parameters and Response Headers (`v-total`)
    - **3.6 Customizing QueryBuilder (Global Search)**

4.  **[Part 4: API Layer (Routing & Controllers)](#part-4-api-layer-routing--controllers)**
    - **4.1 Route Autodiscovery**
      - File matching rules
    - **4.2 `routes.ts` Configuration**
      - Structure and Swagger configuration
    - **4.3 Controllers: Best Practices**
      - Input Normalization (`req.data`) and Relations
      - Accessing Context (`req.userContext`)
    - **4.4 Implementation Pattern: From Controller to Service**
      - Complete practical example
    - **4.5 Middleware: Global vs Local**
      - Mixed configuration in `routes.ts`
    - **4.6 JSON Schemas & Validation**

5.  **[Part 5: Service Layer Architecture](#part-5-service-layer-architecture)**
    - **5.1 The `BaseService` Pattern**
      - CRUD Abstraction and `use(req.db)` Hook
    - **5.2 Security Context & RLS (Row Level Security)**
      - `applyPermissions` implementation
    - **5.3 Advanced QueryBuilder**
      - Automatic Joins (`addRelations`) and computed fields
    - **5.4 Transaction Management (Complex Writes)**
      - Using manual `QueryRunner`
    - **5.5 Globals vs Dependency Injection**
      - Singleton Pattern and Repository access
    - **5.6 Caching**

6.  **[Part 6: Authentication and Security](#part-6-authentication-and-security)**
    - **6.1 Auth Stack & JWT Lifecycle**
      - Access Token, Refresh Token, and Revocation (`externalId`)
      - Dual Mode Support (Bearer vs Cookie HttpOnly)

### 6.1.1 Dual Mode Configuration

The system supports two mutually exclusive authentication modes, configurable via the `AUTH_MODE` environment variable.

1.  **Bearer Token Mode** (`AUTH_MODE=BEARER`): Standard behavior. Token is returned in login body and must be sent in `Authorization: Bearer <token>` header. Ideal for Mobile Apps and S2S.
2.  **Cookie Mode** (`AUTH_MODE=COOKIE`): Browser-secure behavior. Token is set in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Login body does not contain the token. Client does not need to manage the token manually. Requires `COOKIE_SECRET` in `.env`.
    - **Logout**: In Cookie mode, the `/auth/logout` route clears the `auth_token` cookie.

    - **6.2 Multi-Factor Authentication (MFA)**
      - Policy and "Gatekeeper" Flow (Pre-Auth Token)
      - Adapters and Tools
    - **6.3 Role Based Access Control (RBAC)**
      - Role Definition and Route Gatekeepers
    - **6.4 Context Injection & TypeScript**
      - Type extension and `preHandler` Hook
    - **6.5 Emergency Admin Reset**

3.  **[Part 7: Validation, Utilities, Scheduler, and Testing](#part-7-validation-utilities-scheduler-and-testing)**
    - **7.1 JSON Schema Validation and Schema Overriding**
      - Extending core schemas (e.g., Login Response)
    - **7.2 Core Utilities (`@volcanicminds/tools`)**
      - Structured Logging (Pino) and Mailer
    - **7.3 Job Scheduler**
      - Cron/Interval Jobs configuration
    - **7.4 Audit Tracking (Change Tracking)**
      - Automatic Change Data Capture configuration
    - **7.5 Testing Strategies**
      - Setup, E2E, and Unit Tests

4.  **[Part 8: System Administration and Deployment](#part-8-system-administration-and-deployment)**
    - **8.1 Server Hardening (Ubuntu/Linux)**
      - UFW Firewall and Base Stack
    - **8.2 Nginx: Reverse Proxy & Security Gateway**
      - Rate Limiting, SSL, Security Headers
    - **8.3 Docker Deployment Strategy**
      - Production Env configuration and Run commands
    - **8.4 Continuous Deployment ("Poor Man's CI/CD")**
      - Auto-update scripts and Crontab
    - **8.5 Database Operations**
      - Extensions, Wipe, and Secure Seeding
    - **8.6 Diagnostics and Monitoring**

5.  **[Part 9: GraphQL & Apollo Integration](#part-9-graphql--apollo-integration)**
    - **9.1 Activation and Configuration**
    - **9.2 Authentication and UserContext**
      - Adapting Context for GraphQL
    - **9.3 Schema First: TypeDefs and Resolvers**
      - Mapping Resolvers to existing Services
    - **9.4 Advanced Pattern: GraphQL to Magic Query Bridge**
    - **9.5 Performance: The N+1 Problem**
    - **9.6 Integration Summary**

6.  **[Part 10: Advanced Patterns and Troubleshooting](#part-10-advanced-patterns-and-troubleshooting)**
    - **10.1 Data Seeding & Maintenance**
      - API-driven approach (`src/api/tools`)
    - **10.2 Enum and Constant Management**
      - Centralizing definitions
    - **10.3 Troubleshooting: Common Errors and Solutions**
      - Circular Dependency, Relation Not Found, Access Denied
    - **10.4 Production Release Checklist**

# Part 1: Foundations and Infrastructure

This section covers the essentials for understanding how the framework orchestrates the server, the database, and global dependencies. It is not just about starting a Node.js process, but setting up a scalable, secure, and strongly-typed architecture.

## 1.1 Introduction and Stack Philosophy

The framework is an **opinionated** system composed of three modular packages working in synergy to eliminate _boilerplate code_.

### The Three Pillars

1.  **`@volcanicminds/backend` (Server Core)**
    - **Fastify** wrapper.
    - Manages the HTTP lifecycle, automatic route loading (`Auto-Discovery`), JSON Schema validation, and the Global Hooks system.
    - Natively integrates the Authentication system (JWT, Refresh Token) and Security (MFA Gatekeeper).
    - **Universal Database Context**: Automatically injects strictly-scoped `EntityManager` into `req.db` (Single & Multi-Tenant support).
2.  **`@volcanicminds/typeorm` (Data Layer)**
    - **TypeORM** wrapper.
    - Introduces **"Magic Queries"**: a translation engine that automatically converts complex query strings (filters, sort, pagination, boolean logic) into optimized SQL.
    - Manages database connection and Entity initialization.
3.  **`@volcanicminds/tools` (Utilities)**
    - A _tree-shakeable_ support library.
    - Provides standardized tools for Logger, Mailer, and MFA/OTP code generation.

### Architectural Principles

Every line of code in the project must adhere to these principles:

- **Thin Controllers ("Adapters"):** Controllers contain no business logic. Their only job is to normalize input (`req.data()`), extract user context (`req.userContext`), call a Service, and return the response.
- **Fat Services ("Business Logic"):** All logic, transactions, and data security controls reside here. Services do not know about `req` or `res`.
- **Secure by Default:** Data access is never direct. It always passes through methods requiring a `UserContext` to apply security filters (Row Level Security).

### The "Globals" Pattern

Unlike architectures that use explicit Dependency Injection everywhere, the Volcanic Stack injects certain key utilities into the Node.js `global scope` during bootstrap. This drastically reduces circular imports and speeds up development.

- **`log`**: Pino Logger instance. Available everywhere.
- **`entity.[PascalCase]`**: Direct access to the Entity class (e.g., `entity.User`). Useful for static methods like `.create()`.
- **`repository.[camelCasePlural]`**: Connected TypeORM Repository instance (e.g., `repository.users`). Automatically pluralized.
- **`config`**: Configuration loaded at startup.

---

## 1.2 Project Structure

The framework uses an **autodiscovery** system based on `glob` patterns. Adhering to the folder structure is mandatory for routes, entities, and configurations to be loaded.

```bash
./
├── .env                    # Environment variables (SECRETS)
├── package.json            # type: "module" (ESM), engines: node >= 24
├── tsconfig.json           # target: "ES2022", module: "NodeNext"
├── index.ts                # Entry Point (Bootstrap)
├── types                   # Custom TypeScript definitions
│   └── index.d.ts          # Global types extension (FastifyRequest, UserContext)
└── src
    ├── api                 # FUNCTIONAL MODULES (Domain Driven)
    │   └── [domain_name]   # e.g., "orders", "users"
    │       ├── controller  # Control logic (HTTP handling)
    │       │   └── [name].ts
    │       └── routes.ts   # Endpoint definition, Swagger, and Middleware
    ├── config              # GLOBAL CONFIGURATIONS
    │   ├── database.ts     # TypeORM and Pool configuration
    │   ├── general.ts      # Framework Config (MFA, Scheduler)
    │   ├── plugins.ts      # Fastify Plugins (CORS, Helmet, RateLimit)
    │   ├── roles.ts        # Static RBAC Role definition
    │   └── tracking.ts     # Automatic Audit Log configuration
    ├── entities            # DATA MODELS (TypeORM .e.ts)
    ├── services            # BUSINESS LOGIC (Service Layer)
    ├── schemas             # JSON SCHEMAS (Validation & Swagger Override)
    ├── hooks               # GLOBAL HOOKS (e.g., preHandler for UserContext)
    ├── schedules           # CRON JOBS (*.job.ts)
    └── utils               # Helper functions
```

---

## 1.3 Bootstrapping (`index.ts`)

The `index.ts` file is the entry point. It orchestrates starting the database before the server and injects dependencies critical for the integrated auth core.

```typescript
'use strict'

import { start as startServer, yn } from '@volcanicminds/backend'
import { start as startDatabase, userManager, DataSource } from '@volcanicminds/typeorm'
// Import the MFA adapter from tools (concrete implementation)
import { mfaAdapter } from './src/services/mfa.adapter.js'
// Import DB config
import { database } from './src/config/database.js'

const start = async () => {
  let db: DataSource | null = null

  // 1. Start Database (Conditional or Mandatory depending on ENV)
  if (yn(process.env.START_DB, true)) {
    const options = database?.default || {}
    // startDatabase initializes TypeORM and populates global.repository / global.entity
    db = await startDatabase(options)

    if (db && log.i) {
      const opts = db.options as any
      log.info(`Database attached at ${opts.host}:${opts.port} (${opts.database})`)
    }
  } else {
    if (log.w) log.warn('Database not loaded, check START_DB property on environment')
  }

  // 2. Start Server
  // It is CRUCIAL to pass 'userManager' (from typeorm) and 'mfaManager' (adapter)
  // This allows the backend framework to handle /auth/* routes (login, refresh, mfa)
  // using your DB logic without the framework knowing your entities beforehand.
  await startServer({
    userManager: userManager, // Handles user CRUD and password validation
    mfaManager: mfaAdapter // Handles OTP generation/verification
  })
}

start().catch((err) => {
  console.error('Fatal Error during startup:', err)
  process.exit(1)
})
```

---

## 1.4 Database Configuration (Production Grade)

Reference file: `src/config/database.ts`.

This configuration is optimized for production environments (PostgreSQL) and handles pooling, timeouts, and conditional SSL.

### 1. Custom Naming Strategy

PostgreSQL uses `snake_case`, TypeScript uses `camelCase`. This strategy enforces a predictable conversion.

```typescript
import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm'

class CustomNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  // Converts "firstName" to "first_name"
  columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    return embeddedPrefixes
      .concat(customName || propertyName)
      .map((s, i) => (i > 0 ? s.replace(/^(.)/, (c) => c.toUpperCase()) : s))
      .join('')
  }
}
```

### 2. SSL Management and Full Configuration

The `extra` object passes parameters directly to the `node-postgres` (`pg`) driver, essential for network stability.

```typescript
import { Database } from '@volcanicminds/typeorm'
import { GLOBAL_CACHE_TTL } from './constants.js'
import fs from 'node:fs'

const isTrue = (val: string | undefined, defaultVal: boolean) => {
  if (val === undefined) return defaultVal
  return val === 'true' || val === '1'
}

// Logic for SSL certificates (e.g., for AWS RDS or OVH)
const getSslConfig = () => {
  if (process.env.DB_SSL !== 'true') return false
  if (process.env.DB_SSL_CA_PATH) {
    try {
      return {
        rejectUnauthorized: true,
        ca: fs.readFileSync(process.env.DB_SSL_CA_PATH).toString()
      }
    } catch (e) {
      console.error('SSL CA Load Error:', e)
      return { rejectUnauthorized: false } // Fallback
    }
  }
  return { rejectUnauthorized: false }
}

export const database: Database = {
  default: {
    type: 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,

    // NEVER use synchronize: true in production (risk of data loss)
    synchronize: false,
    logging: isTrue(process.env.DB_LOGGING, true),
    namingStrategy: new CustomNamingStrategy(),

    // Pool Settings (TypeORM level)
    connectTimeoutMS: Number(process.env.DB_CONNECTION_TIMEOUT) || 60000,
    poolSize: Number(process.env.DB_MAX_CONNECTING) || 50,

    // Native Driver Settings (pg)
    extra: {
      application_name: process.env.APP_NAME || 'volcanic-sample-backend',

      // Connection Pool Tuning
      max: Number(process.env.DB_MAX_CONNECTING) || 50,
      min: Number(process.env.DB_MIN_CONNECTING) || 5,
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT) || 30000,

      // Network Stability (KeepAlive prevents Idle connections from being cut by Load Balancers)
      keepAlive: isTrue(process.env.DB_KEEP_ALIVE, true),
      keepAliveInitialDelayMillis: 10000,

      // Safety Timeouts (prevents zombie queries)
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT) || 60000,
      query_timeout: Number(process.env.DB_QUERY_TIMEOUT) || 65000
    },

    ssl: getSslConfig(),

    // Query caching on a dedicated DB table
    cache: {
      type: 'database',
      tableName: 'query_result_cache',
      duration: GLOBAL_CACHE_TTL || 60000
    }
  }
}
```

---

## 1.5 Environment Variables (Reference)

An example `.env` for production.

| Variable                       | Description                                                             | Required | Default             |
| ------------------------------ | ----------------------------------------------------------------------- | :------: | ------------------- |
| `NODE_ENV`                     | The application environment.                                            |    No    | `development`       |
| `HOST`                         | The host address for the server. Use `0.0.0.0` for Docker.              |    No    | `0.0.0.0`           |
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
| `GRAPHQL`                      | Enable the Apollo Server for GraphQL.                                   |    No    | `false`             |
| `SWAGGER`                      | Enable Swagger/OpenAPI documentation.                                   |    No    | `true`              |
| `SWAGGER_HOST`                 | The base URL for the API, used in Swagger docs.                         |    No    | `localhost:2230`    |
| `SWAGGER_TITLE`                | The title of the API documentation.                                     |    No    | `API Documentation` |
| `SWAGGER_DESCRIPTION`          | The description for the API documentation.                              |    No    |                     |
| `SWAGGER_VERSION`              | The version of the API.                                                 |    No    | `0.1.0`             |
| `SWAGGER_PREFIX_URL`           | The path where Swagger UI is available.                                 |    No    | `/api-docs`         |
| `MFA_POLICY`                   | MFA Security Policy (`OPTIONAL`, `MANDATORY`, `ONE_WAY`)                |    No    | `OPTIONAL`          |
| `MFA_ADMIN_FORCED_RESET_EMAIL` | Admin email for emergency MFA reset                                     |    No    |                     |
| `MFA_ADMIN_FORCED_RESET_UNTIL` | ISO Date string until which the reset is active                         |    No    |                     |
| `HIDE_ERROR_DETAILS`           | Prevent error details (message) from being sent in response.            |    No    | `true` (prod)       |

¹ Required if `JWT_REFRESH` is enabled.

---

## 1.7 Single vs Multi-Tenant Architecture

The framework supports both architectures OOTB. The behavior is controlled by `req.db`.

- **Single-Tenant** (Default): `req.db` is injected from the global connection pool. Zero overhead.
- **Multi-Tenant**: If enabled, `req.db` is injected from a dedicated `QueryRunner` that isolates data (e.g., via `SET search_path`).

To enable multi-tenancy, configure `src/config/general.ts`:

```typescript
export default {
  options: {
    multi_tenant: {
      enabled: true,
      resolver: 'header', // or 'subdomain', 'query'
      header_key: 'x-tenant-id'
    }
  }
}
```

Here is a full configuration file:

```properties
# --- Server ---
NODE_ENV=production
HOST=0.0.0.0
PORT=2230
APP_NAME=volcanic-sample-backend
HIDE_ERROR_DETAILS=true

# --- Database ---
START_DB=true
DB_HOST=10.0.0.5
DB_PORT=5432
DB_NAME=db_prod
DB_USERNAME=admin
DB_PASSWORD=secret_password
DB_SSL=true
DB_SSL_CA_PATH=/usr/src/app/certs/ca.pem

# --- Pool & Timeouts ---
DB_MAX_CONNECTING=50
DB_MIN_CONNECTING=5
DB_STATEMENT_TIMEOUT=60000
DB_IDLE_TIMEOUT=30000
DB_KEEP_ALIVE=true
DB_CONNECTION_TIMEOUT=60000
DB_QUERY_TIMEOUT=65000

# --- Auth & Security ---
# Generate with: openssl rand -base64 64
JWT_SECRET=super_secret_key_change_me
JWT_EXPIRES_IN=1h
JWT_REFRESH=true
JWT_REFRESH_SECRET=super_secret_refresh_key_change_me
JWT_REFRESH_EXPIRES_IN=30d

# MFA
MFA_POLICY=OPTIONAL
MFA_ADMIN_FORCED_RESET_EMAIL=admin@example.com
MFA_ADMIN_FORCED_RESET_UNTIL=2025-01-01T00:00:00.000Z

# --- API Documentation ---
SWAGGER=true
SWAGGER_HOST=localhost:2230
SWAGGER_TITLE=API Documentation
SWAGGER_DESCRIPTION=List of available APIs and schemas to use
SWAGGER_VERSION=0.1.0
SWAGGER_PREFIX_URL=/api-docs

# --- GraphQL ---
GRAPHQL=false

# --- Logging ---
LOG_LEVEL=info
LOG_COLORIZE=false
LOG_TIMESTAMP=true
LOG_TIMESTAMP_READABLE=true
LOG_FASTIFY=false
```

---

## 1.6 Fastify Plugin Configuration (Rate Limit, Raw Body)

You can enable and configure native Fastify plugins via the `src/config/plugins.ts` file.

### Raw Body

Useful for webhooks (e.g., Stripe) that require the raw payload for signature validation.

```typescript
{
  name: 'rawBody',
  enable: true,
  options: {
    global: false, // If true, adds rawBody to all requests (memory intensive)
    runFirst: true // Parses before other hooks
  }
}
```

If `global: false`, you can enable it on a single route in `routes.ts`:

```typescript
config: {
  rawBody: true
}
```

### Rate Limit

Protects the API from abuse. Global configuration in `plugins.ts`:

```typescript
{
  name: 'rateLimit',
  enable: true,
  options: {
    global: true,
    max: 100,
    timeWindow: 60000 // 1 minute
  }
}
```

You can override limits per route by defining the `rateLimit` object in the route definition.

---

# Part 2: Deep Dive Data Modeling & Entities

In `@volcanicminds/typeorm`, the Data Layer is not just a table mapper (ORM), but the engine enabling "Magic Query" and "Auto-Discovery" features.

Entities in this stack follow the **Active Record** pattern (extending `BaseEntity`), meaning the entity itself possesses methods for saving and finding (`User.save()`, `User.findOne()`).

## 2.1 Anatomy of a Volcanic Entity

Every entity file must reside in `src/entities/` and have the `.e.ts` extension (e.g., `user.e.ts`). This is fundamental for the automatic loader.

### Standard Base Structure

Every entity must extend `BaseEntity` and define a Primary Key (preferably UUID) and audit fields (`createdAt`, `updatedAt`).

**Example: `src/entities/client.e.ts`**

```typescript
import {
  Entity,
  Unique,
  Index,
  BaseEntity,
  Column,
  OneToMany,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn
} from 'typeorm'

// Import the type for the relationship (using 'import type' to avoid runtime cycles)
import type { Order } from './order.e.js'

@Entity() // Table name: 'client' (automatic snake_case)
@Unique(['code']) // DB Constraint: client code must be unique
export class Client extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  // INDEX: Fundamental for search and join performance
  @Index()
  @Column({ nullable: false, type: 'varchar' })
  code: string

  @Column({ nullable: false, type: 'varchar' })
  name: string

  // Native Postgres Array (very performant for simple lists)
  @Column('text', { array: true, default: [] })
  companies: string[]

  // OneToMany Relationship (Lazy by default in this project)
  // Note: We use the string 'Order' to refer to the other entity
  @OneToMany('Order', (order: Order) => order.client, { lazy: true })
  orders: Promise<Order[]>
}
```

### Global Access (`global.entity`)

At bootstrap, the framework populates the global `entity` object.
Although importing the class is preferred for Type Safety, `entity` is useful in seeding scripts or dynamic contexts.

- `import { Client } from ...` -> Standard usage.
- `entity.Client` -> Runtime instance loaded (useful in `src/utils/initialData.ts`).

---

## 2.2 Type and Enum Management

In `volcanic-sample-backend`, Enums are centralized in `src/entities/all.enums.ts`. This avoids duplication and magic strings.

**Example: Enum Management (`UserLanguage`)**

```typescript
// src/entities/all.enums.ts
export enum UserLanguage {
  EN = 'en',
  IT = 'it'
}
```

**Usage in Entity (`src/entities/user.e.ts`)**

```typescript
@Column({
  type: 'enum', // Native Postgres ENUM type
  enum: UserLanguage,
  default: UserLanguage.EN,
  nullable: false
})
language: UserLanguage
```

> **Best Practice**: If enum values are expected to change often, it is better to use `type: 'varchar'` and handle validation via code/schema to avoid complex DB migrations (DROP TYPE enum).

---

## 2.3 Advanced Relationship Management

Relationship management is where most errors occur (Circular Dependency).
**Golden Rule:** Always use **strings** (e.g., `'Order'`, `'Client'`) in decorators, never the imported class directly as a value.

### One-to-One (`User` <-> `Professional`)

This relationship is critical: it links the login account (`User`) to the personal profile (`Professional`).

```typescript
// src/entities/user.e.ts (Owner Side)
@Entity()
export class User extends UserEx {
  // ...

  // EAGER: TRUE -> Always loads the profile when reading the user
  // NULLABLE: TRUE -> A user (e.g., pure admin) might not have a professional profile
  @OneToOne('Professional', { eager: true, nullable: true })
  @JoinColumn() // Creates the physical column 'professionalId'
  professional: Professional
}

// src/entities/professional.e.ts (Inverse Side)
@Entity()
export class Professional extends BaseEntity {
  // ...

  // Inverse side for navigation
  @OneToOne('User', (user: User) => user.professional, { lazy: true })
  user: Promise<User>
}
```

### Many-to-One / One-to-Many (`Order` <-> `WorkOrder`)

Classic Parent-Child hierarchy.

```typescript
// src/entities/workOrder.e.ts (Child)
@Entity()
export class WorkOrder extends BaseEntity {
  // ...

  // ManyToOne is the side possessing the Foreign Key ('orderId')
  // INDEX: Essential to filter work orders of an order
  @Index()
  @ManyToOne('Order', { eager: false, nullable: false })
  @JoinColumn()
  order: Order
}

// src/entities/order.e.ts (Parent)
@Entity()
export class Order extends BaseEntity {
  // ...

  // LAZY: TRUE -> Fundamental not to download thousands of WOs when reading an Order
  @OneToMany('WorkOrder', (workOrder: WorkOrder) => workOrder.order, { lazy: true })
  workOrders: Promise<WorkOrder[]>
}
```

---

## 2.4 Relationship Options: Performance Tuning

Options passed to decorators determine the loading strategy and referential integrity.

### 1. `eager` vs `lazy`

- **`eager: true`**: TypeORM performs an automatic `LEFT JOIN`.
  - _Where to use:_ Critical 1:1 relations (`User.professional`) or small lookup tables (`Order.state`, `Order.type`).
  - _Where to avoid:_ 1:N relations or heavy entities.
- **`lazy: true`**: Returns a `Promise`. Data is loaded only if requested.
  - _Where to use:_ Collections (`Client.orders`, `Order.workOrders`).

### 2. `onDelete: 'CASCADE'`

Defines DB behavior when the parent record is deleted.

**Example: `src/entities/orderCommentRead.e.ts`**
If a comment is deleted, associated "read" flags must disappear automatically.

```typescript
@ManyToOne('OrderComment', (comment: OrderComment) => comment.reads, {
  nullable: false,
  onDelete: 'CASCADE' // DB Constraint: ON DELETE CASCADE
})
@JoinColumn()
comment: OrderComment
```

---

## 2.5 Logic in Entities: Computed Fields & Hooks

Entities are not just data containers. They can have virtual properties calculated after loading.

**Real World Example: `Activity.e.ts`**
An activity needs to show how many hours were worked (`doneHours`), but this data is the sum of `Timesheet`s.

```typescript
import { AfterLoad, OneToMany } from 'typeorm'

@Entity()
export class Activity extends BaseEntity {
  @Column({ type: 'float' })
  expectedHours: number

  @OneToMany('Timesheet', (timesheet: Timesheet) => timesheet.activity)
  timesheets: Promise<Timesheet[]>

  // --- Virtual Properties (Do not exist in DB) ---
  doneHours: number = 0
  deltaHours: number = 0
  remainingToWork: number = 0

  // Hook executed after find/findOne
  @AfterLoad()
  load() {
    // Case 1: Timesheets were loaded (join)
    if (Array.isArray(this.timesheets)) {
      const sheets = this.timesheets as unknown as { logTime: number }[]
      this.doneHours = sheets.reduce((acc, t) => acc + (Number(t.logTime) || 0), 0)
    }
    // Case 2: 'doneHours' was populated via addSelect() in the Service (more common for performance)

    // Calculate derivatives
    const expected = Number(this.expectedHours ?? 0)
    const done = Number(this.doneHours ?? 0)

    this.deltaHours = done - expected
    this.remainingToWork = expected - done
  }
}
```

---

## 2.6 SQL Views and `@ViewEntity`

For complex reporting, dashboards, or aggregations that would require too many joins in code, Views are used. `@volcanicminds/typeorm` treats views as read-only entities, allowing standard filters, pagination, and sorting.

**Example: `src/entities/planningView.e.ts`**
This view aggregates data from 8 different tables to provide a performant "flat table" for the planning report.

```typescript
import { ViewEntity, ViewColumn } from 'typeorm'

@ViewEntity({
  expression: `
    SELECT
      "ac"."id" AS "activityId",
      "ac"."expectedHours" AS "expectedHours",
      (SELECT COALESCE(SUM("ts"."logTime"), 0) FROM "timesheet" "ts" WHERE "ts"."activityId" = "ac"."id") AS "doneHours",
      "prof"."id" AS "professionalId",
      "prof"."firstName" AS "professionalFirstName",
      "wo"."code" AS "workOrderCode",
      "o"."name" AS "orderName",
      "cl"."name" AS "clientName",
      "pl"."month_1", "pl"."month_2" -- ... other months
    FROM "activity" "ac"
    LEFT JOIN "planning" "pl" ON "ac"."id" = "pl"."activityId"
    LEFT JOIN "professional" "prof" ON "ac"."professionalId" = "prof"."id"
    LEFT JOIN "work_order" "wo" ON "ac"."workOrderId" = "wo"."id"
    LEFT JOIN "order" "o" ON "wo"."orderId" = "o"."id"
    LEFT JOIN "client" "cl" ON "o"."clientId" = "cl"."id"
  `
})
export class PlanningView {
  // Mapping view columns -> class properties
  @ViewColumn()
  activityId: string

  @ViewColumn()
  doneHours: number // Calculated via SQL

  @ViewColumn()
  clientName: string

  // ... other fields
}
```

Usage in Service (`PlanningService`):

```typescript
const { records } = await executeFindView(entity.PlanningView, req.data())
```

---

## 2.7 Modeling Best Practices

1.  **UUID**: Always use `id: uuid` as primary key. Avoids enumeration attacks and merge conflicts.
2.  **UTC Dates**: TypeORM and Postgres handle dates. Ensure the application saves in UTC.
3.  **Relation Naming**:
    - Single side: `order` (object), `orderId` (generated physical column).
    - Collection side: `orders` (array).
4.  **Avoid Circular Imports**:
    - **Incorrect**: `import { Order } from './order.e.js'` used inside `@ManyToOne(() => Order)`
    - **Correct**: `@ManyToOne('Order')` (string) + `import type { Order } ...` (type only).

---

# Part 3: Magic Queries & Data Access

In a traditional backend architecture, developers spend 30-40% of their time writing "boilerplate code" to parse filters, handle pagination, and sort results.

The Volcanic Stack eliminates this layer. The `@volcanicminds/typeorm` package provides a translation engine that allows the client (Frontend or API Consumer) to define exactly what data it wants, how it wants it sorted and filtered, without writing a single line of SQL or logic in the controller.

## 3.1 Translation Layer: URL to SQL

The flow of a read request (`find` or `count`) is as follows:

1.  **Input**: Client calls `GET /orders?status:eq=active&amount:gt=100`.
2.  **Normalization**: The controller uses `req.data()` to unify query string and body.
3.  **Application**: The Service (via `BaseService` or `executeFindQuery`) applies permissions (RLS).
4.  **Translation**: The engine analyzes data object keys looking for **suffix operators** (e.g., `:eq`, `:gt`) and manipulates TypeORM's `QueryBuilder`.
5.  **Execution**: SQL is generated and executed.

### Usage in Code

There are two ways to invoke this engine:

**Mode 1: Direct Usage (for simple endpoints)**

```typescript
import { executeFindQuery } from '@volcanicminds/typeorm'

// Controller
export async function find(req, reply) {
  // Translates req.data() into SQL, executes and formats response
  const { headers, records } = await executeFindQuery(
    repository.orders,
    { client: true }, // Relations
    req.data()
  )
  return reply.headers(headers).send(records)
}
```

**Mode 2: Via `BaseService` (Enterprise Architecture)**
In `volcanic-sample-backend`, logic is encapsulated in `BaseService.findAll`. This allows injecting security (`applyPermissions`) before magic filters are applied.

```typescript
// Service
const { headers, records } = await orderService.findAll(req.userContext, req.data())
```

---

## 3.2 Filter Operator Reference

This table is the "Rosetta Stone" for the frontend developer. Every key in the JSON payload or Query String can have a suffix determining the SQL operator.

**Syntax:** `field:operator=value`

### Equality and Basic Logic Operators

| Operator   | Type    | SQL                       | Description                                                     |
| :--------- | :------ | :------------------------ | :-------------------------------------------------------------- |
| **(none)** | Any     | `=`                       | Implicit equality. `status=active` → `status = 'active'`        |
| `:eq`      | Any     | `=`                       | Explicit equality. `id:eq=123`                                  |
| `:neq`     | Any     | `!=`                      | Not equal to. `type:neq=guest`                                  |
| `:null`    | Boolean | `IS NULL` / `IS NOT NULL` | `deleted:null=true` (is null) / `deleted:null=false` (not null) |
| `:notNull` | Boolean | `IS NOT NULL`             | `code:notNull=true` (readability alias)                         |

### Numeric and Date Operators

| Operator   | Type        | SQL       | Description                                                                     |
| :--------- | :---------- | :-------- | :------------------------------------------------------------------------------ |
| `:gt`      | Number/Date | `>`       | Greater Than. `price:gt=100`                                                    |
| `:ge`      | Number/Date | `>=`      | Greater or Equal. `created:ge=2024-01-01`                                       |
| `:lt`      | Number/Date | `<`       | Less Than. `qty:lt=10`                                                          |
| `:le`      | Number/Date | `<=`      | Less or Equal. `qty:le=10`                                                      |
| `:between` | String      | `BETWEEN` | Inclusive Range. Syntax `min:max`. <br>Ex: `date:between=2024-01-01:2024-01-31` |

### String Operators (Pattern Matching)

> **Note:** Operators ending with `i` (e.g., `:likei`) are **Case Insensitive** (use `ILIKE` in Postgres).

| Operator                     | SQL              | Description                                                                           |
| :--------------------------- | :--------------- | :------------------------------------------------------------------------------------ |
| `:like` / `:likei`           | `LIKE` / `ILIKE` | Manual pattern. Requires wildcards `%`. <br>Ex: `code:like=A-%`                       |
| `:contains` / `:containsi`   | `LIKE` / `ILIKE` | Contains. Adds `%` automatically to sides. <br>Ex: `name:containsi=rossi` → `%rossi%` |
| `:ncontains` / `:ncontainsi` | `NOT LIKE`       | Does not contain. <br>Ex: `tag:ncontainsi=deprecated`                                 |
| `:starts` / `:startsi`       | `LIKE`           | Starts with. Adds `%` at the end. <br>Ex: `sku:starts=ABC` → `ABC%`                   |
| `:ends` / `:endsi`           | `LIKE`           | Ends with. Adds `%` at the start. <br>Ex: `file:ends=.pdf` → `%.pdf`                  |

### List Operators (Array)

| Operator | SQL            | Description                                                                                         |
| :------- | :------------- | :-------------------------------------------------------------------------------------------------- |
| `:in`    | `IN (...)`     | Included in list. <br>URL: `status:in=open,pending` (CSV)<br>Body: `status:in: ["open", "pending"]` |
| `:nin`   | `NOT IN (...)` | Excluded from list. `role:nin=admin,root`                                                           |

---

## 3.3 Deep Filtering (Relational Filters)

TypeORM allows filtering based on joined table columns. The framework exposes this capability via **Dot Notation**.

**Requirement:** The relation must be loaded in the Service via `addRelations` (or `executeFindQuery`).

### Examples

1.  **Filter Orders by Client name:**
    - Query: `GET /orders?client.name:containsi=Acme`
    - Prerequisite in Service: `qb.leftJoinAndSelect('order.client', 'client')` (alias 'client' must match the first part of filter).
    - Generated SQL: `... AND client.name ILIKE '%Acme%'`

2.  **Filter Activities by Professional's Company:**
    - Query: `GET /activities?professional.company:eq=volcanicminds`
    - Structure: `Activity` -> `Professional` -> `company`.

3.  **Relational Sorting:**
    - Query: `GET /orders?sort=client.name:asc` (Sort orders alphabetically by client).

> **Warning:** If you attempt to filter on a non-loaded (not joined) relation, the SQL query will fail with a "missing FROM-clause entry for table" error.

---

## 3.4 Advanced Boolean Logic (`_logic`)

By default, all parameters in query string are combined with **AND**.
`?status=active&type=vip` → `WHERE status='active' AND type='vip'`.

For complex scenarios (OR, nested groups), use the special `_logic` parameter combined with **Filter Aliases**.

### Syntax

1.  **Define Filters with Alias:** Add `[alias]` at the end of the filter key.
    - Syntax: `key:operator[alias]=value`
2.  **Logic Composition:** Define the boolean string in `_logic` using aliases.

### Real Example: "Alerts" Dashboard

We want to find Orders that are:

1.  **Urgent** (priority > 8)
2.  **OR** (**Late** AND **Not Closed**)

**Request Construction:**

- Urgent Condition: `priority:gt[urgent]=8`
- Late Condition: `dueDate:lt[late]=2025-01-01` (past date)
- Not Closed Condition: `status:neq[open]=closed`

**Final URL:**

```
GET /orders?priority:gt[urgent]=8&dueDate:lt[late]=2025-01-01&status:neq[open]=closed&_logic=urgent OR (late AND open)
```

**Resulting SQL:**

```sql
WHERE (priority > 8) OR (due_date < '2025-01-01' AND status != 'closed')
```

---

## 3.5 Pagination and Sorting

Pagination standards are rigid to ensure compatibility with frontend tables (e.g., React Table, AG Grid).

### Input Parameters

- **`page`** (number, default: 1): Requested page (1-based).
- **`pageSize`** (number, default: 25): Rows per page.
- **`sort`** (string | array):
  - `field` (ascending)
  - `field:asc`
  - `field:desc`
  - Multiple: `?sort=priority:desc&sort=createdAt:asc`

### Response Headers

The JSON payload contains only the record array (`data`). Pagination metadata is in **HTTP Headers** to keep the payload clean.

- `v-page`: Current page.
- `v-pageSize`: Applied page size.
- `v-count`: Number of records returned in this request.
- **`v-total`**: TOTAL number of records in DB matching filters (without pagination).
- `v-pageCount`: Total number of pages.

---

## 3.6 Customizing QueryBuilder (Global Search)

Sometimes standard operators are not enough. The `applyCustomFilters` method in `BaseService` allows intercepting special parameters.

**Example: "Global Search" Implementation (`q`)**

If we want a single search field searching across Code, Name, and Client Name.

```typescript
// src/services/order.service.ts

protected applyCustomFilters(qb: SelectQueryBuilder<Order>, params: any, alias: string): any {

  // If parameter 'q' exists, build a complex OR condition
  if (params.q) {
    const term = `%${params.q}%`;

    qb.andWhere(new Brackets(sqb => {
      sqb.where(`${alias}.code ILIKE :term`, { term })
         .orWhere(`${alias}.name ILIKE :term`, { term })
         // Note: requires 'client' relation to be already joined in addRelations
         .orWhere(`client.name ILIKE :term`, { term });
    }));

    // Remove 'q' from params to prevent standard parser from looking for column 'q'
    delete params.q;
  }

  return params;
}
```

---

# Part 4: API Layer (Routing & Controllers)

The API layer is the application entry point. Its responsibility is strictly limited to:

1.  **Receiving** the HTTP request.
2.  **Validating** input (via JSON Schema).
3.  **Verifying** authorization (via Middleware/Roles).
4.  **Delegating** processing to the Service Layer.
5.  **Responding** to the client.

## 4.1 Route Autodiscovery

The framework uses an **Automatic Loader** (`lib/loader/router.ts`) that scans the `src/api` folder at server startup. There is no central `app.ts` file where routes are manually registered.

### The Matching Rule

The loader looks for files matching the pattern: `src/api/**/routes.ts`.
Folder structure determines the URL prefix, unless overwritten in configuration.

**Mapping Examples:**

| File Path                     | Configuration  | Resulting URL |
| :---------------------------- | :------------- | :------------ |
| `src/api/users/routes.ts`     | `path: '/'`    | `/users/`     |
| `src/api/users/routes.ts`     | `path: '/:id'` | `/users/:id`  |
| `src/api/orders/v2/routes.ts` | `path: '/'`    | `/orders/v2/` |

---

## 4.2 `routes.ts` Configuration

Every functional module (e.g., `orders`, `auth`) must have a `routes.ts` file. This file is the "Single Source of Truth" for endpoint behavior and Swagger/OpenAPI documentation generation.

### File Structure

Here is a complete, commented example based on `src/api/orders/routes.ts`:

```typescript
import { roles } from '../../config/roles.js' // Import defined roles

export default {
  // 1. Module Global Configuration
  config: {
    title: 'Orders API', // Group name in Swagger
    description: 'Management of orders and jobs',
    controller: 'controller', // Subfolder where to look for handler files (default: 'controller')
    tags: ['orders'], // Tag for Swagger grouping
    enable: true // Switch to enable/disable the entire module
  },

  // 2. Route Definition
  routes: [
    {
      method: 'GET', // Verbs: GET, POST, PUT, DELETE, PATCH
      path: '/:id', // Path relative to module (becomes /orders/:id)

      // --- Security Layer ---
      // RBAC: Only Admin and Manager can call this route.
      // If array is empty [], route is public (unless blocked by middleware).
      roles: [roles.admin, roles.manager],

      // Middleware Chain: Executed in order before handler.
      middlewares: ['global.isAuthenticated'],

      // --- Handler Mapping ---
      // Magic Syntax: 'filename.functionName'
      // Framework will look for file 'order.ts' in 'controller' folder
      // and execute exported function 'findOne'.
      handler: 'order.findOne',

      // --- Swagger & Validation ---
      config: {
        title: 'Find Order',
        description: 'Retrieves order detail',

        // JSON Schema References (Automatic Fastify Validation)
        // Names with # refer to globally loaded schemas in src/schemas
        params: { $ref: 'globalParamsSchema#' }, // Validates :id presence
        response: {
          200: {
            description: 'Success',
            $ref: 'orderSchema#' // Serializes response using this schema
          },
          404: { description: 'Order not found' }
        }
      }
    },

    // Example Creation Route
    {
      method: 'POST',
      path: '/',
      roles: [roles.admin],
      handler: 'order.create',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Create Order',
        // Body Validation
        body: { $ref: 'orderBodySchema#' },
        response: {
          200: { $ref: 'orderSchema#' }
        }
      }
    }
  ]
}
```

---

## 4.3 Controllers: Best Practices

Controllers in this stack must be **Thin**. They must not contain SQL queries, business logic, or external service calls.

### Standard Signature

Every handler is an async function:

```typescript
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export async function myHandler(req: FastifyRequest, reply: FastifyReply) {
  // ...
}
```

### 1. Input Normalization (`req.data()`)

Fastify separates `req.body` (POST/PUT) from `req.query` (GET).
The framework provides the `req.data()` helper which unifies both into a single object, allowing code agnostic to HTTP method.

```typescript
// Instead of: const data = req.body || req.query
const data = req.data()
```

### 2. Path Parameters (`req.parameters()`)

To access URL parameters (e.g., `/orders/:id`), use the helper:

```typescript
// Instead of: req.params
const { id } = req.parameters()
```

### 3. Accessing Context (`req.userContext`)

Thanks to the global `preHandler` hook, every authenticated request possesses a typed user context. This object is fundamental for **Row Level Security** in Services.

```typescript
// Defined in types/index.d.ts
const ctx = req.userContext
// { userId: '...', role: 'manager', company: 'volcanicminds', ... }
```

### 4. Relations Normalization (Id-to-Object Pattern)

When creating or updating an entity with relations (e.g., assigning an `Order` to a `Client`), frontend sends ID as string. TypeORM prefers a partial object to handle Foreign Key without extra queries.

**Controller Best Practice:**

```typescript
// Example from src/api/orders/controller/order.ts
export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const data = req.data()

  // Transformation: "client": "uuid-123" -> "client": { id: "uuid-123" }
  if (data.client && typeof data.client === 'string') {
    data.client = { id: data.client }
  }

  if (data.type && typeof data.type === 'string') {
    data.type = { code: data.type } // If PK is a code
  }

  // Passing to Service
  return await orderService.update(req.userContext, id, data)
}
```

---

## 4.4 Implementation Pattern: From Controller to Service

Here is a complete example of implementing a complex endpoint (e.g., `create`) respecting the architecture.

### The Controller (`src/api/orders/controller/order.ts`)

```typescript
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { orderService } from '../../../services/order.service.js'

export async function create(req: FastifyRequest, reply: FastifyReply) {
  // 1. Data Extraction
  const { id: _ignore, ...payload } = req.data()

  // 2. Rapid Logic Validation (optional if JSON Schema exists)
  if (!payload.code) {
    return reply.status(400).send(new Error('Missing order code'))
  }

  // 3. Normalization
  if (payload.client && typeof payload.client === 'string') payload.client = { id: payload.client }
  if (payload.category && typeof payload.category === 'string') payload.category = { code: payload.category }

  try {
    // 4. Delegate to Service (Business Logic & Security)
    const result = await orderService.create(req.userContext, payload)

    // 5. Response
    // If result is null or errors occur, service will have thrown exception
    return reply.code(201).send(result)
  } catch (err) {
    // Custom Error Handling
    if (err.message.includes('Access denied')) {
      return reply.status(403).send({ message: err.message })
    }
    // Rethrow for global handler (500)
    throw err
  }
}
```

### The Service (`src/services/order.service.ts`)

The service extends `BaseService` to inherit standard CRUD, but can overwrite methods or add new ones.

```typescript
// (See Part 5 for full Service Layer details)
export class OrderService extends BaseService<Order> {
  // ...
  async create(ctx: UserContext, data: any) {
    // Security Check: A Manager can create orders only for their company
    if (ctx.role === 'manager') {
      data.company = ctx.company
    }

    // Business Validation: Unique Code
    const exists = await this.repository.findOne({ where: { code: data.code } })
    if (exists) throw new Error('Order code already exists')

    // Persistence
    const order = entity.Order.create(data)
    return await entity.Order.save(order)
  }
}
```

---

## 4.5 Middleware: Global vs Local

Middlewares are functions executed _before_ the handler. In `@volcanicminds/backend`, middleware configuration happens via strings in `routes.ts`.

### 1. Global Middleware (`global.*`)

If the string starts with `global.`, the framework looks for the file in two locations:

1.  `src/middleware/` (Custom application Middleware).
2.  `lib/middleware/` (Native framework Middleware, e.g., `isAuthenticated`).

**Common Native Middlewares:**

- `global.isAuthenticated`: Verifies JWT, expiration, and injects `req.user`.
- `global.isAdmin`: Verifies if user has admin role (shortcut).

### 2. Local Middleware

If the string has no prefix, the framework looks in the `middleware` folder _relative_ to the `routes.ts` file. Useful for module-specific logic.

**Mixed Configuration Example:**

```typescript
// src/api/special/routes.ts
routes: [
  {
    path: '/action',
    handler: 'special.action',
    middlewares: [
      'global.isAuthenticated', // Global: check token
      'checkBusinessHours' // Local: src/api/special/middleware/checkBusinessHours.ts
    ]
  }
]
```

---

## 4.6 JSON Schemas & Validation

Fastify uses JSON Schema to validate input and serialize output. This offers extremely high performance and automatic documentation.

### Definition (`src/schemas/*.ts`)

Every schema must have a unique `$id`.

```typescript
// src/schemas/order.ts
export const orderBodySchema = {
  $id: 'orderBodySchema',
  type: 'object',
  required: ['code', 'name'],
  properties: {
    code: { type: 'string', minLength: 3 },
    name: { type: 'string' },
    year: { type: 'number' }
  },
  additionalProperties: false // Best Practice: Refuse unknown fields
}
```

### Registration

The framework automatically loads all files in `src/schemas`.
In `routes.ts`, reference the schema using `$ref: 'ID_SCHEMA#'`.

**Note on `#`**: The `#` character at the end of `$ref` is mandatory in Fastify syntax to indicate schema root.

### Schema Overriding

If you define a schema with the same `$id` as a native framework schema (e.g., `authLoginResponseSchema`), the loader will perform a **Deep Merge**. This allows adding custom fields (e.g., `companyId` in login) without forking the library.

---

# Part 5: Service Layer Architecture

The Service Layer is where the application's "truth" resides. While Controllers handle HTTP, Services handle data.

In this stack, Services must respect three fundamental rules:

1.  **Agnostic**: They don't know `req` or `res`. They accept `UserContext` and DTOs/Objects.
2.  **Secure**: Must filter data based on user _before_ returning it (Row Level Security).
3.  **Singleton**: Instantiated once and exported for use throughout the app.

---

## 5.1 The `BaseService` Pattern

To avoid rewriting search, pagination, and filtering logic endlessly, all CRUD services extend an abstract `BaseService` class. This class acts as a smart wrapper around TypeORM's `Repository`.

### Abstract Class Implementation (`src/services/base.service.ts`)

Here is the reference structure implemented in `volcanic-sample-backend`. Note how it integrates "Magic Queries" seen in Part 3.

```typescript
import { ObjectLiteral, Repository, SelectQueryBuilder, Brackets } from 'typeorm'
import { UserContext } from '../../types/index.js'

export abstract class BaseService<T extends ObjectLiteral> {
  protected repository: Repository<T>
  protected cacheTTL: number = 0 // Default: no cache

  constructor(repository: Repository<T>) {
    this.repository = repository
  }

  /**
   * SECURITY HOOK (Abstract)
   * Mandatory method. Defines "Who can see what" rules.
   * Automatically applied to findAll, findOne, count.
   */
  protected abstract applyPermissions(qb: SelectQueryBuilder<T>, ctx: UserContext, alias: string): SelectQueryBuilder<T>

  /**
   * RELATIONS HOOK
   * Defines which relations to load by default (Controlled Eager Loading).
   */
  protected addRelations(qb: SelectQueryBuilder<T>, _alias: string): SelectQueryBuilder<T> {
    return qb
  }

  /**
   * CUSTOM FILTERS HOOK
   * Allows handling parameters that are not DB columns (e.g., 'q' search).
   */
  protected applyCustomFilters(qb: SelectQueryBuilder<T>, queryParams: any, _alias: string): any {
    return queryParams
  }

  protected createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    return this.repository.createQueryBuilder(alias)
  }

  // --- Standard CRUD Methods ---

  async findAll(ctx: UserContext, queryParams: any = {}): Promise<{ headers: any; records: T[] }> {
    const alias = this.repository.metadata.tableName
    let qb = this.createQueryBuilder(alias)

    // 1. Setup Base Query
    qb = this.addRelations(qb, alias)
    qb = this.applyPermissions(qb, ctx, alias)

    // 2. Custom Filters (e.g. Global Search)
    const paramsToProcess = this.applyCustomFilters(qb, { ...queryParams }, alias)

    // 3. Magic Filters (Standard Volcanic: :eq, :gt, :like...)
    // Note: applyStandardFilters is internal helper mapping params -> where
    this.applyStandardFilters(qb, paramsToProcess, alias)

    // 4. Caching
    if (this.cacheTTL > 0) qb.cache(this.cacheTTL)

    // 5. Pagination & Sort
    if (paramsToProcess.page && paramsToProcess.pageSize) {
      const page = Math.max(1, parseInt(paramsToProcess.page))
      const pageSize = parseInt(paramsToProcess.pageSize) || 25
      qb.skip((page - 1) * pageSize).take(pageSize)
    }

    // ... sort handling ...

    const [records, total] = await qb.getManyAndCount()

    // 6. Pagination Headers
    const headers = {
      'v-count': records.length,
      'v-total': total,
      'v-page': paramsToProcess.page || 1,
      'v-pageSize': paramsToProcess.pageSize || records.length || 1,
      'v-pageCount': Math.ceil(total / (parseInt(paramsToProcess.pageSize) || 25))
    }

    return { headers, records }
  }

  async findOne(ctx: UserContext, id: string): Promise<T | null> {
    const alias = this.repository.metadata.tableName
    let qb = this.createQueryBuilder(alias)

    qb = this.addRelations(qb, alias)

    // CRITICAL: Permissions apply to findOne too!
    // If ID exists but user has no rights, returns null (simulates 404).
    qb = this.applyPermissions(qb, ctx, alias)

    qb.andWhere(`${alias}.id = :id`, { id })

    if (this.cacheTTL > 0) qb.cache(this.cacheTTL)

    return qb.getOne()
  }

  // ... private internal methods (applyStandardFilters) ...
}
```

---

## 5.2 Security Context & RLS (Row Level Security)

`applyPermissions` implementation is the pillar of security. Instead of writing `if (user.role === 'admin')` in every controller, we define visibility rules once per entity.

`UserContext` (defined in `types/index.d.ts`) contains:

- `role`: App role (`admin`, `manager`, `user`).
- `company`: Belonging tenant (e.g., `volcanicminds`).
- `professionalId`: ID of linked professional profile.

### Complex Example: `OrderService`

Business Rules:

1.  **Admin**: Sees everything.
2.  **Manager**: Sees only orders of their company.
3.  **User**: Sees only orders they worked on (verifies existence of an activity in work order).

```typescript
// src/services/order.service.ts
import { SelectQueryBuilder } from 'typeorm'
import { BaseService } from './base.service.js'
import { Order } from '../entities/order.e.js'
import { UserContext } from '../../types/index.js'

export class OrderService extends BaseService<Order> {
  constructor() {
    // repository.orders is global, injected by loader
    super(repository.orders)
  }

  protected applyPermissions(
    qb: SelectQueryBuilder<Order>,
    ctx: UserContext,
    alias: string
  ): SelectQueryBuilder<Order> {
    // 1. ADMIN: Full Bypass
    if (ctx.role === 'admin') {
      return qb
    }

    // 2. MANAGER: Tenant Isolation
    if (ctx.role === 'manager') {
      if (!ctx.company) {
        // Fail-safe: Manager without company sees nothing
        qb.andWhere('1=0')
        return qb
      }
      qb.andWhere(`${alias}.company = :company`, { company: ctx.company })
      return qb
    }

    // 3. USER: Association Check (Complex Query)
    if (ctx.role === 'user') {
      if (!ctx.professionalId || !ctx.company) {
        qb.andWhere('1=0')
        return qb
      }

      // Check 1: Tenant
      qb.andWhere(`${alias}.company = :company`, { company: ctx.company })

      // Check 2: Assignment (EXISTS subquery is more performant than JOIN for filtering)
      qb.andWhere(
        (subQuery) => {
          const sub = subQuery
            .subQuery()
            .select('1')
            .from('work_order', 'wo')
            .innerJoin('activity', 'a', 'a.workOrderId = wo.id')
            .where(`wo.orderId = ${alias}.id`) // Correlation with outer query
            .andWhere('a.professionalId = :pid')
            .getQuery()
          return `EXISTS ${sub}`
        },
        { pid: ctx.professionalId }
      )

      return qb
    }

    // Default Deny: Unknown role or public
    qb.andWhere('1=0')
    return qb
  }
}

export const orderService = new OrderService()
```

---

## 5.3 Advanced QueryBuilder: Relations and Computed Fields

`addRelations` method serves to avoid N+1 problem during serialization and prepares ground for deep filters.

### Example: `ActivityService` with Computed Fields

An activity needs to report how many hours were worked (`doneHours`), which is the sum of records in `Timesheet` table.

```typescript
// src/services/activity.service.ts

export class ActivityService extends BaseService<Activity> {
  protected addRelations(qb: SelectQueryBuilder<Activity>, alias: string): SelectQueryBuilder<Activity> {
    // 1. Standard Join
    qb.leftJoinAndSelect(`${alias}.professional`, 'professional')
      .leftJoinAndSelect(`${alias}.workOrder`, 'workOrder')
      .leftJoinAndSelect('workOrder.order', 'order') // Nested Join

    // 2. Computed Field (Virtual Column)
    // This adds a 'doneHours' column to raw result set.
    // TypeORM will map it to 'doneHours' property of entity if configured correctly
    // or we might need to do it manually in an @AfterLoad hook or transformation.
    qb.addSelect((subQuery) => {
      return subQuery
        .select('COALESCE(SUM(t.logTime), 0)', 'doneHours')
        .from('timesheet', 't')
        .where(`t.activityId = ${alias}.id`)
    }, 'Activity_doneHours') // Naming convention TypeORM: EntityName_PropName

    return qb
  }
}
```

### Managing Custom Filters (`applyCustomFilters`)

If we want to implement a **Global Search** searching multiple fields simultaneously:

```typescript
protected applyCustomFilters(qb: SelectQueryBuilder<Order>, queryParams: any, alias: string): any {
  if (queryParams.q) {
    const term = `%${queryParams.q}%`

    qb.andWhere(new Brackets(sqb => {
      sqb.where(`${alias}.code ILIKE :term`, { term })
         .orWhere(`${alias}.name ILIKE :term`, { term })
         // Filter on relation joined in addRelations
         .orWhere(`client.name ILIKE :term`, { term })
    }))

    // Remove 'q' from params to not confuse standard parser
    delete queryParams.q
  }
  return queryParams
}
```

---

## 5.4 Transaction Management (Complex Writes)

`BaseService` covers reads and simple writes (single table) well. When an operation involves multiple entities (e.g., create Order + WorkOrders + Activities), we must manage transaction manually to ensure data integrity (ACID).

**Pattern: Manual `QueryRunner`**

Example from `src/services/fullOrder.service.ts`.

```typescript
import { connection } from '@volcanicminds/typeorm' // or global.connection

async createFull(ctx: UserContext, data: any) {
  const { workOrders, activities, ...orderData } = data

  // 1. Initialize Transaction
  const queryRunner = connection.createQueryRunner()
  await queryRunner.connect()
  await queryRunner.startTransaction()

  try {
    // 2. Atomic operations using transaction manager
    // IMPORTANT: use queryRunner.manager, NOT global.repository or entity.save()

    // Step A: Save Order
    const order = entity.Order.create(orderData)
    const savedOrder = await queryRunner.manager.save(order)

    // Step B: Save WorkOrders
    for (const wo of workOrders) {
      wo.order = savedOrder.id
      const workOrder = entity.WorkOrder.create(wo)
      await queryRunner.manager.save(workOrder)
    }

    // 3. Commit if everything ok
    await queryRunner.commitTransaction()
    return savedOrder

  } catch (err) {
    // 4. Rollback in case of error
    await queryRunner.rollbackTransaction()
    throw err
  } finally {
    // 5. Release connection to pool
    await queryRunner.release()
  }
}
```

---

## 5.5 Globals vs Dependency Injection

As noted in Part 1, the framework injects repositories and entities into `global scope`.

### Data Access

- **`repository.[pluralName]`**: Repository Instance.
  - Usage: `repository.orders.find(...)`
  - Corresponds to: `DataSource.getRepository(Order)`
  - **Important**: In Multi-Tenant applications or transactions, prefer using `req.db.getRepository(Order)` (via `service.use(req.db)`) to ensure you are using the correct isolated connection.
- **`entity.[ClassName]`**: Entity Class.
  - Usage: `entity.Order.create(...)`
  - Corresponds to: `import { Order } from ...`

### Singleton Pattern

Services themselves are exported as **Singletons**. Do not use `new OrderService()` in controllers, but import the instance.

```typescript
// In service.ts
export const orderService = new OrderService()

// In controller.ts
import { orderService } from '../../services/order.service.js'
```

---

## 5.6 Caching

For "slow to change" entities (e.g., `OrderType`, `OrderCategory`), we can enable query cache to reduce DB load.

```typescript
import { STATIC_CACHE_TTL } from '../config/constants.js'

export class OrderTypeService extends BaseService<OrderType> {
  constructor() {
    super(repository.ordertypes)
    // Enable auto cache for findAll and findOne
    this.cacheTTL = STATIC_CACHE_TTL // e.g. 15 minutes in ms
  }

  // ...
}
```

When `cacheTTL > 0`, TypeORM:

1.  Generates SQL query hash.
2.  Checks if it exists in `query_result_cache` table and is valid.
3.  If yes, returns saved JSON.
4.  If no, executes query and saves result.

**Attention**: Invalidation in TypeORM is manual or time-based. Use only for configuration or historical data.

---

# Part 6: Authentication and Security

The framework does not delegate authentication to external providers (like Auth0 or Cognito) by default, but provides a robust "in-house" implementation integrated into request lifecycle.

Security pillars are:

1.  **Hybrid JWT**: Stateless token for performance, but with server-side invalidation mechanism.
2.  **MFA Gatekeeper**: A two-stage login flow for two-factor authentication.
3.  **Context Injection**: Transformation of raw token into typed `UserContext` object for business logic.

---

## 6.1 Auth Stack & JWT Lifecycle

Authentication is managed internally by `@volcanicminds/backend`.

### Environment Configuration (`.env`)

Following variables are mandatory to enable token encryption.

```properties
# Secret to sign access tokens (short duration)
JWT_SECRET=super_long_random_string_at_least_64_bytes
JWT_EXPIRES_IN=15m  # Short duration for security

# Refresh Token (long duration, for fluid UX)
JWT_REFRESH=true
JWT_REFRESH_SECRET=another_super_long_random_string_different_from_above
JWT_REFRESH_EXPIRES_IN=7d
```

### The "External ID" Pattern (Token Revocation)

Standard JWT problem is they cannot be revoked before expiration. Volcanic solves this by decoupling primary ID (`uuid`) from ID contained in token.

1.  Every `User` has an `externalId` field (random string or UUID).
2.  JWT contains `{ sub: user.externalId }`, **not** database primary ID.
3.  At login/verification, system finds user via `externalId`.

**How invalidation works (Global Logout / Password Change):**
When user changes password or clicks "Logout from all devices", system regenerates their `externalId` in database.
_Result:_ All previously issued tokens (Access and Refresh) contain old `externalId`, which matches no user anymore. They are instantly rejected.

---

## 6.2 Multi-Factor Authentication (MFA)

Framework implements TOTP (Time-based One-Time Password) system compatible with Google Authenticator/Microsoft Authenticator.

### Security Policy

Configurable in `src/config/general.ts` (or via ENV `MFA_POLICY`):

- **`OPTIONAL`**: User can enable it from profile.
- **`MANDATORY`**: User is forced to configure it at next login. Cannot browse without.
- **`ONE_WAY`**: Once enabled, user cannot disable it alone (only admin can).

### The "Gatekeeper" Flow (Two-Stage Login)

To ensure security, login never releases valid token if MFA is pending.

**Phase 1: Login Credentials**

- **Request**: `POST /auth/login` `{ email, password }`
- **Check**: Valid credentials. MFA is active for user.
- **Response**: `202 Accepted` (not 200).
- **Payload**:
  ```json
  {
    "mfaRequired": true,
    "mfaSetupRequired": false,
    "tempToken": "eyJ..." // Temporary token
  }
  ```
- **Security**: `tempToken` has role `pre-auth-mfa` and lasts 5 minutes.

**Phase 2: The Guard (Middleware)**
Global middleware `hooks/onRequest.ts` inspects every request. If token has role `pre-auth-mfa`, blocks access to all routes except:

- `/auth/mfa/verify`
- `/auth/mfa/setup`
- `/auth/mfa/enable`

**Phase 3: TOTP Verification**

- **Request**: `POST /auth/mfa/verify`
  - Header: `Authorization: Bearer <tempToken>`
  - Body: `{ token: "123456" }`
- **Response**: `200 OK` with real `token` and `refreshToken` (`user/admin` role).

### Adapter Implementation (`src/services/mfa.adapter.ts`)

To work, backend must know how to generate/verify codes. In `volcanic-sample-backend`, this is delegated to `@volcanicminds/tools`.

```typescript
import * as mfaTool from '@volcanicminds/tools/mfa'

export const mfaAdapter = {
  // Generates secret and QR Code
  async generateSetup(appName: string, email: string) {
    return await mfaTool.generateSetupDetails(appName, email)
  },

  // Verifies code 123456 against secret
  verify(token: string, secret: string) {
    return mfaTool.verifyToken(token, secret)
  }
}
```

This adapter is passed to server in `index.ts` bootstrap file.

---

## 6.3 Role Based Access Control (RBAC)

Role management is static but dynamically applied.

### 1. Role Definition (`src/config/roles.ts`)

```typescript
export default [
  {
    code: 'public', // Implicit role for unauthenticated
    name: 'Public',
    description: 'Unauthenticated user'
  },
  {
    code: 'admin',
    name: 'Admin',
    description: 'Super User'
  },
  {
    code: 'manager',
    name: 'Manager',
    description: 'Limited access to own Company'
  },
  {
    code: 'user',
    name: 'User',
    description: 'Limited access to own data'
  }
]
```

### 2. Route Protection (`routes.ts`)

```typescript
{
  method: 'DELETE',
  path: '/:id',
  handler: 'user.remove',
  // Gatekeeper: Only Admin can call this endpoint.
  // Others will receive 403 Forbidden automatically.
  roles: [roles.admin],
  middlewares: ['global.isAuthenticated']
}
```

---

## 6.4 Context Injection & TypeScript

This part connects authentication to business logic. Once user is authenticated, we must transform their "User ID" into a rich context (`UserContext`) to pass to Services.

### 1. Type Definitions (`types/index.d.ts`)

Extend `FastifyRequest` interface to include `userContext`.

```typescript
import { FastifyRequest as _FastifyRequest } from 'fastify'

// Application Context Structure
export interface UserContext {
  userId: string | null
  role: 'admin' | 'manager' | 'user' | 'public'

  // Specific fields
  company?: string // Tenant (e.g. 'volcanicminds')
  professionalId?: string // Linked professional profile ID
}

declare module 'fastify' {
  export interface FastifyRequest {
    userContext: UserContext
  }
}
```

### 2. Context Population (`src/hooks/preHandler.ts`)

This hook runs _after_ JWT auth but _before_ controller. Here enrichment logic happens.

```typescript
import { FastifyRequest, FastifyReply } from '@volcanicminds/backend'

export default async (req: FastifyRequest, _reply: FastifyReply) => {
  // req.user is populated by @fastify/jwt plugin (contains User entity from DB)
  const user = req.user as any
  const roles = user?.roles || []

  // Professional profile is often loaded eagerly with User
  const professional = user?.professional

  const context: UserContext = {
    userId: user?.id || null,
    role: 'public',
    company: undefined,
    professionalId: professional?.id
  }

  if (user) {
    // DB roles mapping -> Main context role
    if (roles.includes('admin')) {
      context.role = 'admin'
    } else if (roles.includes('manager')) {
      context.role = 'manager'
      context.company = professional?.company // Manager is bound to their company
    } else {
      context.role = 'user'
      context.company = professional?.company
    }
  }

  // Injection into request
  req.userContext = context
}
```

### 3. Usage in Service

Thanks to this setup, services don't need to worry about _how_ user was authenticated, only _who_ they are.

```typescript
// src/services/order.service.ts
async findAll(ctx: UserContext, params: any) {
    // TypeScript knows ctx structure thanks to index.d.ts
    if (ctx.role === 'manager') {
        // Apply company filter
    }
}
```

---

## 6.5 Emergency Admin Reset (Secure Backdoor)

In case admin loses MFA device, framework offers a filesystem/env based recovery route, designed to be temporary.

1.  SSH access to server is required.
2.  Modify `.env` or container variables:
    - `MFA_ADMIN_FORCED_RESET_EMAIL=admin@test.volcanicminds.com`
    - `MFA_ADMIN_FORCED_RESET_UNTIL=2025-12-31T15:00:00.000Z` (Must be in near future, max 10 min from startup).
3.  Restart backend.
4.  At startup, core `index.ts` detects variables. If timestamp is valid, **disables MFA** and clears secrets for that specific user.
5.  Admin can log in with password only and reconfigure MFA.
6.  **Cleanup**: Remove variables and restart to close security gap.

---

# Part 7: Validation, Utilities, Scheduler, and Testing

An enterprise backend is not limited to saving data in DB. It must ensure incoming data is valid, execute background operations, track who modified what, and ensure stability via automated tests.

## 7.1 JSON Schema Validation and Schema Overriding

The framework uses **Fastify** for validation, based on **JSON Schema** (draft-7). This approach guarantees extremely high performance (thanks to Just-In-Time schema compilation) and automatically generates Swagger/OpenAPI documentation.

### Schema Definition (`src/schemas/*.ts`)

Every file in this folder is automatically loaded at startup. Every schema must export an object with a unique `$id`.

**Example: Create Order Validation (`src/schemas/order.ts`)**

```typescript
import { VALID_COMPANIES } from '../entities/all.enums.js'

export const orderBodySchema = {
  $id: 'orderBodySchema', // Unique ID used in $ref
  type: 'object',
  nullable: true, // Body can be null (handled by controller)
  required: ['code', 'name', 'company'], // Mandatory fields
  properties: {
    code: {
      type: 'string',
      minLength: 5,
      description: 'Unique order code (e.g. 2025_GER_CLI)'
    },
    name: { type: 'string' },
    year: { type: 'number', minimum: 2000, maximum: 2100 },

    // Enum Validation (imported from entities for consistency)
    company: {
      type: 'string',
      enum: VALID_COMPANIES
    },

    // Relations (expects string ID from frontend)
    client: { type: 'string', format: 'uuid' }
  },
  additionalProperties: false // Best Practice: Reject undefined fields for security
}
```

### Schema Overriding (Core Feature)

`@volcanicminds/backend` provides native schemas for core functions (e.g., Login, Registration). Often a real app needs to extend these schemas (e.g., add `company` and `firstName` to login response) without modifying library code.

The loader implements **Smart Deep Merge**: if a local schema has same `$id` as a core schema, properties are merged.

**Real Example: Extending Login Response (`src/schemas/user.ts`)**

```typescript
// src/schemas/user.ts

// 1. Define professional profile schema
export const professionalSchema = {
  $id: 'professionalSchema',
  type: 'object',
  properties: {
    id: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    company: { type: 'string' }
  }
}

// 2. Override Login Response Schema (defined in core lib/schemas/auth.ts)
export const authLoginResponseSchema = {
  $id: 'authLoginResponseSchema', // SAME ID as core
  type: 'object',
  nullable: true,
  properties: {
    // Fields inherited from core (no need to repeat):
    // - token, refreshToken, username, email, id

    // Fields ADDED by application:
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    company: { type: 'string' },

    // Reference to custom schema
    professional: {
      $ref: 'professionalSchema#'
    }
  }
}
```

At runtime, `/auth/login` response will return both JWT token and professional profile data.

---

## 7.2 Core Utilities (`@volcanicminds/tools`)

The framework exposes global utilities to simplify development.

### Structured Logging (Pino)

`log` object is global. It is configured for high performance: uses "short-circuit" mechanism based on boolean getters (`log.i`, `log.e`) to avoid string interpolation if log level is disabled.

**Best Practices:**

```typescript
// 1. Info: Success operations, server start
if (log.i) log.info(`Order ${orderId} created successfully`)

// 2. Warn: Anomalous but handled situations (e.g. Login failed, Resource not found)
if (log.w) log.warn(`User ${email} failed login attempt (IP: ${ip})`)

// 3. Error: Exceptions, crash, external service failures
// Always pass error object as first argument for stack trace
if (log.e) log.error({ err: errorObject }, 'Payment gateway unreachable')

// 4. Debug/Trace: Full payloads (dev only)
if (log.d) log.debug('Incoming payload:', JSON.stringify(data))
```

### Mailer

`Mailer` wrapper (from `@volcanicminds/tools`) handles email sending. In `volcanic-sample-backend`, SMTP config usually resides in a dedicated service or initialized at usage.

```typescript
import { Mailer } from '@volcanicminds/tools/mailer'

const mailer = new Mailer({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  secure: false
})

// Automatically generates text/plain version from HTML
await mailer.send({
  to: 'client@example.com',
  subject: 'Order Confirmation',
  html: '<p>Your order <strong>#123</strong> has been confirmed.</p>'
})
```

---

## 7.3 Job Scheduler

Framework integrates a scheduling system (based on `toad-scheduler`) to execute recurring tasks (e.g., reporting, token cleanup).

### Configuration

1.  Enable scheduler in `src/config/general.ts`:
    ```typescript
    export default {
      // ...
      options: {
        scheduler: true
      }
    }
    ```
2.  Create jobs in `src/schedules/*.job.ts`.

### Job Structure

Every `.job.ts` file must export a `schedule` configuration and a `job` function.

**Example: Automatic Monthly Report**

```typescript
import { JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true, // Switch ON/OFF
  async: true, // Is task asynchronous?
  preventOverrun: true, // Prevents overlap if previous task is slow

  // CRON Type (Recommended for precise timing)
  type: 'cron',
  cron: {
    expression: '0 2 1 * *', // At 02:00 on first day of every month
    timezone: 'Europe/Rome'
  }
}

export async function job() {
  log.info('Starting monthly report generation...')
  try {
    // Business logic (e.g. call a Service)
    // await reportingService.generateMonthlyStats()
    log.info('Monthly report generated.')
  } catch (err) {
    log.error({ err }, 'Failed to generate monthly report')
  }
}
```

---

## 7.4 Audit Tracking (Change Tracking)

Volcanic includes a "magic" system to track entity changes (Application Change Data Capture) without polluting controllers with logging logic.

### Configuration (`src/config/tracking.ts`)

Define which routes and entities to monitor.

```typescript
export default {
  config: {
    enableAll: false,
    changeEntity: 'Change', // Entity where to save logs (src/entities/change.ts)
    primaryKey: 'id'
  },
  changes: [
    {
      enable: true,
      method: 'PUT', // Track only updates
      path: '/orders/:id', // Matching API Route
      entity: 'Order', // TypeORM Entity to query for "old" state

      // Field Filters
      fields: {
        includes: ['status', 'amount', 'deliveryDate'], // Track only these
        excludes: ['updatedAt'] // Ignore technical timestamps
      }
    }
  ]
}
```

### Internal Working

1.  **`preHandler` Hook**: If route matches tracking rule, framework reads current record state from DB and saves it in `req.trackingData`.
2.  **Controller**: Executes update.
3.  **`preSerialization` Hook**: Framework compares input payload (new values) with `req.trackingData` (old values).
4.  **DB Write**: If differences exist in monitored fields, creates record in `change` table with JSON delta, User ID, and timestamp.

---

## 7.5 Testing Strategies

Test suite uses `mocha` as runner, `expect` for assertions, and a custom wrapper around `axios` for simulated HTTP calls.

### Setup (`test/common/bootstrap.ts`)

This file starts a server instance (often with in-memory DB or dedicated test DB) before running suite.

```typescript
import { start as startServer } from '@volcanicminds/backend'
import { userManager } from '@volcanicminds/typeorm'

// Mocha Global Hook
export const beforeAll = async () => {
  // Starts server on test port (e.g. 2231)
  await startServer({ userManager })
}
```

### E2E Tests (End-to-End)

E2E tests simulate real client calling APIs. Located in `test/e2e/`.

**Example: Order Flow Test**

```typescript
import { expect } from 'expect'
import { login, get, post } from '../common/api.js' // Helper axios wrapper

describe('Orders E2E', () => {
  let token = ''

  // 1. Setup: Get Admin Token
  before(async () => {
    const auth = await login('admin@test.volcanicminds.com', 'password')
    token = auth.token
  })

  // 2. Creation Test
  it('should create a new order', async () => {
    const payload = {
      code: 'TEST_ORD_001',
      name: 'Test Order',
      company: 'volcanicminds',
      year: 2025
    }

    const response = await post('/orders', payload, {
      headers: { Authorization: `Bearer ${token}` }
    })

    expect(response.id).toBeDefined()
    expect(response.code).toBe('TEST_ORD_001')
  })

  // 3. List Test with Filters
  it('should find the created order via magic query', async () => {
    // We test URL -> SQL translation
    const { data, headers } = await get('/orders?code:eq=TEST_ORD_001')

    expect(data).toHaveLength(1)
    expect(data[0].name).toBe('Test Order')
    expect(headers['v-total']).toBe('1')
  })
})
```

### Unit Tests (`test/unit/`)

Test logic of Services or Utilities without starting full HTTP server. May require mocking Repository if real DB is not desired.

```typescript
import { expect } from 'expect'
import { professionalService } from '../../src/services/professional.service.js'

describe('Professional Service', () => {
  it('should calculate counts correctly', async () => {
    // Note: requires connected DB or Repository Mock
    const count = await professionalService.count({ role: 'admin' }, {})
    expect(typeof count).toBe('number')
  })
})
```

---

# Part 8: System Administration and Deployment

Volcanic Stack deployment is designed to be container-native. Application must run behind a Reverse Proxy (Nginx) handling SSL termination and perimeter security, while Docker container handles isolated application logic.

## 8.1 Server Hardening (Ubuntu/Linux)

Before installing any application, host server must be secured.

### 1. Firewall Configuration (UFW)

We adopt "Deny by Default" strategy. Only strictly necessary ports are opened.

```bash
# 1. Install UFW if not present
sudo apt update && sudo apt install ufw -y

# 2. Base Policy: Block everything incoming, allow everything outgoing
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 3. CRITICAL: Allow SSH (otherwise you lock yourself out)
sudo ufw allow OpenSSH

# 4. Allow Standard Web Traffic (HTTP/HTTPS) managed by Nginx
sudo ufw allow 'Nginx Full'

# 5. Enable firewall
sudo ufw enable
```

### 2. Base Stack Installation

Installing Docker, Nginx, and Certbot.

```bash
# Docker & Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Nginx & Certbot
sudo apt install nginx certbot python3-certbot-nginx -y
```

---

## 8.2 Nginx: Reverse Proxy & Security Gateway

Nginx is not just forwarding requests. It acts as basic **WAF (Web Application Firewall)**, SSL terminator, and Rate Limiting manager to protect Node.js process (single-threaded).

### Configuration (`/etc/nginx/sites-available/volcanic-sample-backend`)

```nginx
# --- 1. RATE LIMITING (DDoS/Bruteforce Protection) ---
# API Zone: Max 10 requests per second per IP.
# Protects backend from CPU saturation due to too many requests.
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

# Connections Zone: Protects from TCP socket exhaustion (Slowloris).
limit_conn_zone $binary_remote_addr zone=addr_limit:10m;

# --- 2. HTTP -> HTTPS REDIRECT ---
server {
    listen 80;
    server_name api.example.com; # Replace with real domain
    return 301 https://$host$request_uri;
}

# --- 3. MAIN SERVER (HTTPS) ---
server {
    listen 443 ssl;
    server_name api.example.com;

    # --- SSL CERTIFICATES (Managed by Certbot) ---
    # Certbot will automatically insert them here after first run
    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # --- SECURITY HARDENING ---
    server_tokens off; # Hides Nginx version (Security by obscurity)
    client_max_body_size 10M; # Limits upload to avoid DoS on disk/ram

    # Browser Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # --- BACKEND API PROXY ---
    location / {
        # Applied Rate Limit: Max 10 req/s, burst (peak) up to 20 without delay
        limit_req zone=api_limit burst=20 nodelay;
        limit_conn addr_limit 10;

        # Proxy to Docker (Localhost port 2230)
        # Note: Container exposes port only on localhost for security
        proxy_pass http://127.0.0.1:2230;

        # WebSocket and KeepAlive support
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # IP Passthrough (Fundamental for backend audit logs)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Activation

```bash
# Symbolic link
sudo ln -s /etc/nginx/sites-available/volcanic-sample-backend /etc/nginx/sites-enabled/

# Remove default
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null

# Check and Restart
sudo nginx -t
sudo systemctl reload nginx

# Obtain Certificate (at first setup)
sudo certbot --nginx -d api.example.com
```

---

## 8.3 Docker Deployment Strategy

Backend runs in an isolated Docker container. Image is built using **Multi-Stage Build** strategy (visible in `Dockerfile`) to keep production image lightweight (without TypeScript compilers or devDependencies).

### Production Environment File (`.env.prod`)

This file must reside on server (e.g., `/home/ubuntu/volcanic-sample-backend/.env.prod`) and **NOT** in Git repository.

```properties
# --- CORE SETTINGS ---
NODE_ENV=production
HOST=0.0.0.0
PORT=2230 # Internal container port

# --- NODE TUNING ---
# Limit Garbage Collector to about 75% of RAM allocated to container
# Example for container with 4GB RAM
NODE_OPTIONS=--max-old-space-size=3072

# --- AUTH SECURITY ---
# Generate with: openssl rand -base64 64
JWT_SECRET=CHANGE_THIS_TO_VERY_LONG_RANDOM_STRING
JWT_EXPIRES_IN=15m
JWT_REFRESH=true
JWT_REFRESH_SECRET=CHANGE_THIS_TO_DIFFERENT_RANDOM_STRING
JWT_REFRESH_EXPIRES_IN=30d

# --- DATABASE (E.g. OVH Managed or AWS RDS) ---
START_DB=true
DB_HOST=pg-databases.ovh.net
DB_PORT=20184
DB_NAME=db_production
DB_USERNAME=db_user
DB_PASSWORD=secure_db_password

# --- DB SSL ---
# Required for secure cloud connections
DB_SSL=true
# INTERNAL container path (mounted via volume)
DB_SSL_CA_PATH=/app/certs/ca.pem

# --- LOGGING ---
# In production 'info' reduces I/O. Use 'false' for colorize for parsers (Datadog/ELK)
LOG_LEVEL=info
LOG_COLORIZE=false
```

### Docker Startup Script

Do not use manual `docker run` every time. Create a script or use this full command.

**Run Command:**

```bash
docker run -d \
  --name volcanic-sample-backend \
  --restart always \
  # Exposes port ONLY on localhost (Nginx will proxy)
  -p 127.0.0.1:2230:2230 \
  # Resolves internal DNS issues in some cloud networks
  --add-host host.docker.internal:host-gateway \
  # Mounts production .env file
  --env-file /home/ubuntu/volcanic-sample-backend/.env.prod \
  # Mounts CA certificates for DB (if needed)
  -v /home/ubuntu/certs:/app/certs \
  volcanic-sample-backend:latest
```

---

## 8.4 Continuous Deployment ("Poor Man's CI/CD")

For quick setup without Kubernetes, a simple bash script executed via cron is robust and effective. Checks Git, if changes exist, rebuilds and restarts.

### `deploy.sh` Script

```bash
#!/bin/bash

# Configuration
LOG_FILE="/home/ubuntu/deploy.log"
APP_DIR="/home/ubuntu/volcanic-sample-backend"
IMAGE_NAME="volcanic-sample-backend"
CONTAINER_NAME="volcanic-sample-backend"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$APP_DIR" || { log "Directory not found"; exit 1; }

# 1. Fetch without merge
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    log "🚀 Update found! ($LOCAL -> $REMOTE)"

    # 2. Download code
    git pull origin main

    # 3. Docker Build
    log "Building Docker Image..."
    docker build -t $IMAGE_NAME .

    if [ $? -eq 0 ]; then
        # 4. Zero-Downtime Restart (conceptual: stop -> start fast)
        log "Restarting Container..."
        docker stop $CONTAINER_NAME || true
        docker rm $CONTAINER_NAME || true

        # Run command (copy parameters from paragraph 8.3)
        docker run -d \
          --name $CONTAINER_NAME \
          --restart always \
          -p 127.0.0.1:2230:2230 \
          --env-file .env.prod \
          -v /home/ubuntu/certs:/app/certs \
          $IMAGE_NAME

        log "✅ Backend updated successfully."

        # Cleanup old images
        docker image prune -f > /dev/null 2>&1
    else
        log "❌ Build Failed. Aborting restart."
    fi
else
    # No update, silent exit
    :
fi
```

### Automation (Crontab)

Run check every 15 minutes.

```bash
*/15 * * * * /home/ubuntu/volcanic-sample-backend/deploy.sh >> /dev/null 2>&1
```

---

## 8.5 Database Operations

### Mandatory Extensions

PostgreSQL must have UUID extension active.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Data Seeding (Initial Population)

Instead of running manual SQLs that could violate integrity constraints or bypass password hashing, `volcanic-sample-backend` provides a dedicated endpoint for secure initialization.

Reference file: `src/api/tools/controller/tools.ts`.

1.  Ensure caller user has temporary token or security is disabled for first start.
2.  Call:
    ```bash
    curl -X GET http://localhost:2230/api/tools/prepare-database \
         -H "Authorization: Bearer <ADMIN_TOKEN>"
    ```
3.  **What it does:**
    - Cleans tables in correct order (respecting FK).
    - Creates Users, Professionals, Clients, and Test Orders defined in `src/utils/initialData.ts`.
    - Applies correct hashing to passwords (`bcrypt`).

---

## 8.6 Diagnostics and Monitoring

Essential tools to understand system state in production.

### 1. Application Logs

See what is happening in backend in real time.

```bash
docker logs volcanic-sample-backend --tail 200 -f
```

### 2. Resources (CPU/RAM)

Verify if container is under stress or if there is a memory leak.

```bash
# Live view
docker stats --no-stream

# Verify memory limit applied
docker inspect volcanic-sample-backend --format='Memory Limit: {{.HostConfig.Memory}}'
```

### 3. Database Connectivity

If app doesn't start ("Connection Timeout"), verify if container can reach DB.

```bash
# Enter container and use nc (netcat) or ping
docker exec -it volcanic-sample-backend sh
/usr/src/app # nc -zv pg-databases.ovh.net 20184
```

---

# Part 9: GraphQL & Apollo Integration

The Volcanic Stack supports a **Dual-Stack** architecture: it is possible to expose same business functionalities via both REST (for standard integrations/web) and GraphQL (for mobile clients or complex frontends requiring selective data-fetching), keeping code DRY (Don't Repeat Yourself).

## 9.1 Activation and Configuration

Apollo Server integration is conditionally handled at startup.

### 1. Environment Variables (`.env`)

To enable `/graphql` endpoint and Sandbox (if in dev):

```properties
GRAPHQL=true
```

### 2. File Structure

By convention, GraphQL code resides in `src/apollo`:

```bash
src/
└── apollo/
    ├── type-defs.ts    # Schema Definitions (SDL)
    ├── resolvers.ts    # Mapping Query/Mutation -> Service
    └── context.ts      # Context construction (Auth)
```

---

## 9.2 Authentication and UserContext

In GraphQL we don't have Fastify middleware (`global.isAuthenticated`) executed linearly before resolver in same way. Authentication must happen during **Context** construction.

Our goal is to inject same `UserContext` used in REST APIs, so Services (`applyPermissions`) work without modifications.

### `src/apollo/context.ts` Implementation

```typescript
import { FastifyRequest, FastifyReply } from 'fastify'
import { UserContext } from '../../types/index.js'

export interface MyContext {
  userContext: UserContext
}

export const myContextFunction = async (request: FastifyRequest, reply: FastifyReply): Promise<MyContext> => {
  // 1. Token Extraction
  const authHeader = request.headers.authorization
  const token = authHeader?.replace('Bearer ', '')

  // Default Context (Public/Guest)
  let userContext: UserContext = {
    userId: null,
    role: 'public',
    company: undefined,
    professionalId: undefined
  }

  if (token) {
    try {
      // 2. JWT Validation (uses Fastify server jwt instance)
      const decoded: any = request.server.jwt.verify(token)

      // 3. User Recovery from DB (similar to REST preHandler hook)
      // Note: we use global userManager or direct repository
      const user = await repository.users.findOne({
        where: { externalId: decoded.sub },
        relations: ['professional']
      })

      if (user && !user.blocked) {
        userContext = {
          userId: user.id,
          role: 'user', // Role mapping logic (simplified)
          company: user.professional?.company,
          professionalId: user.professional?.id
        }

        if (user.roles.includes('admin')) userContext.role = 'admin'
        else if (user.roles.includes('manager')) userContext.role = 'manager'
      }
    } catch (err) {
      // Invalid token: proceed as public or throw error if entire API is private
      // throw new GraphQLError('Invalid Token', { extensions: { code: 'UNAUTHENTICATED' } });
    }
  }

  return { userContext }
}
```

---

## 9.3 Schema First: TypeDefs and Resolvers

Recommended approach is **Schema First**: define types, then implement resolvers delegating to Services.

### 1. Definition (`src/apollo/type-defs.ts`)

```typescript
export const typeDefs = `
  type Order {
    id: ID!
    code: String!
    name: String!
    status: String
    # Relations
    workOrders: [WorkOrder]
  }

  type WorkOrder {
    id: ID!
    code: String!
  }

  # Input for complex filters (Mapping on Magic Query)
  input OrderFilter {
    code: String      # eq
    status: String    # eq
    nameContains: String # contains
  }

  type Query {
    # Retrieve specific order
    order(id: ID!): Order
    
    # List with filters
    orders(filter: OrderFilter, page: Int, pageSize: Int): [Order]
  }
`
```

### 2. Resolvers (`src/apollo/resolvers.ts`)

Resolvers must **NOT** contain SQL logic. They must only call existing Services.

```typescript
import { orderService } from '../services/order.service.js'
import { workOrderService } from '../services/workOrder.service.js'

export const resolvers = {
  Query: {
    order: async (_: any, args: { id: string }, context: MyContext) => {
      // Service reuse: security is guaranteed by findOne internally
      return await orderService.findOne(context.userContext, args.id)
    },

    orders: async (_: any, args: any, context: MyContext) => {
      // Mapping GraphQL arguments -> Volcanic Query Params
      // (See section 9.4 for advanced helpers)
      const queryParams = {
        page: args.page || 1,
        pageSize: args.pageSize || 25,
        // Example manual mapping
        ...(args.filter?.code && { code: args.filter.code }),
        ...(args.filter?.nameContains && { 'name:contains': args.filter.nameContains })
      }

      const { records } = await orderService.findAll(context.userContext, queryParams)
      return records
    }
  },

  // Field Resolver for relations (solves N+1 or lazy loading)
  Order: {
    workOrders: async (parent: any, _: any, context: MyContext) => {
      // If workOrders was already loaded by parent service, use it
      if (parent.workOrders) return parent.workOrders

      // Otherwise call child service filtering by parent
      // Note: service findAll applies security here too!
      const { records } = await workOrderService.findAll(context.userContext, {
        'order:eq': parent.id
      })
      return records
    }
  }
}
```

---

## 9.4 Advanced Pattern: GraphQL to Magic Query Bridge

REST filter system (`name:contains=foo`) is very powerful. To not lose this power in GraphQL without rewriting thousands of input types, we can create an **adapter**.

### Utility: `graphqlToVolcanic`

Let's imagine passing a JSON stringify or free object in GraphQL for advanced filters.

**TypeDefs:**

```graphql
scalar JSON # Requires graphql-type-json
type Query {
  # queryParams accepts standard Volcanic object { "name:like": "A%", "sort": "id:desc" }
  ordersGeneric(queryParams: JSON): [Order]
}
```

**Resolver:**

```typescript
ordersGeneric: async (_: any, args: { queryParams: any }, ctx: MyContext) => {
  // Direct passing ("Pass-through")
  // Service receives exactly what it would receive from REST controller
  const { records } = await orderService.findAll(ctx.userContext, args.queryParams || {})
  return records
}
```

**Advantages:**

1.  **Feature Parity**: Any filter supported by `@volcanicminds/typeorm` (including `_logic` or nested filtering `client.name:eq`) works in GraphQL immediately.
2.  **Maintainability**: No need to create `InputType` for every filter combination.

---

## 9.5 Performance: The N+1 Problem

In GraphQL, it is easy to fall into N+1 problem (e.g., asking for 100 orders, and for each one `client` resolver makes a DB query).

### Solution 1: `addRelations` in Service (Eager Loading)

If we know a GraphQL query will often require a relation, configure Service to load it by default.

```typescript
// src/services/order.service.ts
protected addRelations(qb, alias) {
    // Always load client.
    // Order.client resolver won't need extra queries.
    return qb.leftJoinAndSelect(`${alias}.client`, 'client')
}
```

### Solution 2: DataLoader (Advanced)

If eager loading is too heavy, use `DataLoader` in context.

1.  Create a `BatchLoader` accepting array of IDs.
2.  Execute `repository.find({ where: { id: In(ids) } })`.
3.  Use loader in resolver: `return context.loaders.clientLoader.load(parent.clientId)`.

> **Volcanic Advice**: For 90% of business cases (dashboards, lists), smart usage of `addRelations` in `BaseService` combined with pagination is sufficient and much easier to maintain than DataLoaders.

---

## 9.6 Integration Summary

1.  **Enable** GraphQL in `.env`.
2.  **Implement** `src/apollo/context.ts` to extract JWT token and create `UserContext` identical to REST one.
3.  **Define** Schema (`type-defs.ts`).
4.  **Implement** Resolvers mapping them 1:1 to Service `findAll`/`findOne` methods.
5.  **Enjoy** automatic RLS security: since resolvers call Services, a GraphQL user can never see data they couldn't see via REST.

---

# Part 10: Advanced Patterns and Troubleshooting

This final section collects specific patterns implemented in `volcanic-sample-backend` for data lifecycle management and common problem solving.

## 10.1 Data Seeding & Maintenance

Unlike classic migrations, `volcanic-sample-backend` uses a **"Smart Seeding"** approach via API. This is very useful for test environments, staging, or restoring a clean dev environment.

### The `src/api/tools` Approach

Controller `tools.ts` exposes administrative endpoints performing destructive or massive operations.

**Endpoint: `POST /api/tools/prepare-database`**

This endpoint (protected by Admin Auth) performs three critical steps:

1.  **Clean**: Empties tables in reverse order of Foreign Keys (to avoid constraint errors).
    ```typescript
    // Example from src/api/tools/controller/tools.ts
    const queryRunner = connection.createQueryRunner()
    // Reverse dependency order
    await queryRunner.query('DELETE FROM "timesheet";') // Child
    await queryRunner.query('DELETE FROM "activity";') // Parent
    // ...
    ```
2.  **Seed**: Inserts static data defined in `src/utils/initialData.ts`.
    - Users, Roles, Order States, Categories.
3.  **Link**: Connects entities (e.g., assigns WorkOrders to newly created Orders using business logic, like unique code generation).

**Best Practice:**
Never commit sensitive data in `initialData.ts`. Use libraries like `faker` or anonymized data.

---

## 10.2 Enum and Constant Management

To maintain consistency between database (Postgres) and code (TypeScript), `volcanic-sample-backend` centralizes definitions.

### File: `src/entities/all.enums.ts`

Instead of scattering magic strings ('active', 'closed') in code, exported TypeScript Enums are used.

```typescript
export enum OrderStateEnum {
  ACTIVE = 'active',
  CLOSED = 'closed',
  LOST = 'lost'
}

export const VALID_COMPANIES = ['volcanicminds', 'acme']
```

**Usage in Entity:**

```typescript
import { OrderStateEnum } from './all.enums.js'

@Column({
  type: 'enum',
  enum: OrderStateEnum,
  default: OrderStateEnum.ACTIVE
})
state: OrderStateEnum
```

**Usage in Service/Controller:**

```typescript
if (order.state === OrderStateEnum.CLOSED) {
  // ...
}
```

---

## 10.3 Troubleshooting: Common Errors and Solutions

Working with Volcanic Stack, you might encounter these specific errors. Here is how to solve them.

### 1. "Relation not found" / "Missing FROM-clause entry"

**Symptom:** Calling API with relational filter (e.g., `?client.name:eq=Acme`) receives 500 SQL error.
**Cause:** Relation `client` was not loaded in Service.
**Solution:** Add join in `addRelations` of Service.

```typescript
// src/services/order.service.ts
protected addRelations(qb, alias) {
    // Alias 'client' MUST match prefix used in filter
    return qb.leftJoinAndSelect(`${alias}.client`, 'client')
}
```

### 2. "Circular Dependency" at startup

**Symptom:** Server crashes at startup or TypeORM complains an entity is `undefined`.
**Cause:** Circular import between entity files (e.g., Order imports WorkOrder which imports Order).
**Solution:**

1.  Use `import type { ... }` for TypeScript types.
2.  In TypeORM decorators, use **strings** instead of classes.

```typescript
// ERROR: @OneToMany(() => WorkOrder, ...)
// CORRECT: @OneToMany('WorkOrder', ...)
```

### 3. Silent "Access Denied" (Empty List)

**Symptom:** User calls `GET /orders` and receives `[]` (empty list), but DB has data.
**Cause:** RLS (`applyPermissions`) is filtering everything.
**Debug:**

1.  Enable `DB_LOGGING=true` in `.env`.
2.  Check generated SQL query in console.
3.  Verify `req.userContext` in controller: is role correct? Is professional ID associated?

### 4. Date and Timezone Management

**Problem:** Saved dates seem wrong by 1 or 2 hours.
**Rule:**

1.  DB (Postgres) must be in UTC.
2.  Backend (Node) must work in UTC.
3.  Frontend converts to Locale.
4.  In `src/entities/*.ts`, use `timestamp` columns (without time zone) if handling everything in app UTC, or `timestamptz` if wanting Postgres to handle offset. Volcanic prefers standard ISO strings (`YYYY-MM-DDTHH:mm:ss.sssZ`).

---

## 10.4 Production Release Checklist

Before deploying `volcanic-sample-backend`, verify:

1.  [ ] **Env**: `NODE_ENV=production`.
2.  [ ] **Logs**: `LOG_LEVEL=info` (not `trace` or `debug`).
3.  [ ] **DB Sync**: `DB_SYNCHRONIZE=false` (fundamental not to lose data).
4.  [ ] **Auth**: `JWT_SECRET` and `JWT_REFRESH_SECRET` are long, complex, and different from each other.
5.  [ ] **MFA**: Policy set according to business requirements (`OPTIONAL` or `MANDATORY`).
6.  [ ] **Admin**: Verify Admin user has strong password and active MFA.
