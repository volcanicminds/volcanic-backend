# Configuration — Data layer (`@volcanicminds/backend/typeorm`)

> The data layer (Magic Query + multi-tenant) is included in `@volcanicminds/backend` and exposed
> as the subpath `@volcanicminds/backend/typeorm`. This page documents its configuration.

The data layer is configured through environment variables and initialization options passed to `start()`.

## Initialization Options

Pass an options object to `start()` to configure the connection and the data-layer features.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `sensitiveFields` | `string[]` | `['password', 'mfaSecret', 'resetPasswordToken', 'confirmationToken']` | Sensitive fields blocked from filtering. |
| `cacheTimeout` | `number` | `30000` | Global cache timeout in milliseconds. |
| `logging` | `boolean` | `true` | Enables global logging. |
| ... | | | All the other standard TypeORM initialization options. |

**Example:**

```typescript
import { start } from '@volcanicminds/backend/typeorm'

await start({
  type: 'postgres',
  sensitiveFields: ['password', 'secretKey', 'ssn'], // Overrides default blacklist
  cacheTimeout: 60000,
  logging: false
})
```

## Environment Variables

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | `string` | `127.0.0.1` / `5432` / `vminds` / `vminds` / `vminds` | Postgres connection (repo defaults). |
| `LOG_DB_LEVEL` | `string` | `'warn'` | Logging level: `trace`, `debug`, `info`, `warn`, `error`. Maps to TypeORM levels. |
| `LOG_COLORIZE` | `boolean` | `true` | Colorizes the console output. |
| `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` | `boolean` | `false` | Synchronizes the schema at startup. **Note:** ignored in multi-tenant mode. |
| `VOLCANIC_CUSTOM_QUERY_OPERATORS` | `boolean` | `false` | Enables custom operators such as `:raw`. ⚠️ **Dangerous**: may introduce SQL injection. Use with extreme caution. |

## Peer dependencies

The data layer requires these **optional peer dependencies** (install them in the consumer only if you use the `/typeorm` subpath):
`typeorm`, `bcrypt`, `pluralize`, `reflect-metadata`, `pg`.
