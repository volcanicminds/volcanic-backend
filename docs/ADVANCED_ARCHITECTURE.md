# Advanced architecture: the service layer

A route handler that talks to the database directly works until the second route needs the same
rule. This guide describes the architecture the framework expects for anything larger than that:
a thin controller, a service that holds the business logic, and a security rule written once per
table instead of once per handler.

Everything here is v5. The v4 pattern this document used to teach, `service.use(req.db)` with a
TypeORM repository, is gone: `req.db`, `global.connection` and `global.repository` do not exist,
and the pieces that replace them are described below. The canonical listing lives in `llms.txt`
Part 5; where this guide and the source disagree, the source wins.

## The layers

1. **Routes** declare the endpoint: method, path, schemas, roles or capability, and which plane
   the route acts on (`scope: 'control'` for the platform, nothing for a tenant).
2. **Controllers** stay thin. They read the request, call a service, and shape the response.
3. **Services** hold the logic. They never see `req` or `reply`: they take a `UserContext` and
   plain data, and they are bound to the container the request works on.
4. **The data layer** is Drizzle, reached through `@volcanicminds/backend/db`.

The split is not decoration. A service that cannot see the request is a service that can be
called from a migration script, a scheduled job or a test without inventing a fake one.

## What a service is bound to

In v4 a service was bound to an `EntityManager`, and a service used without one fell back to
`global.connection`. In v5 it is bound to a **container**, and there is nothing to fall back to:
a service used without a handle throws, immediately and by name.

That difference is the whole design. A fallback means that forgetting to bind is not an error, it
is a query against the wrong database that returns rows and looks fine.

