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
// This allows TS to recognize global.entity, global.repository, etc.
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

While the framework exposes `global.entity` and `global.repository` for convenience, using them directly can sometimes break type inference or make testing harder if dependencies aren't mocked.

**Recommendation**:
Instead of using `global.repository.users` everywhere, consider "injecting" or aliasing them at the top of your service files or using a dependency injection pattern if your architecture requires it.

However, for rapid development within the framework's paradigm, the global accessors are standard. Just ensure `types/index.d.ts` is kept up to date if you want stricter typing on repositories.

```typescript
// Advanced: Typing the global repository object
import { Repository } from 'typeorm'
import { User } from '../src/entities/user.e'
import { Order } from '../src/entities/order.e'

declare global {
  var repository: {
    users: Repository<User>
    orders: Repository<Order>
    // ... other repos
  }
}
```
