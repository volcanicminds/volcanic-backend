# Data Layer Magic: From URL to SQL

One of the most powerful features of the `@volcanicminds/backend` + `@volcanicminds/typeorm` combination is the automatic translation of HTTP Query Strings into complex, optimized SQL queries.

This guide explains how to leverage this "magic" to build flexible APIs without writing boilerplate query parsing logic.

## The Flow

1.  **Request**: Client sends `GET /orders?status:eq=active&amount:gt=1000&sort=amount:desc`.
2.  **Normalization**: `req.data()` unifies query parameters and body payload.
3.  **Translation**: `executeFindQuery` (or `applyQuery`) translates parameters into TypeORM `FindManyOptions` with `Where`, `Order`, `Skip`, and `Take`.
4.  **Execution**: TypeORM executes optimized SQL against PostgreSQL (or MongoDB).

## 1. The `req.data()` Helper

In your controllers, always use `req.data()` instead of accessing `req.query` or `req.body` directly for data retrieval.

```typescript
// Inside a controller
const data = req.data()
// Returns a merged object of query string params and JSON body
```

This abstraction allows you to switch HTTP methods (e.g., from `GET` to `POST` for complex search queries) without changing the controller logic.

## 2. Using `executeFindQuery`

This function is the bridge between the raw data and the database.

```typescript
import { executeFindQuery } from '@volcanicminds/typeorm'

// In your Service or Controller
const { headers, records } = await executeFindQuery(
  repository.orders, // The TypeORM repository
  { client: true }, // Relations to eager load
  req.data() // The data from the request
)
```

It automatically handles:

- **Pagination**: `page`, `pageSize`.
- **Sorting**: `sort` (e.g., `sort=createdAt:desc`).
- **Filtering**: Field-based operators.

## 3. Filter Operators Syntax

You can filter any column (or related column) using a specific syntax in the key: `field:operator=value`.

| Operator   | SQL Equivalent             | Example URL                          |
| :--------- | :------------------------- | :----------------------------------- |
| `:eq`      | `=`                        | `status:eq=active`                   |
| `:neq`     | `!=`                       | `status:neq=draft`                   |
| `:gt`      | `>`                        | `price:gt=100`                       |
| `:ge`      | `>=`                       | `price:ge=100`                       |
| `:lt`      | `<`                        | `age:lt=18`                          |
| `:le`      | `<=`                       | `age:le=18`                          |
| `:like`    | `LIKE` (Case Sensitive)    | `code:like=ORD-%`                    |
| `:likei`   | `ILIKE` (Case Insensitive) | `name:likei=%john%`                  |
| `:in`      | `IN (...)`                 | `id:in=1,2,3`                        |
| `:nin`     | `NOT IN (...)`             | `role:nin=admin,root`                |
| `:null`    | `IS NULL`                  | `deletedAt:null=true`                |
| `:notNull` | `IS NOT NULL`              | `publishedAt:notNull=true`           |
| `:between` | `BETWEEN x AND y`          | `date:between=2024-01-01:2024-12-31` |

### Deep Filtering (Relations)

You can filter by related entities using dot notation.

- `client.name:containsi=acme` -> Joins `client` table and filters by name.
- **Note**: The relation must be joined in your Service via `addRelations` or passed to `executeFindQuery`.

## 4. Advanced Boolean Logic (`_logic`)

Standard query strings imply an `AND` between conditions. For complex logic involving `OR` and nested groups, use the reserved `_logic` parameter.

**Mechanism:**

1.  Define conditions with aliases: `field:operator[alias]=value`.
2.  Define logic string: `_logic=(alias1 OR alias2) AND alias3`.

**Example:**
Find orders that are either (Status is 'Pending' AND created in 2024) OR (Status is 'Urgent').

**URL:**

```
?status:eq[s1]=pending&createdAt:ge[d1]=2024-01-01&status:eq[s2]=urgent&_logic=(s1 AND d1) OR s2
```

## 5. SQL Views Support

Sometimes you need to aggregate data (e.g., Reporting) that cannot be easily represented by a standard Entity. You can use SQL Views.

1.  Define a `@ViewEntity` in TypeORM.
2.  Use `executeFindView` instead of `executeFindQuery`.

```typescript
import { executeFindView } from '@volcanicminds/typeorm'

// In your Service
async function findReports(data: any) {
  // executeFindView works on the EntityManager, not a specific repository
  const { headers, records } = await executeFindView(
    entity.PlanningView, // The View Entity class
    data
  )
  return { headers, records }
}
```

This allows you to apply pagination, sorting, and filtering (e.g., `_logic`) even on complex SQL Views.

## 6. Customizing the Query Builder

If the standard operators aren't enough, you can intercept the `QueryBuilder` in your `BaseService` extension:

```typescript
protected applyCustomFilters(qb: SelectQueryBuilder<T>, queryParams: any, alias: string): any {
  // Example: Handle a custom 'search' param that looks into multiple fields
  if (queryParams.search) {
    qb.andWhere(new Brackets(sqb => {
      sqb.where(`${alias}.name ILIKE :q`, { q: `%${queryParams.search}%` })
         .orWhere(`${alias}.description ILIKE :q`, { q: `%${queryParams.search}%` });
    }));
    // Consume the param so executeFindQuery doesn't try to process it again
    delete queryParams.search;
  }
  return queryParams;
}
```