```typescript
// src/services/base.service.ts
import { and, eq, inArray, isNull, type SQL, type Table } from 'drizzle-orm'
import type { DataHandle } from '@volcanicminds/backend'
import { access, executeCount, executeFind, type QueryOptions } from '@volcanicminds/backend/db'
import { tablesFor, type AppTables } from '../tables/index.js'
import type { UserContext } from '../../types/index.js'

export abstract class BaseService<K extends keyof AppTables> {
  protected handle?: DataHandle

  /** Never returned, and never filterable either: filtering a hash is an oracle. */
  protected sensitiveFields: string[] = []

  constructor(protected readonly tableName: K) {}

  /** Bind to the container this request works on. Returns a scoped clone, so the singleton
   *  service is never mutated by a request. */
  on(handle?: DataHandle): this {
    const scoped = Object.create(this) as this
    scoped.handle = handle
    return scoped
  }

  protected get bound() {
    if (!this.handle) {
      throw new Error(`[${this.constructor.name}] used without a container. Call service.on(dataContext(req)).`)
    }
    const { db, dialect } = access(this.handle, this.constructor.name)
    return {
      db,
      table: tablesFor(this.handle)[this.tableName] as unknown as Table,
      options: { dialect, sensitiveFields: this.sensitiveFields } as QueryOptions
    }
  }

  /**
   * Row-level security. Whatever this returns is AND-ed AFTER everything the URL asked for,
   * `_logic` included, so no filter a caller writes reaches around it.
   */
  protected applyPermissions(_ctx: UserContext, _table: any): SQL | undefined {
    return undefined
  }

  protected alive(table: any): SQL | undefined {
    return table.deletedAt ? isNull(table.deletedAt) : undefined
  }

  async findAll(ctx: UserContext, params: Record<string, unknown> = {}) {
    const { db, table, options } = this.bound
    const restriction = and(...([this.alive(table), this.applyPermissions(ctx, table)].filter(Boolean) as SQL[]))
    return executeFind<any>({ db }, table, params, { ...options, extraWhere: restriction })
  }

  async count(ctx: UserContext, params: Record<string, unknown> = {}) {
    const { db, table, options } = this.bound
    const restriction = and(...([this.alive(table), this.applyPermissions(ctx, table)].filter(Boolean) as SQL[]))
    return executeCount({ db }, table, params, { ...options, extraWhere: restriction })
  }

  async findOne(ctx: UserContext, id: string) {
    const { db, table } = this.bound
    const t = table as any
    const where = and(...([eq(t.id, id), this.alive(t), this.applyPermissions(ctx, t)].filter(Boolean) as SQL[]))
    const rows = await db.select().from(table).where(where).limit(1)
    return rows[0] ?? null
  }

  async create(_ctx: UserContext, data: Record<string, unknown>) {
    const { db, table } = this.bound
    const rows = await db.insert(table).values(this.writable(data)).returning()
    return rows[0] ?? null
  }

  async update(ctx: UserContext, id: string, data: Record<string, unknown>) {
    const { db, table } = this.bound
    const t = table as any
    const where = and(...([eq(t.id, id), this.alive(t), this.applyPermissions(ctx, t)].filter(Boolean) as SQL[]))
    const rows = await db
      .update(table)
      .set({ ...this.writable(data), updatedAt: new Date() })
      .where(where)
      .returning()
    return rows[0] ?? null
  }

  /** Soft delete: the row keeps its place and stops being read. */
  async remove(ctx: UserContext, id: string) {
    const updated = await this.update(ctx, id, { deletedAt: new Date() } as Record<string, unknown>)
    return { affected: updated ? 1 : 0 }
  }

  async removeMany(ctx: UserContext, ids: string[]) {
    if (!ids.length) return 0
    const { db, table } = this.bound
    const t = table as any
    const where = and(...([inArray(t.id, ids), this.alive(t), this.applyPermissions(ctx, t)].filter(Boolean) as SQL[]))
    const rows = await db
      .update(table)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(where)
      .returning()
    return rows.length
  }

  /**
   * The columns a caller may write, built FROM THE TABLE rather than from a denylist: a column
   * added tomorrow is writable only if it is in the table, and a key the caller invented is
   * dropped instead of reaching the database as an error nobody can read.
   */
  protected writable(data: Record<string, unknown>): Record<string, unknown> {
    const table = this.bound.table as unknown as Record<string, unknown>
    const reserved = new Set(['id', 'createdAt', 'updatedAt'])
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(data)) {
      if (!reserved.has(key) && key in table) out[key] = data[key]
    }
    return out
  }
}
```

## Row-level security, written once per table

`applyPermissions` is the pillar. Instead of an `if (role === 'admin')` repeated in every
controller, visibility is defined once per table and enforced by the query layer.

```typescript
// src/services/order.service.ts
import { and, eq, sql } from 'drizzle-orm'
import { BaseService } from './base.service.js'
import type { UserContext } from '../../types/index.js'

export class OrderService extends BaseService<'order'> {
  constructor() {
    super('order')
  }

  protected applyPermissions(ctx: UserContext, table: any) {
    // An admin gets no restriction. `undefined` means "add nothing", which is not the same as a
    // condition that is always true: the query stays as short as it should be.
    if (ctx.roles.includes('admin')) return undefined

    // A manager sees their company only, and a manager WITHOUT a company sees nothing. That is
    // written explicitly, because the dangerous default here is the one that returns everything.
    if (ctx.roles.includes('manager')) {
      if (!ctx.companyId) return sql`false`
      return eq(table.companyId, ctx.companyId)
    }

    // Default deny. An unknown role is not a role without restrictions.
    return sql`false`
  }
}

export const orderService = new OrderService()
```

Two properties are worth naming, because both failure modes are silent.

**The condition is returned, not applied.** It travels as `QueryOptions.extraWhere` and is AND-ed
after everything the URL asked for, `_logic` included, so no expression a client can write reaches
around it. The alternative, filtering the results after the query has run, cuts the page first and
filters second: short pages and a wrong total.

