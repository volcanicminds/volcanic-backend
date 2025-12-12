# Advanced Architecture: Service & Repository Pattern

While `@volcanicminds/backend` allows for simple route-to-controller logic, building enterprise-grade applications requires a more robust architecture to handle complexity, security, and maintainability.

This guide details the recommended architecture used in complex projects (like `volcanic-backend-sample`), focusing on the **Service Layer Pattern** and the **BaseService abstraction**.

## The Layered Approach

To maintain Separation of Concerns (SoC), the application is divided into distinct layers:

1.  **Route Layer**: Defines HTTP endpoints, method types, validation schemas, and required roles.
2.  **Controller Layer**: Handles HTTP request parsing, delegates logic to the Service Layer, and formats the HTTP response. **Controllers should remain "thin".**
3.  **Service Layer**: Contains the business logic. It operates on Domain Entities and is agnostic of the HTTP transport (it doesn't know what `req` or `res` are). It receives a `UserContext` and raw data.
4.  **Data Access Layer (Repositories)**: Managed by `@volcanicminds/typeorm`.

## The `BaseService` Pattern

To avoid code duplication for standard CRUD operations (searching, counting, finding by ID), we recommend creating an abstract `BaseService` class. This class leverages TypeORM's `QueryBuilder` to handle filtering, sorting, and pagination dynamically while enforcing security permissions.

### 1. Define the BaseService

Create `src/services/base.service.ts`. This generic class will be extended by all your specific entity services.

```typescript
import { ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm'
import { UserContext } from '../../types/index.js' // Your defined UserContext interface

export abstract class BaseService<T extends ObjectLiteral> {
  protected repository: Repository<T>

  constructor(repository: Repository<T>) {
    this.repository = repository
  }

  // Abstract method: Forces developers to define security rules for every entity
  protected abstract applyPermissions(qb: SelectQueryBuilder<T>, ctx: UserContext, alias: string): SelectQueryBuilder<T>

  // Hook to add relationships (joins) automatically
  protected addRelations(qb: SelectQueryBuilder<T>, _alias: string): SelectQueryBuilder<T> {
    return qb
  }

  // Hook for complex custom filters not handled by standard query parser
  protected applyCustomFilters(_qb: SelectQueryBuilder<T>, _queryParams: any, _alias: string): any {
    return _queryParams
  }

  protected createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    return this.repository.createQueryBuilder(alias)
  }

  // Standard FindAll with Pagination, Sorting, Permissions and Relations
  async findAll(ctx: UserContext, queryParams: any = {}): Promise<{ headers: any; records: T[] }> {
    const alias = this.repository.metadata.tableName
    let qb = this.createQueryBuilder(alias)

    // 1. Apply Relations
    qb = this.addRelations(qb, alias)

    // 2. Apply Security Permissions (Row Level Security)
    qb = this.applyPermissions(qb, ctx, alias)

    // 3. Apply Custom Logic
    const paramsToProcess = this.applyCustomFilters(qb, { ...queryParams }, alias)

    // 4. Apply Standard Filters, Sort, Pagination via Helper (see Data Layer Magic guide)
    // ... implementation of standard filtering mapping ...

    // Example logic (simplified for brevity):
    if (paramsToProcess.page && paramsToProcess.pageSize) {
      const page = parseInt(paramsToProcess.page) || 1
      const pageSize = parseInt(paramsToProcess.pageSize) || 25
      qb.skip((page - 1) * pageSize).take(pageSize)
    }

    const [records, total] = await qb.getManyAndCount()

    const headers = {
      'v-count': records.length,
      'v-total': total,
      'v-page': paramsToProcess.page || 1,
      'v-pageSize': paramsToProcess.pageSize || records.length || 1,
      'v-pageCount': Math.ceil(total / (parseInt(paramsToProcess.pageSize) || records.length || 1))
    }

    return { headers, records }
  }

  async findOne(ctx: UserContext, id: string): Promise<T | null> {
    const alias = this.repository.metadata.tableName
    let qb = this.createQueryBuilder(alias)

    qb = this.addRelations(qb, alias)

    // Crucial: Permissions are applied even on single retrieval
    qb = this.applyPermissions(qb, ctx, alias)

    qb.andWhere(`${alias}.id = :id`, { id })

    return qb.getOne()
  }
}
```

## Implementing a Concrete Service

Here is how you extend the `BaseService` for a specific entity (e.g., `Order`). Notice how `applyPermissions` enforces multitenancy or role-based visibility.

```typescript
// src/services/order.service.ts
import { SelectQueryBuilder } from 'typeorm'
import { BaseService } from './base.service.js'
import { Order } from '../entities/order.e.js'
import { UserContext } from '../../types/index.js'

export class OrderService extends BaseService<Order> {
  constructor() {
    // Pass the specific repository from the global scope
    super(repository.orders)
  }

  // Automatically load related entities
  protected addRelations(qb: SelectQueryBuilder<Order>, alias: string): SelectQueryBuilder<Order> {
    return qb.leftJoinAndSelect(`${alias}.client`, 'client').leftJoinAndSelect(`${alias}.items`, 'items')
  }

  // Define Row Level Security
  protected applyPermissions(
    qb: SelectQueryBuilder<Order>,
    ctx: UserContext,
    alias: string
  ): SelectQueryBuilder<Order> {
    // Admin sees everything
    if (ctx.role === 'admin') {
      return qb
    }

    // Managers only see orders belonging to their company
    if (ctx.role === 'manager') {
      if (!ctx.company) {
        qb.andWhere('1=0') // Security Fail-safe
        return qb
      }
      qb.andWhere(`${alias}.company = :company`, { company: ctx.company })
      return qb
    }

    // Users see nothing (or define specific logic)
    qb.andWhere('1=0')
    return qb
  }
}

// Export as Singleton
export const orderService = new OrderService()
```

## The Thin Controller

The controller is now purely an interface adapter. It converts the HTTP Request into arguments for the Service.

```typescript
// src/api/orders/controller/order.ts
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { orderService } from '../../../services/order.service.js'

export async function find(req: FastifyRequest, reply: FastifyReply) {
  // 1. Extract User Context (Who is calling?)
  const ctx = req.userContext

  // 2. Extract Data (Query params, Body)
  const data = req.data()

  // 3. Call Service
  const { headers, records } = await orderService.findAll(ctx, data)

  // 4. Send Response
  return reply.type('application/json').headers(headers).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const ctx = req.userContext

  const order = await orderService.findOne(ctx, id)

  // Handle 404 Not Found OR 403 Forbidden (implicitly handled by service returning null)
  return order || reply.status(404).send()
}
```

## Benefits of this Architecture

1.  **Security by Default**: You cannot forget to apply a permission filter. If you use `findOne` or `findAll` from `BaseService`, the `applyPermissions` logic is always executed.
2.  **Reusability**: Common logic (pagination, headers calculation) is written once.
3.  **Testability**: You can easily test `OrderService` without mocking `FastifyRequest` or `FastifyReply` objects.
4.  **Consistency**: All APIs behave the same way regarding sorting, filtering, and data structure.
