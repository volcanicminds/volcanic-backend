# TypeScript guide: extending the framework

`@volcanicminds/backend` is written in TypeScript, and a consuming project is expected to be too.
This guide covers the three places where a project meets the framework's types: what it adds to
the request, how it names the container a request works on, and what its `tsconfig.json` has to
agree with.

Everything here is v5. Where v4 spellings appear they are marked as such, and none of them
compiles any more: `req.db`, `global.connection`, `global.entity` and `global.repository` were
removed rather than deprecated, so the compiler answers before the first request does.

## 1. Declaration merging (`types/index.d.ts`)

The framework already declares its own globals, so a project never redeclares `log`, `server`,
`config`, `roles` or `routes`. What a project does declare is what it adds: the properties it
hangs on the request, and the shape of its own context.

```typescript
import type { DataHandle } from '@volcanicminds/backend'

declare module 'fastify' {
  export interface FastifyRequest {
    // Whatever a preHandler computes once and every service reads afterwards.
    userContext: UserContext
  }
}

export interface UserContext {
  userId: string | null
  roles: string[]
  /** Which plane the request is on. Useful in rules that differ between them, and in logs. */
  container: 'control' | 'tenant'
  // Whatever else the domain needs, read from the row and never from what the caller sent.
  companyId?: string
  professionalId?: string
}

export {}
```

Two things are deliberately absent. There is no `var entity` and no `var connection`, because in
v5 there is no ambient database to reach: a request receives its container, and a module that
wants one asks for it. And there is no `var repository`, because the accessor that had to be
guarded at runtime in v4 simply does not exist here, so there is nothing left to forbid.

Make sure `tsconfig.json` picks the file up, through `include` or `typeRoots`.

## 2. The handles, and why typing them `any` is not a shortcut

A route receives one of two containers, and the framework brands them:

| Type | What it addresses |
|---|---|
| `ControlHandle` | the control plane: the tenant registry, the platform's own identities |
| `TenantHandle` | one customer's container |
| `DataHandle` | either of the two, when a piece of code genuinely works on both |

All three are exported from `@volcanicminds/backend`:

```typescript
import type { ControlHandle, TenantHandle, DataHandle } from '@volcanicminds/backend'
```

A service layer typed with `any` compiles exactly the same, and that is the problem: with `any`
the control plane and a customer's container are interchangeable, which is the one confusion the
two brands exist to prevent. The compiler is the cheapest place to catch a query that was written
for a tenant and handed the registry.

To get the handle of the current request, call `dataContext(req)` rather than writing the choice
by hand:

```typescript
import { dataContext } from '@volcanicminds/backend'

const handle = dataContext(req) // DataHandle
```

The shortest hand-written version, `req.tenant ?? req.control`, looks equivalent and is not: in a
deployment with tenants, a request that lost its context would read the control plane instead of
failing. `dataContext` throws `NoDataContextError` there, and a consumer catching that error is
catching a framework bug, not a bad request.

## 3. Context injection (`preHandler`)

A hook computes the context once, so services never see `req`:

```typescript
import type { FastifyRequest, FastifyReply } from '@volcanicminds/backend'

export default async (req: FastifyRequest, _reply: FastifyReply) => {
  const user = req.user
  const roles = req.roles()

  req.userContext = {
    userId: user?.id ?? null,
    roles,
    container: req.tenant ? 'tenant' : 'control',
    companyId: user?.companyId,
    professionalId: user?.professionalId
  }
}
```

Everything in that object comes from the verified token or from a row the framework already
loaded. Nothing comes from the query string or the body: a context a caller can influence is not
a security context, it is a suggestion.

## 4. Typing a service bound to a container

A service is bound to a container and typed by the tables of that container. The full reference
implementation is in `llms.txt` Part 5 and in `docs/ADVANCED_ARCHITECTURE.md`; what matters for
typing is the seam:

```typescript
import type { DataHandle } from '@volcanicminds/backend'
import { access, type QueryOptions } from '@volcanicminds/backend/db'
import { tablesFor, type AppTables } from '../tables/index.js'

export abstract class BaseService<K extends keyof AppTables> {
  protected handle?: DataHandle

  constructor(protected readonly tableName: K) {}

  /** Returns a scoped clone bound to this request's container. */
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
    return { db, table: tablesFor(this.handle)[this.tableName], options: { dialect } as QueryOptions }
  }
}
```

`access(handle)` is what opens a handle: it returns `db`, `dialect`, `locator`, `execute` and
`transaction`. It is exported from the data layer subpath, `@volcanicminds/backend/db`, and it is
the only supported way in: without it the alternative was a cast, and a cast is how a typed seam
stops being one.

`tablesFor(handle)` builds the project's own tables **for the locator that handle addresses**. The
same service, the same code, a different container: that is the property the types are there to
keep.

## 5. The subpaths, and what each one is for

```typescript
import { preload, start, dataContext } from '@volcanicminds/backend'      // core: HTTP, auth, loader
import { start as startDataLayer, access } from '@volcanicminds/backend/db' // data layer: Drizzle
```

The core does not import the data layer, and the boundary is verified in CI. A project that
imports both is doing the wiring the framework expects; a framework module that did would be
rejected before it shipped.

## 6. `tsconfig.json`

The framework is ESM only and targets Node 24. A consumer agrees with it on four points:

```jsonc
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "strict": true
  }
}
```

- **`"type": "module"` in `package.json`.** The framework is ESM; removing it breaks the build.
- **Import with the `.js` extension, in `.ts` files too.** That is what `NodeNext` resolution
  means, and it is what the emitted code needs.
- **No decorator options.** `strictPropertyInitialization: false`, `emitDecoratorMetadata` and the
  rest were there for TypeORM entities. Drizzle tables are plain objects, so those flags are not
  merely unnecessary, they hide real errors.
- **Keep `types/index.d.ts` in `include`**, or the declaration merging above never happens and
  `req.userContext` reads as an error.

## 7. Spellings that no longer compile

| v4 | v5 |
|---|---|
| `req.db` | `req.control`, `req.tenant`, or `dataContext(req)` |
| `global.connection`, `global.entity`, `global.repository` | removed; a container is passed, never ambient |
| `service.use(req.db)` | `service.on(dataContext(req))` |
| `import … from '@volcanicminds/backend/typeorm'` | `import … from '@volcanicminds/backend/db'` |
| `tenantContext: false` on a route | `scope: 'control'` (the v4 spelling is refused at boot) |

The porting steps are in `docs/MIGRATION_V4_V5.md`. Where this guide and the source disagree, the
source wins.