**Default deny is written, not assumed.** Every branch that cannot establish who the caller is
returns a false condition. The failure mode of the opposite choice is not an error; it is a
response containing rows the caller should never have seen, and nothing reports it.

## Relations and computed fields

There is no `addRelations` hook to override, because a join is not a property of a service. A
query that needs one writes it, and a route that lets a caller ask for one declares it in
`allowedRelations`. When a method needs its own join, it parses the caller's filters and then
builds its own query:

```typescript
export class ActivityService extends BaseService<'activity'> {
  async withHours(ctx: UserContext, params: Record<string, unknown> = {}) {
    const { db, table, options } = this.bound
    const { professional } = tablesFor(this.handle!)

    const parsed = parseQuery(table, params, { ...options, extraWhere: this.applyPermissions(ctx, table) })

    return db
      .select({
        activity: table,
        professional,
        doneHours: sql<number>`coalesce((select sum(t.log_time) from timesheet t where t.activity_id = ${(table as any).id}), 0)`
      })
      .from(table)
      .leftJoin(professional, eq((table as any).professionalId, professional.id))
      .where(parsed.where)
      .orderBy(...parsed.orderBy)
      .limit(parsed.limit)
      .offset(parsed.offset)
  }
}
```

The subquery is correlated and scalar, so it costs one pass and returns one number per row. A
`leftJoin` onto the same table plus a `GROUP BY` would multiply the rows first and then collapse
them, and every other column would have to be listed in the grouping.

## The thin controller

The controller is an adapter. It turns an HTTP request into arguments, and a result into a
response:

```typescript
// src/api/orders/controller/order.ts
import { dataContext, type FastifyReply, type FastifyRequest } from '@volcanicminds/backend'
import { orderService } from '../../../services/order.service.js'

export async function find(req: FastifyRequest, reply: FastifyReply) {
  const service = orderService.on(dataContext(req))
  const { headers, records } = await service.findAll(req.userContext, req.data())
  return reply.type('application/json').headers(headers).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const order = await orderService.on(dataContext(req)).findOne(req.userContext, id)
  // A row the caller may not see comes back as null, so "forbidden" and "not there" answer the
  // same way: a 404 that distinguishes them is an existence oracle.
  return order || reply.status(404).send()
}
```

`req.data()` merges the query string and the body, with the body winning. `dataContext(req)` picks
the container the route declared, and throws where there is none rather than quietly reading the
control plane.

## Transactions

A transaction comes from the handle, never from an ambient connection:

```typescript
const { transaction } = access(dataContext(req))

await transaction(async (tx) => {
  // every write in here is in the same container and the same transaction
})
```

## What changed from v4, and why it is not a rename

| v4 | v5 |
|---|---|
| `service.use(req.db)` | `service.on(dataContext(req))` |
| a service without a manager fell back to `global.connection` | a service without a handle throws |
| `applyPermissions` returned a `where` merged by the query builder | it returns a `SQL` condition carried as `extraWhere`, AND-ed last |
| the repository came from an `EntityManager` | the table is built for the locator the handle addresses |
| `global.repository.X`, forbidden at runtime by a Proxy | does not exist, so there is nothing to forbid |

The last row is the point. In v4 the forbidden path had to be guarded because it was still
reachable, and the Proxy that threw was a fence around a hole. In v5 there is no ambient container
to reach for, so the mistake is not available.

## What this buys

- **Security by construction.** A query that goes through the service cannot skip
  `applyPermissions`, and the condition it returns cannot be argued with from the URL.
- **One place per rule.** Visibility is written once per table, not once per handler.
- **Testability.** A service takes a context and data, so a test needs neither a request nor a
  reply, only a container.
- **Consistency.** Every list endpoint sorts, filters and paginates the same way, because they all
  go through the same query layer.

Porting steps from v4 are in `docs/MIGRATION_V4_V5.md`. The typing of the seams is in
`docs/TYPESCRIPT_GUIDE.md`.
