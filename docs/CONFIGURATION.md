# Configuration — Data layer (`@volcanicminds/backend/typeorm`)

> Il data layer (Magic Query + multi-tenant) è incluso in `@volcanicminds/backend` ed è esposto
> come subpath `@volcanicminds/backend/typeorm`. Questa pagina ne documenta la configurazione.

Il data layer si configura tramite variabili d'ambiente e opzioni di inizializzazione passate a `start()`.

## Initialization Options

Passa un oggetto opzioni a `start()` per configurare la connessione e le feature del data layer.

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `sensitiveFields` | `string[]` | `['password', 'mfaSecret', 'resetPasswordToken', 'confirmationToken']` | Campi sensibili bloccati dal filtering. |
| `cacheTimeout` | `number` | `30000` | Cache timeout globale in millisecondi. |
| `logging` | `boolean` | `true` | Abilita il logging globale. |
| ... | | | Tutte le altre opzioni standard di inizializzazione di TypeORM. |

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
| `DB_HOST` / `DB_PORT` / `DB_USERNAME` / `DB_PASSWORD` / `DB_NAME` | `string` | `127.0.0.1` / `5432` / `vminds` / `vminds` / `vminds` | Connessione Postgres (default del repo). |
| `LOG_DB_LEVEL` | `string` | `'warn'` | Livello di logging: `trace`, `debug`, `info`, `warn`, `error`. Mappa sui livelli TypeORM. |
| `LOG_COLORIZE` | `boolean` | `true` | Colorizza l'output console. |
| `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` | `boolean` | `false` | Sincronizza lo schema all'avvio. **Nota:** ignorato in modalità multi-tenant. |
| `VOLCANIC_CUSTOM_QUERY_OPERATORS` | `boolean` | `false` | Abilita operatori custom come `:raw`. ⚠️ **Pericoloso**: può introdurre SQL injection. Usare con estrema cautela. |

## Peer dependencies

Il data layer richiede queste **peer dependencies opzionali** (da installare nel consumer solo se si usa il subpath `/typeorm`):
`typeorm`, `bcrypt`, `pluralize`, `reflect-metadata`, `pg`.
