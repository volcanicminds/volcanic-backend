# TypeScript Guide: Extending the Framework

`@volcanicminds/backend` is built with TypeScript and allows for powerful type safety and extensibility through Declaration Merging. This guide explains how to properly type your application context, global variables, and request objects.

## 1. Declaration Merging (`types/index.d.ts`)

To add custom properties to the standard Fastify Request or Global scope without causing compilation errors, you need to extend the existing type definitions.

Create or edit `types/index.d.ts` in your project root:

```typescript
import { FastifyRequest as _FastifyRequest } from 'fastify'

// 1. Extend FastifyRequest
declare module 'fastify' {
  export interface FastifyRequest {
    // Add your custom context property
    userContext: UserContext
  }
}

// 2. Define your UserContext interface
export interface UserContext {
  userId: string | null
  role: 'admin' | 'manager' | 'user' | 'public'
  // Add app-specific context fields
  company?: string
  professionalId?: string
}

// 3. Extend Global scope
// This allows TS to recognize global.entity, global.connection, etc.
declare global {
  var log: any
  var server: any
  var config: any
  var roles: any
  var connection: any
  // You can make these more specific if you have type definitions for your entities
  var entity: any
  var repository: any
}

export {}
```

**Note**: Ensure your `tsconfig.json` includes this file in the `include` array or via `typeRoots`.

## 2. Context Injection (`preHandler`)

A common pattern is to enrich the request object with a calculated "User Context" early in the request lifecycle. This decouples your Service Layer from the raw HTTP Request.

Create a hook in `src/hooks/preHandler.ts`:

```typescript
import { FastifyRequest, FastifyReply } from '@volcanicminds/backend'

// This hook runs before every controller handler
export default async (req: FastifyRequest, _reply: FastifyReply) => {
  const user = req.user as any
  const roles = user?.roles || []
  const professional = user?.professional

  // Build the context based on the authenticated user
  const context: any = {
    userId: user?.id || null,
    role: 'public',
    company: undefined,
    professionalId: undefined
  }

  if (user) {
    if (roles.includes('admin')) {
      context.role = 'admin'
    } else if (roles.includes('manager')) {
      context.role = 'manager'
      // Specific logic: Manager is bound to a company
      context.company = professional?.company
    } else {
      context.role = 'user'
      context.professionalId = professional?.id
      context.company = professional?.company
    }
  }

  // Inject into the request.
  // Thanks to the types/index.d.ts extension, this is type-safe!
  req.userContext = context
}
```

## 3. Using Context in Services

Now your Services can define methods that accept `UserContext` instead of `FastifyRequest`. This makes them cleaner and easier to test.

```typescript
// src/services/order.service.ts
import { UserContext } from '../../types/index.js'

export class OrderService {
  // Method signature uses the custom UserContext type
  async findAll(ctx: UserContext, params: any) {
    // You get intellisense on ctx properties!
    if (ctx.role === 'manager') {
      // ... filter by ctx.company
    }

    // ... implementation
  }
}
```

## 4. Global Augmentation Best Practices

The data layer exposes `global.entity.<Pascal>` (the entity classes) and `global.connection`
(the `DataSource`). **Do not use `global.repository.X`** — it is a fail-fast Proxy that
**throws at runtime** on any access. The framework forbids it on purpose so every data access
stays request-scoped and multi-tenant safe.

**Recommendation:** access data through the Service layer bound to the request-scoped
`EntityManager` (`req.db`). A `BaseService` resolves its repository from whatever you pass to
`.use(req.db)`, so the same service is safe across tenants:

```typescript
// In a controller — bind the service to req.db, then query.
const { headers, records } = await orderService.use(req.db).findAll(req.userContext, req.data())
```

Construct services with the entity class (e.g. `super(Order)` in the service, or
`global.connection.getRepository(Order)`), never via `global.repository`. See
`docs/ADVANCED_ARCHITECTURE.md` for the full Service/Repository pattern.

If you want stricter typing on the (valid) `global.entity`, keep `types/index.d.ts` up to date:

```typescript
import { User } from '../src/entities/user.e'
import { Order } from '../src/entities/order.e'

declare global {
  // Entity classes are exposed as global.entity.<Pascal>. There is NO global.repository:
  // resolve repositories via service.use(req.db) / global.connection.getRepository(...).
  var entity: { User: typeof User; Order: typeof Order /* … */ }
}
```

## Data layer & tsconfig

The data layer is included as the subpath `@volcanicminds/backend/typeorm`:

```typescript
import { start as startDatabase, userManager, DataSource } from '@volcanicminds/backend/typeorm'
```

**TypeORM entities** (decorated properties without an initializer) require the `tsconfig.json` to set
`strictPropertyInitialization: false`, `useUnknownInCatchVariables: false`, `noUnusedLocals: false` — already
set in the framework repo. A consumer that defines its own entities must replicate them in its own tsconfig.

### Always set an explicit column `type`

Every decorated column must declare an explicit `type`:

```typescript
@Column({ type: 'varchar', nullable: true })   name: string
@Column({ type: 'boolean', default: false })    visible: boolean
@Column({ type: 'timestamp', nullable: true })  publishedAt: Date
@Column({ type: 'int', default: 0 })            importance: number
```

Do **not** rely on TypeORM inferring the column type from the property's TypeScript type. That inference
needs `emitDecoratorMetadata`, which the **`tsx` / esbuild** dev runner (`npm run dev`, `npm start`) does
**not** emit. An untyped `@Column()` compiles and boots fine under `tsc` (`npm run build`) but throws
`ColumnTypeUndefinedError: Column type for X#field is not defined` at startup under `tsx`. Setting the type
explicitly keeps dev and build identical. The special decorators (`@PrimaryGeneratedColumn`,
`@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn`, `@VersionColumn`) already carry a known type
and need no `type` option.

Also keep `"type": "module"` in the consumer's `package.json` (the framework is ESM) — removing it breaks
the `tsc` build.
