# Indice: The Volcanic Stack - Definitive Backend Guide

1.  **[Parte 1: Fondamenta e Infrastruttura](#parte-1-fondamenta-e-infrastruttura)**
    - **1.1 Introduzione e Filosofia dello Stack**
      - I Tre Pilastri (`backend`, `typeorm`, `tools`)
      - Principi Architetturali (Thin Controllers, Fat Services)
      - Il Pattern "Globals"
    - **1.2 Struttura del Progetto**
      - Anatomia delle Cartelle e Autodiscovery
    - **1.3 Bootstrapping (`index.ts`)**
      - Orchestrazione avvio DB e Server
    - **1.4 Configurazione Database (Production Grade)**
      - Naming Strategy Custom
      - Gestione SSL e Connection Pool (`pg` driver)
    - **1.5 Variabili d'Ambiente (Reference)**

2.  **[Parte 2: Deep Dive Data Modeling & Entities](#parte-2-deep-dive-data-modeling--entities)**
    - **2.1 Anatomia di un'Entità Volcanic**
      - Active Record (`BaseEntity`) e Decoratori
      - Accesso Globale (`global.entity`)
    - **2.2 Gestione Tipi ed Enum**
      - Enum TypeScript vs Enum Postgres
    - **2.3 Gestione Avanzata delle Relazioni**
      - One-to-One, Many-to-One, One-to-Many
      - Evitare Circular Dependencies (uso delle stringhe)
    - **2.4 Opzioni delle Relazioni: Performance Tuning**
      - Strategie `eager` vs `lazy`
      - Integrità referenziale (`onDelete: CASCADE`)
    - **2.5 Logica nelle Entità: Computed Fields & Hooks**
      - Campi virtuali e decoratore `@AfterLoad`
    - **2.6 Viste SQL e `@ViewEntity`**
      - Reportistica complessa e aggregazioni
    - **2.7 Best Practices di Modeling**

3.  **[Parte 3: Magic Queries & Data Access](#parte-3-magic-queries--data-access)**
    - **3.1 Translation Layer: URL to SQL**
      - Flusso di traduzione e utilizzo (`executeFindQuery`)
    - **3.2 Reference Operatori di Filtro**
      - Tabella completa (`:eq`, `:gt`, `:like`, `:in`, `:null`, ecc.)
    - **3.3 Deep Filtering (Filtri Relazionali)**
      - Dot Notation su relazioni (es. `client.name`)
    - **3.4 Advanced Boolean Logic (`_logic`)**
      - Costruzione query complesse `(A OR B) AND C`
    - **3.5 Paginazione e Ordinamento**
      - Parametri Input e Header di Risposta (`v-total`)
    - **3.6 Customizing QueryBuilder (Global Search)**

4.  **[Parte 4: API Layer (Routing & Controllers)](#parte-4-api-layer-routing--controllers)**
    - **4.1 Autodiscovery delle Rotte**
      - Regole di matching dei file
    - **4.2 Configurazione `routes.ts`**
      - Struttura e configurazione Swagger
    - **4.3 Controllers: Best Practices**
      - Normalizzazione Input (`req.data`) e Relazioni
      - Accesso al Contesto (`req.userContext`)
    - **4.4 Pattern di Implementazione: Dal Controller al Service**
      - Esempio pratico completo
    - **4.5 Middleware: Globali vs Locali**
      - Configurazione mista in `routes.ts`
    - **4.6 JSON Schemas & Validazione**

5.  **[Parte 5: Service Layer Architecture](#parte-5-service-layer-architecture)**
    - **5.1 Il Pattern `BaseService`**
      - Astrazione CRUD e Hook `use(req.db)`
    - **5.2 Security Context & RLS (Row Level Security)**
      - Implementazione di `applyPermissions`
    - **5.3 QueryBuilder Avanzato**
      - Join automatiche (`addRelations`) e campi calcolati
    - **5.4 Gestione delle Transazioni (Complex Writes)**
      - Uso di `QueryRunner` manuale
    - **5.5 Globals vs Dependency Injection**
      - Pattern Singleton e accesso ai Repository
    - **5.6 Caching**

6.  **[Parte 6: Autenticazione e Sicurezza](#parte-6-autenticazione-e-sicurezza)**
    - **6.1 Stack Auth & JWT Lifecycle**
      - Access Token, Refresh Token e Revoca (`externalId`)
      - Supporto Dual Mode (Bearer vs Cookie HttpOnly)

### 6.1.1 Configurazione Dual Mode

Il sistema supporta due modalità di autenticazione mutualmente esclusive, configurabili tramite la variabile d'ambiente `AUTH_MODE`.

1.  **Bearer Token Mode** (`AUTH_MODE=BEARER`): Comportamento standard. Il token viene restituito nel body del login e deve essere inviato nell'header `Authorization: Bearer <token>`. Ideale per App Mobile e S2S.
2.  **Cookie Mode** (`AUTH_MODE=COOKIE`): Comportamento sicuro per browser. Il token viene settato in un cookie `HttpOnly`, `Secure`, `SameSite=Strict`. Il body del login non contiene il token. Il client non deve gestire manualmente il token. Richiede `COOKIE_SECRET` nel `.env`.
    - **Logout**: In modalità Cookie, la rotta `/auth/logout` cancella il cookie `auth_token`.

    - **6.2 Multi-Factor Authentication (MFA)**
      - Policy e Flusso "Gatekeeper" (Pre-Auth Token)
      - Adapter e Tools
    - **6.3 Role Based Access Control (RBAC)**
      - Definizione Ruoli e Gatekeeper sulle rotte
    - **6.4 Context Injection & TypeScript**
      - Estensione tipi e Hook `preHandler`
    - **6.5 Emergency Admin Reset**

3.  **[Parte 7: Validazione, Utilities, Scheduler e Testing](#parte-7-validazione-utilities-scheduler-e-testing)**
    - **7.1 Validazione JSON Schema e Schema Overriding**
      - Estensione schemi core (es. Login Response)
    - **7.2 Utilities Core (`@volcanicminds/tools`)**
      - Logging Strutturato (Pino) e Mailer
    - **7.3 Job Scheduler**
      - Configurazione Cron/Interval Jobs
    - **7.4 Audit Tracking (Tracciamento Modifiche)**
      - Configurazione automatica Change Data Capture
    - **7.5 Strategie di Testing**
      - Setup, E2E e Unit Test

4.  **[Parte 8: System Administration e Deployment](#parte-8-system-administration-e-deployment)**
    - **8.1 Hardening del Server (Ubuntu/Linux)**
      - Firewall UFW e Stack Base
    - **8.2 Nginx: Reverse Proxy & Security Gateway**
      - Rate Limiting, SSL, Header di Sicurezza
    - **8.3 Docker Deployment Strategy**
      - Configurazione Env Produzione e comandi Run
    - **8.4 Continuous Deployment ("Poor Man's CI/CD")**
      - Script di auto-update e Crontab
    - **8.5 Database Operations**
      - Estensioni, Wipe e Seeding sicuro
    - **8.6 Diagnostica e Monitoraggio**

5.  **[Parte 9: Integrazione GraphQL & Apollo](#parte-9-integrazione-graphql--apollo)**
    - **9.1 Attivazione e Configurazione**
    - **9.2 Autenticazione e UserContext**
      - Adattamento Context per GraphQL
    - **9.3 Schema First: TypeDefs e Resolvers**
      - Mapping Resolvers su Service esistenti
    - **9.4 Advanced Pattern: GraphQL to Magic Query Bridge**
    - **9.5 Performance: Il Problema N+1**
    - **9.6 Riassunto Integrazione**

6.  **[Parte 10: Pattern Avanzati e Troubleshooting](#parte-10-pattern-avanzati-e-troubleshooting)**
    - **10.1 Data Seeding & Maintenance**
      - Approccio API-driven (`src/api/tools`)
    - **10.2 Gestione Enum e Costanti**
      - Centralizzazione definizioni
    - **10.3 Troubleshooting: Errori Comuni e Soluzioni**
      - Circular Dependency, Relation Not Found, Access Denied
    - **10.4 Checklist per il Rilascio in Produzione**

# Parte 1: Fondamenta e Infrastruttura

Questa sezione copre le basi essenziali per comprendere come il framework orchestra il server, il database e le dipendenze globali. Non si tratta solo di avviare un processo Node.js, ma di predisporre un'architettura scalabile, sicura e fortemente tipizzata.

## 1.1 Introduzione e Filosofia dello Stack

Il framework è un sistema **opinionator** composto da tre pacchetti modulari che lavorano in sinergia per eliminare il _boilerplate code_.

### I Tre Pilastri

1.  **`@volcanicminds/backend` (Server Core)**
    - Wrapper di **Fastify**.
    - Gestisce il ciclo di vita HTTP, il caricamento automatico delle rotte (`Auto-Discovery`), la validazione degli Schema JSON e il sistema di Hook globali.
    - Integra nativamente il sistema di Autenticazione (JWT, Refresh Token) e Sicurezza (MFA Gatekeeper).
    - **Universal Database Context**: Inietta automaticamente un `EntityManager` strettamente scopato in `req.db` (Supporto Single & Multi-Tenant).
2.  **`@volcanicminds/typeorm` (Data Layer)**
    - Wrapper di **TypeORM**.
    - Introduce le **"Magic Queries"**: un motore di traduzione che converte automaticamente query string complesse (filtri, sort, paginazione, logica booleana) in SQL ottimizzato.
    - Gestisce la connessione al database e l'inizializzazione delle Entità.
3.  **`@volcanicminds/tools` (Utilities)**
    - Libreria di supporto _tree-shakeable_.
    - Fornisce strumenti standardizzati per Logger, Mailer e generazione codici MFA/OTP.

### Principi Architetturali

Ogni riga di codice nel progetto deve aderire a questi principi:

- **Thin Controllers ("Adattatori"):** I controller non contengono logica di business. Il loro unico compito è normalizzare l'input (`req.data()`), estrarre il contesto utente (`req.userContext`), chiamare un Service e restituire la risposta.
- **Fat Services ("Business Logic"):** Tutta la logica, le transazioni e i controlli di sicurezza sui dati risiedono qui. I Service non conoscono `req` o `res`.
- **Secure by Default:** L'accesso ai dati non è mai diretto. Passa sempre attraverso metodi che richiedono un `UserContext` per applicare filtri di sicurezza (Row Level Security).

### Il Pattern "Globals"

A differenza di architetture che usano Dependency Injection esplicita ovunque, il Volcanic Stack inietta alcune utility chiave nel `global scope` di Node.js durante il bootstrap. Questo riduce drasticamente gli import circolari e velocizza lo sviluppo.

- **`log`**: Istanza di Pino Logger. Disponibile ovunque.
- **`entity.[PascalCase]`**: Accesso diretto alla classe dell'Entità (es. `entity.User`). Utile per metodi statici come `.create()`.
- **`repository.[camelCasePlural]`**: Istanza del Repository TypeORM connesso (es. `repository.users`). Pluralizzato automaticamente.
- **`config`**: Configurazione caricata all'avvio.

---

## 1.2 Struttura del Progetto

Il framework utilizza un sistema di **autodiscovery** basato su pattern `glob`. Rispettare la struttura delle cartelle è obbligatorio affinché rotte, entità e configurazioni vengano caricate.

```bash
./
├── .env                    # Variabili d'ambiente (SEGRETI)
├── package.json            # type: "module" (ESM), engines: node >= 24
├── tsconfig.json           # target: "ES2022", module: "NodeNext"
├── index.ts                # Entry Point (Bootstrap)
├── types                   # Definizioni TypeScript custom
│   └── index.d.ts          # Estensione tipi globali (FastifyRequest, UserContext)
└── src
    ├── api                 # MODULI FUNZIONALI (Domain Driven)
    │   └── [domain_name]   # es. "orders", "users"
    │       ├── controller  # Logica di controllo (HTTP handling)
    │       │   └── [name].ts
    │       └── routes.ts   # Definizione endpoint, Swagger e Middleware
    ├── config              # CONFIGURAZIONI GLOBALI
    │   ├── database.ts     # Configurazione TypeORM e Pool
    │   ├── general.ts      # Configurazione Framework (MFA, Scheduler)
    │   ├── plugins.ts      # Plugin Fastify (CORS, Helmet, RateLimit)
    │   ├── roles.ts        # Definizione statica Ruoli RBAC
    │   └── tracking.ts     # Configurazione Audit Log automatico
    ├── entities            # MODELLI DATI (TypeORM .e.ts)
    ├── services            # BUSINESS LOGIC (Service Layer)
    ├── schemas             # JSON SCHEMAS (Validazione & Swagger Override)
    ├── hooks               # HOOKS GLOBALI (es. preHandler per UserContext)
    ├── schedules           # CRON JOBS (*.job.ts)
    └── utils               # Helper functions
```

---

## 1.3 Bootstrapping (`index.ts`)

Il file `index.ts` è il punto di ingresso. Orchestra l'avvio del database prima del server e inietta le dipendenze critiche per il funzionamento dell'auth integrata nel core.

```typescript
'use strict'

import { start as startServer, yn } from '@volcanicminds/backend'
import { start as startDatabase, userManager, DataSource } from '@volcanicminds/typeorm'
// Importiamo l'adapter MFA dai tools (implementazione concreta)
import { mfaAdapter } from './src/services/mfa.adapter.js'
// Importiamo la configurazione DB
import { database } from './src/config/database.js'

const start = async () => {
  let db: DataSource | null = null

  // 1. Avvio Database (Condizionale o Obbligatorio a seconda dell'ENV)
  if (yn(process.env.START_DB, true)) {
    const options = database?.default || {}
    // startDatabase inizializza TypeORM e popola global.repository / global.entity
    db = await startDatabase(options)

    if (db && log.i) {
      const opts = db.options as any
      log.info(`Database attached at ${opts.host}:${opts.port} (${opts.database})`)
    }
  } else {
    if (log.w) log.warn('Database not loaded, check START_DB property on environment')
  }

  // 2. Avvio Server
  // È CRUCIALE passare 'userManager' (da typeorm) e 'mfaManager' (adapter)
  // Questo permette al framework backend di gestire le rotte /auth/* (login, refresh, mfa)
  // usando la logica del tuo DB senza che il framework conosca le tue entità a priori.
  await startServer({
    userManager: userManager, // Gestisce CRUD utente e validazione password
    mfaManager: mfaAdapter // Gestisce generazione/verifica OTP
  })
}

start().catch((err) => {
  console.error('Fatal Error during startup:', err)
  process.exit(1)
})
```

---

## 1.4 Configurazione Database (Production Grade)

File di riferimento: `src/config/database.ts`.

Questa configurazione è ottimizzata per ambienti di produzione (PostgreSQL) e gestisce pooling, timeout e SSL condizionale.

### 1. Naming Strategy Custom

PostgreSQL usa `snake_case`, TypeScript usa `camelCase`. Questa strategia forza una conversione prevedibile.

```typescript
import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm'

class CustomNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  // Converte "firstName" in "first_name"
  columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    return embeddedPrefixes
      .concat(customName || propertyName)
      .map((s, i) => (i > 0 ? s.replace(/^(.)/, (c) => c.toUpperCase()) : s))
      .join('')
  }
}
```

### 2. Gestione SSL e Configurazione Completa

L'oggetto `extra` passa parametri diretti al driver `node-postgres` (`pg`), essenziali per stabilità di rete.

```typescript
import { Database } from '@volcanicminds/typeorm'
import { GLOBAL_CACHE_TTL } from './constants.js'
import fs from 'node:fs'

const isTrue = (val: string | undefined, defaultVal: boolean) => {
  if (val === undefined) return defaultVal
  return val === 'true' || val === '1'
}

// Logica per certificati SSL (es. per AWS RDS o OVH)
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

    // MAI usare synchronize: true in produzione (rischio perdita dati)
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

      // Network Stability (KeepAlive previene taglio connessioni idle da Load Balancer)
      keepAlive: isTrue(process.env.DB_KEEP_ALIVE, true),
      keepAliveInitialDelayMillis: 10000,

      // Safety Timeouts (prevenzione query zombie)
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT) || 60000,
      query_timeout: Number(process.env.DB_QUERY_TIMEOUT) || 65000
    },

    ssl: getSslConfig(),

    // Caching delle query su tabella DB dedicata
    cache: {
      type: 'database',
      tableName: 'query_result_cache',
      duration: GLOBAL_CACHE_TTL || 60000
    }
  }
}
```

---

## 1.5 Variabili d'Ambiente (Reference)

Un esempio di `.env` per produzione.

| Variabile                      | Descrizione                                                         | Richiesto | Default             |
| ------------------------------ | ------------------------------------------------------------------- | :-------: | ------------------- |
| `NODE_ENV`                     | Ambiente dell'applicazione.                                         |    No     | `development`       |
| `HOST`                         | Indirizzo host del server. Usa `0.0.0.0` per Docker.                |    No     | `0.0.0.0`           |
| `PORT`                         | Porta di ascolto del server.                                        |    No     | `2230`              |
| `JWT_SECRET`                   | Chiave segreta per firmare i JWT.                                   |  **Sì**   |                     |
| `JWT_EXPIRES_IN`               | Tempo di scadenza JWT (es. `5d`, `12h`).                            |    No     | `5d`                |
| `JWT_REFRESH`                  | Abilita refresh tokens.                                             |    No     | `true`              |
| `JWT_REFRESH_SECRET`           | Chiave segreta per firmare i refresh tokens.                        |  **Sì**¹  |                     |
| `JWT_REFRESH_EXPIRES_IN`       | Tempo di scadenza refresh tokens.                                   |    No     | `180d`              |
| `LOG_LEVEL`                    | Verbosità log (`trace`, `debug`, `info`, `warn`, `error`, `fatal`). |    No     | `info`              |
| `LOG_COLORIZE`                 | Abilita colori output log.                                          |    No     | `true`              |
| `LOG_TIMESTAMP`                | Abilita timestamp nei log.                                          |    No     | `true`              |
| `LOG_TIMESTAMP_READABLE`       | Usa formato timestamp leggibile.                                    |    No     | `true`              |
| `LOG_FASTIFY`                  | Abilita logger nativo Fastify.                                      |    No     | `false`             |
| `GRAPHQL`                      | Abilita Apollo Server per GraphQL.                                  |    No     | `false`             |
| `SWAGGER`                      | Abilita documentazione Swagger/OpenAPI.                             |    No     | `true`              |
| `SWAGGER_HOST`                 | URL base API per Swagger.                                           |    No     | `localhost:2230`    |
| `SWAGGER_TITLE`                | Titolo documentazione API.                                          |    No     | `API Documentation` |
| `SWAGGER_DESCRIPTION`          | Descrizione documentazione API.                                     |    No     |                     |
| `SWAGGER_VERSION`              | Versione API.                                                       |    No     | `0.1.0`             |
| `SWAGGER_PREFIX_URL`           | Path dove è disponibile Swagger UI.                                 |    No     | `/api-docs`         |
| `MFA_POLICY`                   | Policy Sicurezza MFA (`OPTIONAL`, `MANDATORY`, `ONE_WAY`)           |    No     | `OPTIONAL`          |
| `MFA_ADMIN_FORCED_RESET_EMAIL` | Email admin per reset MFA di emergenza                              |    No     |                     |
| `MFA_ADMIN_FORCED_RESET_UNTIL` | Data ISO fino alla quale il reset è attivo                          |    No     |                     |
| `HIDE_ERROR_DETAILS`           | Nasconde i dettagli (message) dell'errore nella risposta.           |    No     | `true` (prod)       |

¹ Richiesto se `JWT_REFRESH` è abilitato.

---

## 1.7 Architettura Single vs Multi-Tenant

Il framework supporta entrambe le architetture OOTB. Il comportamento è controllato da `req.db`.

- **Single-Tenant** (Default): `req.db` è iniettato dal connection pool globale. Zero overhead.
- **Multi-Tenant**: Se abilitato, `req.db` è iniettato da un `QueryRunner` dedicato che isola i dati (es. via `SET search_path`).

Per abilitare il multi-tenant, configura `src/config/general.ts`:

```typescript
export default {
  options: {
    multi_tenant: {
      enabled: true,
      resolver: 'header', // o 'subdomain', 'query'
      header_key: 'x-tenant-id'
    }
  }
}
```

Ecco un file di configurazione completo:

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
# Generare con: openssl rand -base64 64
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

## 1.6 Configurazione Plugin Fastify (Rate Limit, Raw Body)

È possibile abilitare e configurare plugin nativi di Fastify tramite il file `src/config/plugins.ts`.

### Raw Body

Utile per webhook (es. Stripe) che richiedono il payload grezzo per la validazione della firma.

```typescript
{
  name: 'rawBody',
  enable: true,
  options: {
    global: false, // Se true, aggiunge rawBody a tutte le richieste (memoria intensiva)
    runFirst: true // Esegue il parsing prima di altri hook
  }
}
```

Se `global: false`, puoi abilitarlo sulla singola rotta in `routes.ts`:

```typescript
config: {
  rawBody: true
}
```

### Rate Limit

Protegge l'API da abusi. Configurazione globale in `plugins.ts`:

```typescript
{
  name: 'rateLimit',
  enable: true,
  options: {
    global: true,
    max: 100,
    timeWindow: 60000 // 1 minuto
  }
}
```

È possibile sovrascrivere i limiti per singola rotta definendo l'oggetto `rateLimit` nella definizione della rotta.

---

# Parte 2: Deep Dive Data Modeling & Entities

In `@volcanicminds/typeorm`, il Data Layer non è un semplice mappatore di tabelle (ORM), ma il motore che abilita le funzionalità di "Magic Query" e "Auto-Discovery".

Le entità in questo stack seguono il pattern **Active Record** (estendendo `BaseEntity`), il che significa che l'entità stessa possiede metodi per il salvataggio e la ricerca (`User.save()`, `User.findOne()`).

## 2.1 Anatomia di un'Entità Volcanic

Ogni file di entità deve risiedere in `src/entities/` e avere l'estensione `.e.ts` (es. `user.e.ts`). Questo è fondamentale per il loader automatico.

### Struttura Base Standard

Ogni entità deve estendere `BaseEntity` e definire una Primary Key (preferibilmente UUID) e i campi di audit (`createdAt`, `updatedAt`).

**Esempio: `src/entities/client.e.ts`**

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

// Importiamo il tipo per la relazione (usando 'import type' per evitare cicli runtime)
import type { Order } from './order.e.js'

@Entity() // Nome tabella: 'client' (snake_case automatico)
@Unique(['code']) // Vincolo DB: il codice cliente deve essere univoco
export class Client extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  // INDEX: Fondamentale per le performance di ricerca e join
  @Index()
  @Column({ nullable: false, type: 'varchar' })
  code: string

  @Column({ nullable: false, type: 'varchar' })
  name: string

  // Array nativo di Postgres (molto performante per liste semplici)
  @Column('text', { array: true, default: [] })
  companies: string[]

  // Relazione OneToMany (Lazy di default in questo progetto)
  // Nota: Usiamo la stringa 'Order' per riferirci all'altra entità
  @OneToMany('Order', (order: Order) => order.client, { lazy: true })
  orders: Promise<Order[]>
}
```

### Accesso Globale (`global.entity`)

Al bootstrap, il framework popola l'oggetto globale `entity`.
Sebbene sia preferibile importare la classe per la Type Safety, `entity` è utile in script di seeding o contesti dinamici.

- `import { Client } from ...` -> Uso standard.
- `entity.Client` -> Istanza runtime caricata (utile in `src/utils/initialData.ts`).

---

## 2.2 Gestione Tipi ed Enum

In `volcanic-sample-backend`, gli Enum sono centralizzati in `src/entities/all.enums.ts`. Questo evita duplicazioni e magic strings.

**Esempio: Gestione Enum (`UserLanguage`)**

```typescript
// src/entities/all.enums.ts
export enum UserLanguage {
  EN = 'en',
  IT = 'it'
}
```

**Utilizzo nell'Entità (`src/entities/user.e.ts`)**

```typescript
@Column({
  type: 'enum', // Tipo nativo Postgres ENUM
  enum: UserLanguage,
  default: UserLanguage.EN,
  nullable: false
})
language: UserLanguage
```

> **Best Practice**: Se si prevede che i valori dell'enum cambino spesso, è meglio usare `type: 'varchar'` e gestire la validazione via codice/schema per evitare migrazioni DB complesse (DROP TYPE enum).

---

## 2.3 Gestione Avanzata delle Relazioni

La gestione delle relazioni è il punto dove si verificano più errori (Circular Dependency).
**Regola Aurea:** Usare sempre le **stringhe** (es. `'Order'`, `'Client'`) nei decoratori, mai la classe importata direttamente come valore.

### One-to-One (`User` <-> `Professional`)

Questa relazione è critica: collega l'account di accesso (`User`) al profilo anagrafico (`Professional`).

```typescript
// src/entities/user.e.ts (Lato Proprietario)
@Entity()
export class User extends UserEx {
  // ...

  // EAGER: TRUE -> Carica sempre il profilo quando leggo l'utente
  // NULLABLE: TRUE -> Un utente (es. admin puro) potrebbe non avere un profilo professionale
  @OneToOne('Professional', { eager: true, nullable: true })
  @JoinColumn() // Crea la colonna physical 'professionalId'
  professional: Professional
}

// src/entities/professional.e.ts (Lato Inverso)
@Entity()
export class Professional extends BaseEntity {
  // ...

  // Lato inverso per navigazione
  @OneToOne('User', (user: User) => user.professional, { lazy: true })
  user: Promise<User>
}
```

### Many-to-One / One-to-Many (`Order` <-> `WorkOrder`)

Gerarchia classica Padre-Figlio.

```typescript
// src/entities/workOrder.e.ts (Figlio)
@Entity()
export class WorkOrder extends BaseEntity {
  // ...

  // ManyToOne è il lato che possiede la Foreign Key ('orderId')
  // INDEX: Essenziale per filtrare work orders di un ordine
  @Index()
  @ManyToOne('Order', { eager: false, nullable: false })
  @JoinColumn()
  order: Order
}

// src/entities/order.e.ts (Padre)
@Entity()
export class Order extends BaseEntity {
  // ...

  // LAZY: TRUE -> Fondamentale per non scaricare migliaia di WO leggendo un Ordine
  @OneToMany('WorkOrder', (workOrder: WorkOrder) => workOrder.order, { lazy: true })
  workOrders: Promise<WorkOrder[]>
}
```

---

## 2.4 Opzioni delle Relazioni: Performance Tuning

Le opzioni passate ai decoratori determinano la strategia di caricamento e l'integrità referenziale.

### 1. `eager` vs `lazy`

- **`eager: true`**: TypeORM esegue una `LEFT JOIN` automatica.
  - _Dove usarlo:_ Relazioni 1:1 critiche (`User.professional`) o tabelle di lookup piccole (`Order.state`, `Order.type`).
  - _Dove evitarlo:_ Relazioni 1:N o entità pesanti.
- **`lazy: true`**: Restituisce una `Promise`. I dati vengono caricati solo se richiesti.
  - _Dove usarlo:_ Collezioni (`Client.orders`, `Order.workOrders`).

### 2. `onDelete: 'CASCADE'`

Definisce il comportamento del DB quando il record padre viene eliminato.

**Esempio: `src/entities/orderCommentRead.e.ts`**
Se un commento viene cancellato, le flag di "lettura" associate devono sparire automaticamente.

```typescript
@ManyToOne('OrderComment', (comment: OrderComment) => comment.reads, {
  nullable: false,
  onDelete: 'CASCADE' // DB Constraint: ON DELETE CASCADE
})
@JoinColumn()
comment: OrderComment
```

---

## 2.5 Logica nelle Entità: Computed Fields & Hooks

Le entità non sono solo contenitori di dati. Possono avere proprietà virtuali calcolate dopo il caricamento.

**Esempio Reale: `Activity.e.ts`**
Un'attività deve mostrare quante ore sono state lavorate (`doneHours`), ma questo dato è la somma dei `Timesheet`.

```typescript
import { AfterLoad, OneToMany } from 'typeorm'

@Entity()
export class Activity extends BaseEntity {
  @Column({ type: 'float' })
  expectedHours: number

  @OneToMany('Timesheet', (timesheet: Timesheet) => timesheet.activity)
  timesheets: Promise<Timesheet[]>

  // --- Virtual Properties (Non esistono nel DB) ---
  doneHours: number = 0
  deltaHours: number = 0
  remainingToWork: number = 0

  // Hook eseguito dopo find/findOne
  @AfterLoad()
  load() {
    // Caso 1: I timesheet sono stati caricati (join)
    if (Array.isArray(this.timesheets)) {
      const sheets = this.timesheets as unknown as { logTime: number }[]
      this.doneHours = sheets.reduce((acc, t) => acc + (Number(t.logTime) || 0), 0)
    }
    // Caso 2: 'doneHours' è stato popolato tramite addSelect() nel Service (pattern più comune per performance)

    // Calcolo delle derivate
    const expected = Number(this.expectedHours ?? 0)
    const done = Number(this.doneHours ?? 0)

    this.deltaHours = done - expected
    this.remainingToWork = expected - done
  }
}
```

---

## 2.6 Viste SQL e `@ViewEntity`

Per reportistica complessa, dashboard o aggregazioni che richiederebbero troppe join nel codice, si utilizzano le Viste. `@volcanicminds/typeorm` tratta le viste come entità in sola lettura, permettendo di usare filtri, paginazione e ordinamento standard.

**Esempio: `src/entities/planningView.e.ts`**
Questa vista aggrega dati da 8 tabelle diverse per fornire una "flat table" performante per il report di pianificazione.

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
      "pl"."month_1", "pl"."month_2" -- ... altri mesi
    FROM "activity" "ac"
    LEFT JOIN "planning" "pl" ON "ac"."id" = "pl"."activityId"
    LEFT JOIN "professional" "prof" ON "ac"."professionalId" = "prof"."id"
    LEFT JOIN "work_order" "wo" ON "ac"."workOrderId" = "wo"."id"
    LEFT JOIN "order" "o" ON "wo"."orderId" = "o"."id"
    LEFT JOIN "client" "cl" ON "o"."clientId" = "cl"."id"
  `
})
export class PlanningView {
  // Mappatura colonne vista -> proprietà classe
  @ViewColumn()
  activityId: string

  @ViewColumn()
  doneHours: number // Calcolato via SQL

  @ViewColumn()
  clientName: string

  // ... altri campi
}
```

Utilizzo nel Service (`PlanningService`):

```typescript
const { records } = await executeFindView(entity.PlanningView, req.data())
```

---

## 2.7 Best Practices di Modeling

1.  **UUID**: Usare sempre `id: uuid` come chiave primaria. Evita enumeration attacks e conflitti di merge.
2.  **Date UTC**: TypeORM e Postgres gestiscono le date. Assicurarsi che l'applicazione salvi in UTC.
3.  **Naming Relazioni**:
    - Lato singolo: `order` (oggetto), `orderId` (colonna fisica generata).
    - Lato collezione: `orders` (array).
4.  **Avoid Circular Imports**:
    - **Errato**: `import { Order } from './order.e.js'` usato dentro `@ManyToOne(() => Order)`
    - **Corretto**: `@ManyToOne('Order')` (stringa) + `import type { Order } ...` (solo tipo).

---

# Parte 3: Magic Queries & Data Access

In un'architettura backend tradizionale, lo sviluppatore spende il 30-40% del tempo a scrivere codice "boilerplate" per parsare filtri, gestire la paginazione e ordinare i risultati.

Il Volcanic Stack elimina questo strato. Il pacchetto `@volcanicminds/typeorm` fornisce un motore di traduzione che permette al client (Frontend o API Consumer) di definire esattamente quali dati vuole, come li vuole ordinati e filtrati, senza scrivere una riga di SQL o logica nel controller.

## 3.1 Translation Layer: URL to SQL

Il flusso di una richiesta di lettura (`find` o `count`) è il seguente:

1.  **Input**: Il client chiama `GET /orders?status:eq=active&amount:gt=100`.
2.  **Normalization**: Il controller usa `req.data()` per unificare query string e body.
3.  **Application**: Il Service (via `BaseService` o `executeFindQuery`) applica i permessi (RLS).
4.  **Translation**: Il motore analizza le chiavi dell'oggetto dati alla ricerca di **operatori suffissi** (es. `:eq`, `:gt`) e manipola il `QueryBuilder` di TypeORM.
5.  **Execution**: Viene generato ed eseguito l'SQL.

### Utilizzo nel Codice

Esistono due modi per invocare questo motore:

**Modo 1: Uso Diretto (per endpoint semplici)**

```typescript
import { executeFindQuery } from '@volcanicminds/typeorm'

// Controller
export async function find(req, reply) {
  // Traduce req.data() in SQL, esegue e formatta la risposta
  const { headers, records } = await executeFindQuery(
    repository.orders,
    { client: true }, // Relazioni
    req.data()
  )
  return reply.headers(headers).send(records)
}
```

**Modo 2: Via `BaseService` (Architettura Enterprise)**
In `volcanic-sample-backend`, la logica è incapsulata in `BaseService.findAll`. Questo permette di iniettare la sicurezza (`applyPermissions`) prima che i filtri magici vengano applicati.

```typescript
// Service
const { headers, records } = await orderService.findAll(req.userContext, req.data())
```

---

## 3.2 Reference Operatori di Filtro

Questa tabella è la "Stele di Rosetta" per il frontend developer. Ogni chiave nel payload JSON o nella Query String può avere un suffisso che determina l'operatore SQL.

**Sintassi:** `campo:operatore=valore`

### Operatori di Uguaglianza e Logici Base

| Operatore     | Tipo    | SQL                       | Descrizione                                                      |
| :------------ | :------ | :------------------------ | :--------------------------------------------------------------- |
| **(nessuno)** | Any     | `=`                       | Uguaglianza implicita. `status=active` → `status = 'active'`     |
| `:eq`         | Any     | `=`                       | Uguaglianza esplicita. `id:eq=123`                               |
| `:neq`        | Any     | `!=`                      | Diverso da. `type:neq=guest`                                     |
| `:null`       | Boolean | `IS NULL` / `IS NOT NULL` | `deleted:null=true` (è null) / `deleted:null=false` (non è null) |
| `:notNull`    | Boolean | `IS NOT NULL`             | `code:notNull=true` (alias di leggibilità)                       |

### Operatori Numerici e Date

| Operatore  | Tipo        | SQL       | Descrizione                                                                       |
| :--------- | :---------- | :-------- | :-------------------------------------------------------------------------------- |
| `:gt`      | Number/Date | `>`       | Greater Than. `price:gt=100`                                                      |
| `:ge`      | Number/Date | `>=`      | Greater or Equal. `created:ge=2024-01-01`                                         |
| `:lt`      | Number/Date | `<`       | Less Than. `qty:lt=10`                                                            |
| `:le`      | Number/Date | `<=`      | Less or Equal. `qty:le=10`                                                        |
| `:between` | String      | `BETWEEN` | Range inclusivo. Sintassi `min:max`. <br>Es: `date:between=2024-01-01:2024-01-31` |

### Operatori Stringa (Pattern Matching)

> **Nota:** Gli operatori che finiscono con `i` (es. `:likei`) sono **Case Insensitive** (usano `ILIKE` in Postgres).

| Operatore                    | SQL              | Descrizione                                                                                |
| :--------------------------- | :--------------- | :----------------------------------------------------------------------------------------- |
| `:like` / `:likei`           | `LIKE` / `ILIKE` | Pattern manuale. Richiede caratteri jolly `%`. <br>Es: `code:like=A-%`                     |
| `:contains` / `:containsi`   | `LIKE` / `ILIKE` | Contiene. Aggiunge `%` automaticamente ai lati. <br>Es: `name:containsi=rossi` → `%rossi%` |
| `:ncontains` / `:ncontainsi` | `NOT LIKE`       | Non contiene. <br>Es: `tag:ncontainsi=deprecated`                                          |
| `:starts` / `:startsi`       | `LIKE`           | Inizia con. Aggiunge `%` alla fine. <br>Es: `sku:starts=ABC` → `ABC%`                      |
| `:ends` / `:endsi`           | `LIKE`           | Finisce con. Aggiunge `%` all'inizio. <br>Es: `file:ends=.pdf` → `%.pdf`                   |

### Operatori di Lista (Array)

| Operatore | SQL            | Descrizione                                                                                            |
| :-------- | :------------- | :----------------------------------------------------------------------------------------------------- |
| `:in`     | `IN (...)`     | Incluso nella lista. <br>URL: `status:in=open,pending` (CSV)<br>Body: `status:in: ["open", "pending"]` |
| `:nin`    | `NOT IN (...)` | Escluso dalla lista. `role:nin=admin,root`                                                             |

---

## 3.3 Deep Filtering (Filtri Relazionali)

TypeORM permette di filtrare basandosi sulle colonne delle tabelle unite (Join). Il framework espone questa capacità tramite la **Dot Notation**.

**Requisito:** La relazione deve essere stata caricata nel Service tramite `addRelations` (o `executeFindQuery`).

### Esempi

1.  **Filtrare Ordini per nome Cliente:**
    - Query: `GET /orders?client.name:containsi=Acme`
    - Prerequisito nel Service: `qb.leftJoinAndSelect('order.client', 'client')` (l'alias 'client' deve coincidere con la prima parte del filtro).
    - SQL Generato: `... AND client.name ILIKE '%Acme%'`

2.  **Filtrare Attività per Azienda del Professionista:**
    - Query: `GET /activities?professional.company:eq=volcanicminds`
    - Struttura: `Activity` -> `Professional` -> `company`.

3.  **Ordinamento Relazionale:**
    - Query: `GET /orders?sort=client.name:asc` (Ordina gli ordini alfabeticamente per cliente).

> **Attenzione:** Se si tenta di filtrare su una relazione non caricata (non joinata), la query SQL fallirà con un errore "missing FROM-clause entry for table".

---

## 3.4 Advanced Boolean Logic (`_logic`)

Di default, tutti i parametri nella query string sono combinati in **AND**.
`?status=active&type=vip` → `WHERE status='active' AND type='vip'`.

Per scenari complessi (OR, gruppi annidati), si usa il parametro speciale `_logic` combinato con gli **Alias di Filtro**.

### Sintassi

1.  **Definizione Filtri con Alias:** Aggiungere `[alias]` alla fine della chiave del filtro.
    - Sintassi: `chiave:operatore[alias]=valore`
2.  **Composizione Logica:** Definire la stringa booleana in `_logic` usando gli alias.

### Esempio Reale: Dashboard "Alerts"

Vogliamo trovare gli Ordini che sono:

1.  **Urgenti** (priority > 8)
2.  **OPPURE** (**In Ritardo** E **Non Chiusi**)

**Costruzione Request:**

- Condizione Urgente: `priority:gt[urgent]=8`
- Condizione Ritardo: `dueDate:lt[late]=2025-01-01` (data passata)
- Condizione Non Chiuso: `status:neq[open]=closed`

**URL Finale:**

```
GET /orders?priority:gt[urgent]=8&dueDate:lt[late]=2025-01-01&status:neq[open]=closed&_logic=urgent OR (late AND open)
```

**SQL Resultante:**

```sql
WHERE (priority > 8) OR (due_date < '2025-01-01' AND status != 'closed')
```

---

## 3.5 Paginazione e Ordinamento

Gli standard per la paginazione sono rigidi per garantire la compatibilità con le tabelle frontend (es. React Table, AG Grid).

### Parametri di Input

- **`page`** (number, default: 1): Pagina richiesta (1-based).
- **`pageSize`** (number, default: 25): Righe per pagina.
- **`sort`** (string | array):
  - `campo` (ascendente)
  - `campo:asc`
  - `campo:desc`
  - Multiplo: `?sort=priority:desc&sort=createdAt:asc`

### Response Headers

Il payload JSON contiene solo l'array dei record (`data`). I metadati di paginazione sono negli **Header HTTP** per mantenere il payload pulito.

- `v-page`: Pagina corrente.
- `v-pageSize`: Dimensione pagina applicata.
- `v-count`: Numero record restituiti in questa request.
- **`v-total`**: Numero TOTALE di record nel DB che soddisfano i filtri (senza paginazione).
- `v-pageCount`: Numero totale di pagine.

---

## 3.6 Customizing QueryBuilder (Global Search)

A volte gli operatori standard non bastano. Il metodo `applyCustomFilters` nel `BaseService` permette di intercettare parametri speciali.

**Esempio: Implementazione "Global Search" (`q`)**

Se vogliamo un campo di ricerca unico che cerchi su Code, Name e Client Name.

```typescript
// src/services/order.service.ts

protected applyCustomFilters(qb: SelectQueryBuilder<Order>, params: any, alias: string): any {

  // Se c'è il parametro 'q', costruiamo una condizione OR complessa
  if (params.q) {
    const term = `%${params.q}%`;

    qb.andWhere(new Brackets(sqb => {
      sqb.where(`${alias}.code ILIKE :term`, { term })
         .orWhere(`${alias}.name ILIKE :term`, { term })
         // Nota: richiede che la relazione 'client' sia già joinata in addRelations
         .orWhere(`client.name ILIKE :term`, { term });
    }));

    // Rimuoviamo 'q' dai params per evitare che il parser standard cerchi una colonna 'q'
    delete params.q;
  }

  return params;
}
```

---

# Parte 4: API Layer (Routing & Controllers)

Il layer API è il punto di ingresso dell'applicazione. La sua responsabilità è strettamente limitata a:

1.  **Ricevere** la richiesta HTTP.
2.  **Validare** l'input (tramite JSON Schema).
3.  **Verificare** l'autorizzazione (tramite Middleware/Ruoli).
4.  **Delegare** l'elaborazione al Service Layer.
5.  **Rispondere** al client.

## 4.1 Autodiscovery delle Rotte

Il framework utilizza un **Loader automatico** (`lib/loader/router.ts`) che scansiona la cartella `src/api` all'avvio del server. Non esiste un file centrale `app.ts` dove si registrano le rotte manualmente.

### La Regola del Matching

Il loader cerca file che corrispondono al pattern: `src/api/**/routes.ts`.
La struttura delle cartelle determina il prefisso dell'URL, a meno che non sia sovrascritto nella configurazione.

**Esempi di Mapping:**

| File Path                     | Configurazione | URL Risultante |
| :---------------------------- | :------------- | :------------- |
| `src/api/users/routes.ts`     | `path: '/'`    | `/users/`      |
| `src/api/users/routes.ts`     | `path: '/:id'` | `/users/:id`   |
| `src/api/orders/v2/routes.ts` | `path: '/'`    | `/orders/v2/`  |

---

## 4.2 Configurazione `routes.ts`

Ogni modulo funzionale (es. `orders`, `auth`) deve avere un file `routes.ts`. Questo file è la "Single Source of Truth" per il comportamento degli endpoint e per la generazione della documentazione Swagger/OpenAPI.

### Struttura del File

Ecco un esempio completo e commentato basato su `src/api/orders/routes.ts`:

```typescript
import { roles } from '../../config/roles.js' // Import dei ruoli definiti

export default {
  // 1. Configurazione Globale del Modulo
  config: {
    title: 'Orders API', // Nome del gruppo in Swagger
    description: 'Gestione degli ordini e delle commesse',
    controller: 'controller', // Sottocartella dove cercare i file handler (default: 'controller')
    tags: ['orders'], // Tag per raggruppamento Swagger
    enable: true // Switch per abilitare/disabilitare l'intero modulo
  },

  // 2. Definizione delle Rotte
  routes: [
    {
      method: 'GET', // Verbi: GET, POST, PUT, DELETE, PATCH
      path: '/:id', // Path relativo al modulo (diventa /orders/:id)

      // --- Security Layer ---
      // RBAC: Solo Admin e Manager possono chiamare questa rotta.
      // Se l'array è vuoto [], la rotta è pubblica (se non bloccata da middleware).
      roles: [roles.admin, roles.manager],

      // Middleware Chain: Eseguiti in ordine prima dell'handler.
      middlewares: ['global.isAuthenticated'],

      // --- Handler Mapping ---
      // Sintassi Magica: 'filename.functionName'
      // Il framework cercherà il file 'order.ts' nella cartella 'controller'
      // ed eseguirà la funzione esportata 'findOne'.
      handler: 'order.findOne',

      // --- Swagger & Validation ---
      config: {
        title: 'Find Order',
        description: 'Recupera il dettaglio di un ordine',

        // JSON Schema References (Validazione Automatica Fastify)
        // I nomi con # si riferiscono a schemi caricati globalmente in src/schemas
        params: { $ref: 'globalParamsSchema#' }, // Valida che :id sia presente
        response: {
          200: {
            description: 'Success',
            $ref: 'orderSchema#' // Serializza la risposta usando questo schema
          },
          404: { description: 'Order not found' }
        }
      }
    },

    // Esempio Rotta di Creazione
    {
      method: 'POST',
      path: '/',
      roles: [roles.admin],
      handler: 'order.create',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Create Order',
        // Validazione del Body
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

I controller in questo stack devono essere **Thin** (sottili). Non devono contenere query SQL, logica di business o chiamate a servizi esterni.

### La Firma Standard

Ogni handler è una funzione asincrona:

```typescript
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'

export async function myHandler(req: FastifyRequest, reply: FastifyReply) {
  // ...
}
```

### 1. Normalizzazione Input (`req.data()`)

Fastify separa `req.body` (POST/PUT) da `req.query` (GET).
Il framework fornisce l'helper `req.data()` che unifica entrambi in un unico oggetto, permettendo di scrivere codice agnostico rispetto al metodo HTTP.

```typescript
// Invece di: const data = req.body || req.query
const data = req.data()
```

### 2. Parametri di Percorso (`req.parameters()`)

Per accedere ai parametri URL (es. `/orders/:id`), usare l'helper:

```typescript
// Invece di: req.params
const { id } = req.parameters()
```

### 3. Accesso al Contesto (`req.userContext`)

Grazie all'hook globale `preHandler`, ogni richiesta autenticata possiede un contesto utente tipizzato. Questo oggetto è fondamentale per la **Row Level Security** nei Service.

```typescript
// Definito in types/index.d.ts
const ctx = req.userContext
// { userId: '...', role: 'manager', company: 'volcanicminds', ... }
```

### 4. Normalizzazione Relazioni (Pattern Id-to-Object)

Quando si crea o aggiorna un'entità con relazioni (es. assegnare un `Order` a un `Client`), il frontend invia l'ID come stringa. TypeORM preferisce un oggetto parziale per gestire la Foreign Key senza query extra.

**Best Practice nel Controller:**

```typescript
// Esempio da src/api/orders/controller/order.ts
export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const data = req.data()

  // Trasformazione: "client": "uuid-123" -> "client": { id: "uuid-123" }
  if (data.client && typeof data.client === 'string') {
    data.client = { id: data.client }
  }

  if (data.type && typeof data.type === 'string') {
    data.type = { code: data.type } // Se la PK è un codice
  }

  // Passaggio al Service
  return await orderService.update(req.userContext, id, data)
}
```

---

## 4.4 Pattern di Implementazione: Dal Controller al Service

Ecco un esempio completo di come implementare un endpoint complesso (es. `create`) rispettando l'architettura.

### Il Controller (`src/api/orders/controller/order.ts`)

```typescript
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { orderService } from '../../../services/order.service.js'

export async function create(req: FastifyRequest, reply: FastifyReply) {
  // 1. Estrazione Dati
  const { id: _ignore, ...payload } = req.data()

  // 2. Validazione Logica Rapida (opzionale se c'è JSON Schema)
  if (!payload.code) {
    return reply.status(400).send(new Error('Missing order code'))
  }

  // 3. Normalizzazione
  if (payload.client && typeof payload.client === 'string') payload.client = { id: payload.client }
  if (payload.category && typeof payload.category === 'string') payload.category = { code: payload.category }

  try {
    // 4. Delega al Service (Business Logic & Security)
    const result = await orderService.create(req.userContext, payload)

    // 5. Risposta
    // Se result è nullo o ci sono errori, il service avrà lanciato un'eccezione
    return reply.code(201).send(result)
  } catch (err) {
    // Gestione Errori Custom
    if (err.message.includes('Access denied')) {
      return reply.status(403).send({ message: err.message })
    }
    // Rilancia per l'handler globale (500)
    throw err
  }
}
```

### Il Service (`src/services/order.service.ts`)

Il service estende `BaseService` per ereditare il CRUD standard, ma può sovrascrivere metodi o aggiungerne di nuovi.

```typescript
// (Vedi Parte 5 per i dettagli completi sul Service Layer)
export class OrderService extends BaseService<Order> {
  // ...
  async create(ctx: UserContext, data: any) {
    // Security Check: Un Manager può creare ordini solo per la sua azienda
    if (ctx.role === 'manager') {
      data.company = ctx.company
    }

    // Validazione Business: Unicità Codice
    const exists = await this.repository.findOne({ where: { code: data.code } })
    if (exists) throw new Error('Order code already exists')

    // Persistenza
    const order = entity.Order.create(data)
    return await entity.Order.save(order)
  }
}
```

---

## 4.5 Middleware: Globali vs Locali

I middleware sono funzioni eseguite _prima_ dell'handler. In `@volcanicminds/backend`, la configurazione dei middleware avviene tramite stringhe nel file `routes.ts`.

### 1. Middleware Globali (`global.*`)

Se la stringa inizia con `global.`, il framework cerca il file in due posizioni:

1.  `src/middleware/` (Middleware custom dell'applicazione).
2.  `lib/middleware/` (Middleware nativi del framework, es. `isAuthenticated`).

**Middleware Nativi Comuni:**

- `global.isAuthenticated`: Verifica JWT, scadenza, e inietta `req.user`.
- `global.isAdmin`: Verifica se l'utente ha ruolo admin (shortcut).

### 2. Middleware Locali

Se la stringa non ha prefissi, il framework cerca nella cartella `middleware` _relativa_ al file `routes.ts`. Utile per logiche specifiche di un modulo.

**Esempio Configurazione Mista:**

```typescript
// src/api/special/routes.ts
routes: [
  {
    path: '/action',
    handler: 'special.action',
    middlewares: [
      'global.isAuthenticated', // Globale: check token
      'checkBusinessHours' // Locale: src/api/special/middleware/checkBusinessHours.ts
    ]
  }
]
```

---

## 4.6 JSON Schemas & Validazione

Fastify usa JSON Schema per validare input e serializzare output. Questo offre prestazioni elevatissime e documentazione automatica.

### Definizione (`src/schemas/*.ts`)

Ogni schema deve avere un `$id` univoco.

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
  additionalProperties: false // Best Practice: Rifiuta campi sconosciuti
}
```

### Registrazione

Il framework carica automaticamente tutti i file in `src/schemas`.
In `routes.ts`, si fa riferimento allo schema usando `$ref: 'ID_SCHEMA#'`.

**Nota su `#`**: Il carattere `#` alla fine del `$ref` è obbligatorio nella sintassi Fastify per indicare la root dello schema referenziato.

### Schema Overriding

Se si definisce uno schema con lo stesso `$id` di uno schema nativo del framework (es. `authLoginResponseSchema`), il loader effettuerà un **Deep Merge**. Questo permette di aggiungere campi custom (es. `companyId` nel login) senza forkare la libreria.

---

# Parte 5: Service Layer Architecture

Il Service Layer è dove risiede la "verità" dell'applicazione. Mentre i Controller si occupano di HTTP, i Service si occupano dei dati.

In questo stack, i Service devono rispettare tre regole fondamentali:

1.  **Agnostici**: Non conoscono `req` o `res`. Accettano `UserContext` e DTO/Oggetti.
2.  **Sicuri**: Devono filtrare i dati in base all'utente _prima_ di restituirli (Row Level Security).
3.  **Singleton**: Vengono istanziati una volta e esportati per l'uso in tutta l'app.

---

## 5.1 Il Pattern `BaseService`

Per evitare di riscrivere infinite volte la logica di ricerca, paginazione e filtro, tutti i service CRUD estendono una classe astratta `BaseService`. Questa classe funge da wrapper intelligente intorno al `Repository` di TypeORM.

### Implementazione della Classe Astratta (`src/services/base.service.ts`)

Ecco la struttura di riferimento implementata in `volcanic-sample-backend`. Nota come integra le "Magic Queries" viste nella Parte 3.

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
   * Metodo obbligatorio. Definisce le regole "Chi può vedere cosa".
   * Viene applicato automaticamente a findAll, findOne, count.
   */
  protected abstract applyPermissions(qb: SelectQueryBuilder<T>, ctx: UserContext, alias: string): SelectQueryBuilder<T>

  /**
   * RELATIONS HOOK
   * Definisce quali relazioni caricare di default (Eager Loading controllato).
   */
  protected addRelations(qb: SelectQueryBuilder<T>, _alias: string): SelectQueryBuilder<T> {
    return qb
  }

  /**
   * CUSTOM FILTERS HOOK
   * Permette di gestire parametri che non sono colonne DB (es. 'q' search).
   */
  protected applyCustomFilters(qb: SelectQueryBuilder<T>, queryParams: any, _alias: string): any {
    return queryParams
  }

  protected createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    return this.repository.createQueryBuilder(alias)
  }

  // --- Metodi CRUD Standard ---

  async findAll(ctx: UserContext, queryParams: any = {}): Promise<{ headers: any; records: T[] }> {
    const alias = this.repository.metadata.tableName
    let qb = this.createQueryBuilder(alias)

    // 1. Setup Query Base
    qb = this.addRelations(qb, alias)
    qb = this.applyPermissions(qb, ctx, alias)

    // 2. Custom Filters (es. Global Search)
    const paramsToProcess = this.applyCustomFilters(qb, { ...queryParams }, alias)

    // 3. Magic Filters (Standard Volcanic: :eq, :gt, :like...)
    // Nota: applyStandardFilters è un helper interno che mappa params -> where
    this.applyStandardFilters(qb, paramsToProcess, alias)

    // 4. Caching
    if (this.cacheTTL > 0) qb.cache(this.cacheTTL)

    // 5. Paginazione & Sort
    if (paramsToProcess.page && paramsToProcess.pageSize) {
      const page = Math.max(1, parseInt(paramsToProcess.page))
      const pageSize = parseInt(paramsToProcess.pageSize) || 25
      qb.skip((page - 1) * pageSize).take(pageSize)
    }

    // ... gestione sort ...

    const [records, total] = await qb.getManyAndCount()

    // 6. Headers Paginazione
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

    // CRUCIALE: I permessi si applicano anche alla findOne!
    // Se l'ID esiste ma l'utente non ha diritti, ritorna null (simula 404).
    qb = this.applyPermissions(qb, ctx, alias)

    qb.andWhere(`${alias}.id = :id`, { id })

    if (this.cacheTTL > 0) qb.cache(this.cacheTTL)

    return qb.getOne()
  }

  // ... metodi interni privati (applyStandardFilters) ...
}
```

---

## 5.2 Security Context & RLS (Row Level Security)

L'implementazione di `applyPermissions` è il pilastro della sicurezza. Invece di scrivere `if (user.role === 'admin')` in ogni controller, definiamo le regole di visibilità una volta sola per entità.

Il `UserContext` (definito in `types/index.d.ts`) contiene:

- `role`: Ruolo applicativo (`admin`, `manager`, `user`).
- `company`: Tenant di appartenenza (es. `volcanicminds`).
- `professionalId`: ID del profilo professionale collegato.

### Esempio Complesso: `OrderService`

Regole di Business:

1.  **Admin**: Vede tutto.
2.  **Manager**: Vede solo gli ordini della sua azienda.
3.  **User**: Vede solo gli ordini su cui ha lavorato (verifica esistenza di un'attività nel work order).

```typescript
// src/services/order.service.ts
import { SelectQueryBuilder } from 'typeorm'
import { BaseService } from './base.service.js'
import { Order } from '../entities/order.e.js'
import { UserContext } from '../../types/index.js'

export class OrderService extends BaseService<Order> {
  constructor() {
    // repository.orders è globale, iniettato dal loader
    super(repository.orders)
  }

  protected applyPermissions(
    qb: SelectQueryBuilder<Order>,
    ctx: UserContext,
    alias: string
  ): SelectQueryBuilder<Order> {
    // 1. ADMIN: Bypass completo
    if (ctx.role === 'admin') {
      return qb
    }

    // 2. MANAGER: Tenant Isolation
    if (ctx.role === 'manager') {
      if (!ctx.company) {
        // Fail-safe: Manager senza company non vede nulla
        qb.andWhere('1=0')
        return qb
      }
      qb.andWhere(`${alias}.company = :company`, { company: ctx.company })
      return qb
    }

    // 3. USER: Association Check (Query complessa)
    if (ctx.role === 'user') {
      if (!ctx.professionalId || !ctx.company) {
        qb.andWhere('1=0')
        return qb
      }

      // Check 1: Tenant
      qb.andWhere(`${alias}.company = :company`, { company: ctx.company })

      // Check 2: Assegnazione (EXISTS subquery è più performante di JOIN per il filtro)
      qb.andWhere(
        (subQuery) => {
          const sub = subQuery
            .subQuery()
            .select('1')
            .from('work_order', 'wo')
            .innerJoin('activity', 'a', 'a.workOrderId = wo.id')
            .where(`wo.orderId = ${alias}.id`) // Correlazione con outer query
            .andWhere('a.professionalId = :pid')
            .getQuery()
          return `EXISTS ${sub}`
        },
        { pid: ctx.professionalId }
      )

      return qb
    }

    // Default Deny: Ruolo sconosciuto o public
    qb.andWhere('1=0')
    return qb
  }
}

export const orderService = new OrderService()
```

---

## 5.3 QueryBuilder Avanzato: Relazioni e Campi Calcolati

Il metodo `addRelations` serve a evitare il problema N+1 durante la serializzazione e a preparare il terreno per i filtri profondi.

### Esempio: `ActivityService` con Campi Calcolati

Un'attività deve riportare quante ore sono state lavorate (`doneHours`), che è la somma dei record nella tabella `Timesheet`.

```typescript
// src/services/activity.service.ts

export class ActivityService extends BaseService<Activity> {
  protected addRelations(qb: SelectQueryBuilder<Activity>, alias: string): SelectQueryBuilder<Activity> {
    // 1. Join Standard
    qb.leftJoinAndSelect(`${alias}.professional`, 'professional')
      .leftJoinAndSelect(`${alias}.workOrder`, 'workOrder')
      .leftJoinAndSelect('workOrder.order', 'order') // Join annidata

    // 2. Campo Calcolato (Virtual Column)
    // Questo aggiunge una colonna 'doneHours' al result set grezzo.
    // TypeORM la mapperà sulla proprietà 'doneHours' dell'entità se configurata correttamente
    // o dovremo farlo manualmente in un hook @AfterLoad o trasformazione.
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

### Gestione Filtri Custom (`applyCustomFilters`)

Se vogliamo implementare una **Global Search** che cerca su più campi contemporaneamente:

```typescript
protected applyCustomFilters(qb: SelectQueryBuilder<Order>, queryParams: any, alias: string): any {
  if (queryParams.q) {
    const term = `%${queryParams.q}%`

    qb.andWhere(new Brackets(sqb => {
      sqb.where(`${alias}.code ILIKE :term`, { term })
         .orWhere(`${alias}.name ILIKE :term`, { term })
         // Filtro su relazione joinata in addRelations
         .orWhere(`client.name ILIKE :term`, { term })
    }))

    // Rimuoviamo 'q' dai params per non confondere il parser standard
    delete queryParams.q
  }
  return queryParams
}
```

---

## 5.4 Gestione delle Transazioni (Complex Writes)

Il `BaseService` copre bene le letture e le scritture semplici (una sola tabella). Quando un'operazione coinvolge più entità (es. creare un Ordine + WorkOrders + Activities), dobbiamo gestire la transazione manualmente per garantire l'integrità dei dati (ACID).

**Pattern: `QueryRunner` manuale**

Esempio tratto da `src/services/fullOrder.service.ts`.

```typescript
import { connection } from '@volcanicminds/typeorm' // o global.connection

async createFull(ctx: UserContext, data: any) {
  const { workOrders, activities, ...orderData } = data

  // 1. Inizializza Transazione
  const queryRunner = connection.createQueryRunner()
  await queryRunner.connect()
  await queryRunner.startTransaction()

  try {
    // 2. Operazioni atomiche usando il manager della transazione
    // IMPORTANTE: usare queryRunner.manager, NON global.repository o entity.save()

    // Step A: Salva Ordine
    const order = entity.Order.create(orderData)
    const savedOrder = await queryRunner.manager.save(order)

    // Step B: Salva WorkOrders
    for (const wo of workOrders) {
      wo.order = savedOrder.id
      const workOrder = entity.WorkOrder.create(wo)
      await queryRunner.manager.save(workOrder)
    }

    // 3. Commit se tutto ok
    await queryRunner.commitTransaction()
    return savedOrder

  } catch (err) {
    // 4. Rollback in caso di errore
    await queryRunner.rollbackTransaction()
    throw err
  } finally {
    // 5. Rilascio connessione al pool
    await queryRunner.release()
  }
}
```

---

## 5.5 Globals vs Dependency Injection

Come notato nella Parte 1, il framework inietta repository ed entità nel `global scope`.

### Accesso ai Dati

- **`repository.[nomePlurale]`**: Istanza del Repository.
  - Uso: `repository.orders.find(...)`
  - Corrisponde a: `DataSource.getRepository(Order)`
  - **Importante**: In applicazioni Multi-Tenant o transazioni, preferire l'uso di `req.db.getRepository(Order)` (tramite `service.use(req.db)`) per garantire l'uso della connessione isolata corretta.
- **`entity.[NomeClasse]`**: Classe Entità.
  - Uso: `entity.Order.create(...)`
  - Corrisponde a: `import { Order } from ...`

### Pattern Singleton

I Service stessi sono esportati come **Singleton**. Non si usa `new OrderService()` nei controller, ma si importa l'istanza.

```typescript
// In service.ts
export const orderService = new OrderService()

// In controller.ts
import { orderService } from '../../services/order.service.js'
```

---

## 5.6 Caching

Per entità "lente a cambiare" (es. `OrderType`, `OrderCategory`), possiamo abilitare la cache delle query per ridurre il carico sul DB.

```typescript
import { STATIC_CACHE_TTL } from '../config/constants.js'

export class OrderTypeService extends BaseService<OrderType> {
  constructor() {
    super(repository.ordertypes)
    // Abilita cache automatica per findAll e findOne
    this.cacheTTL = STATIC_CACHE_TTL // es. 15 minuti in ms
  }

  // ...
}
```

Quando `cacheTTL > 0`, TypeORM:

1.  Genera un hash della query SQL.
2.  Controlla se esiste nella tabella `query_result_cache` ed è valido.
3.  Se sì, restituisce il JSON salvato.
4.  Se no, esegue la query e salva il risultato.

**Attenzione**: L'invalidazione in TypeORM è manuale o a tempo. Usare solo per dati di configurazione o storici.

---

# Parte 6: Autenticazione e Sicurezza

Il framework non delega l'autenticazione a provider esterni (come Auth0 o Cognito) di default, ma fornisce un'implementazione "in-house" robusta e integrata nel ciclo di vita delle richieste.

I pilastri della sicurezza sono:

1.  **JWT Ibrido**: Token stateless per performance, ma con meccanismo di invalidazione server-side.
2.  **MFA Gatekeeper**: Un flusso di login a due stadi per l'autenticazione a due fattori.
3.  **Context Injection**: Trasformazione del token grezzo in un oggetto `UserContext` tipizzato per la business logic.

---

## 6.1 Stack Auth & JWT Lifecycle

L'autenticazione è gestita internamente da `@volcanicminds/backend`.

### Configurazione Ambiente (`.env`)

Le seguenti variabili sono obbligatorie per attivare la crittografia dei token.

```properties
# Secret per firmare i token di accesso (durata breve)
JWT_SECRET=super_long_random_string_at_least_64_bytes
JWT_EXPIRES_IN=15m  # Breve durata per sicurezza

# Refresh Token (durata lunga, per UX fluida)
JWT_REFRESH=true
JWT_REFRESH_SECRET=another_super_long_random_string_different_from_above
JWT_REFRESH_EXPIRES_IN=7d
```

### Il Pattern "External ID" (Token Revocation)

Il problema dei JWT standard è che non possono essere revocati prima della scadenza. Volcanic risolve questo problema disaccoppiando l'ID primario (`uuid`) dall'ID contenuto nel token.

1.  Ogni `User` ha un campo `externalId` (una stringa random o UUID).
2.  Il JWT contiene `{ sub: user.externalId }`, **non** l'ID primario del database.
3.  Al login/verifica, il sistema cerca l'utente tramite `externalId`.

**Come funziona l'invalidazione (Logout Globale / Cambio Password):**
Quando un utente cambia password o clicca "Logout da tutti i dispositivi", il sistema rigenera il suo `externalId` nel database.
_Risultato:_ Tutti i token (Access e Refresh) emessi precedentemente contengono il vecchio `externalId`, che non corrisponde più a nessun utente. Vengono rifiutati istantaneamente.

---

## 6.2 Multi-Factor Authentication (MFA)

Il framework implementa un sistema TOTP (Time-based One-Time Password) compatibile con Google Authenticator/Microsoft Authenticator.

### Policy di Sicurezza

Configurabile in `src/config/general.ts` (o via ENV `MFA_POLICY`):

- **`OPTIONAL`**: L'utente può abilitarlo dal profilo.
- **`MANDATORY`**: L'utente è forzato a configurarlo al prossimo login. Non può navigare senza.
- **`ONE_WAY`**: Una volta abilitato, l'utente non può disabilitarlo da solo (solo l'admin può).

### Il Flusso "Gatekeeper" (Two-Stage Login)

Per garantire sicurezza, il login non rilascia mai un token valido se l'MFA è pendente.

**Fase 1: Login Credentials**

- **Request**: `POST /auth/login` `{ email, password }`
- **Check**: Credenziali valide. MFA è attivo per l'utente.
- **Response**: `202 Accepted` (non 200).
- **Payload**:
  ```json
  {
    "mfaRequired": true,
    "mfaSetupRequired": false,
    "tempToken": "eyJ..." // Token temporaneo
  }
  ```
- **Sicurezza**: Il `tempToken` ha ruolo `pre-auth-mfa` e dura 5 minuti.

**Fase 2: The Guard (Middleware)**
Il middleware globale `hooks/onRequest.ts` ispeziona ogni richiesta. Se il token ha ruolo `pre-auth-mfa`, blocca l'accesso a tutte le rotte eccetto:

- `/auth/mfa/verify`
- `/auth/mfa/setup`
- `/auth/mfa/enable`

**Fase 3: Verifica TOTP**

- **Request**: `POST /auth/mfa/verify`
  - Header: `Authorization: Bearer <tempToken>`
  - Body: `{ token: "123456" }`
- **Response**: `200 OK` con i veri `token` e `refreshToken` (ruolo `user/admin`).

### Implementazione Adapter (`src/services/mfa.adapter.ts`)

Per funzionare, il backend deve sapere come generare/verificare i codici. In `volcanic-sample-backend`, questo è delegato a `@volcanicminds/tools`.

```typescript
import * as mfaTool from '@volcanicminds/tools/mfa'

export const mfaAdapter = {
  // Genera secret e QR Code
  async generateSetup(appName: string, email: string) {
    return await mfaTool.generateSetupDetails(appName, email)
  },

  // Verifica il codice 123456 contro il segreto
  verify(token: string, secret: string) {
    return mfaTool.verifyToken(token, secret)
  }
}
```

Questo adapter viene passato al server nel file di bootstrap `index.ts`.

---

## 6.3 Role Based Access Control (RBAC)

La gestione dei ruoli è statica ma applicata dinamicamente.

### 1. Definizione Ruoli (`src/config/roles.ts`)

```typescript
export default [
  {
    code: 'public', // Ruolo implicito per non autenticati
    name: 'Public',
    description: 'Utente non autenticato'
  },
  {
    code: 'admin',
    name: 'Admin',
    description: 'Super User'
  },
  {
    code: 'manager',
    name: 'Manager',
    description: 'Accesso limitato alla propria Company'
  },
  {
    code: 'user',
    name: 'User',
    description: 'Accesso limitato ai propri dati'
  }
]
```

### 2. Protezione delle Rotte (`routes.ts`)

```typescript
{
  method: 'DELETE',
  path: '/:id',
  handler: 'user.remove',
  // Gatekeeper: Solo Admin può chiamare questo endpoint.
  // Gli altri riceveranno 403 Forbidden automaticamente.
  roles: [roles.admin],
  middlewares: ['global.isAuthenticated']
}
```

---

## 6.4 Context Injection & TypeScript

Questa è la parte che collega l'autenticazione alla business logic. Una volta che l'utente è autenticato, dobbiamo trasformare il suo "User ID" in un contesto ricco di informazioni (`UserContext`) da passare ai Service.

### 1. Definizione dei Tipi (`types/index.d.ts`)

Estendiamo l'interfaccia `FastifyRequest` per includere `userContext`.

```typescript
import { FastifyRequest as _FastifyRequest } from 'fastify'

// Struttura del contesto applicativo
export interface UserContext {
  userId: string | null
  role: 'admin' | 'manager' | 'user' | 'public'

  // Campi specifici
  company?: string // Tenant (es. 'volcanicminds')
  professionalId?: string // ID del profilo professionale collegato
}

declare module 'fastify' {
  export interface FastifyRequest {
    userContext: UserContext
  }
}
```

### 2. Popolamento del Contesto (`src/hooks/preHandler.ts`)

Questo hook viene eseguito _dopo_ l'autenticazione JWT ma _prima_ del controller. È qui che avviene la logica di arricchimento.

```typescript
import { FastifyRequest, FastifyReply } from '@volcanicminds/backend'

export default async (req: FastifyRequest, _reply: FastifyReply) => {
  // req.user è popolato dal plugin @fastify/jwt (contiene l'entità User dal DB)
  const user = req.user as any
  const roles = user?.roles || []

  // Il profilo professionale è spesso caricato in eager load con l'User
  const professional = user?.professional

  const context: UserContext = {
    userId: user?.id || null,
    role: 'public',
    company: undefined,
    professionalId: professional?.id
  }

  if (user) {
    // Mapping dei ruoli DB -> Ruolo contesto principale
    if (roles.includes('admin')) {
      context.role = 'admin'
    } else if (roles.includes('manager')) {
      context.role = 'manager'
      context.company = professional?.company // Il manager è vincolato alla sua company
    } else {
      context.role = 'user'
      context.company = professional?.company
    }
  }

  // Iniezione nella richiesta
  req.userContext = context
}
```

### 3. Utilizzo nel Service

Grazie a questo setup, i service non devono preoccuparsi di _come_ è stato autenticato l'utente, ma solo di _chi_ è.

```typescript
// src/services/order.service.ts
async findAll(ctx: UserContext, params: any) {
    // TypeScript conosce la struttura di ctx grazie a index.d.ts
    if (ctx.role === 'manager') {
        // Applica filtro company
    }
}
```

---

## 6.5 Emergency Admin Reset (Backdoor Sicura)

In caso di perdita del dispositivo MFA da parte dell'amministratore, il framework offre una via di recupero basata sul filesystem/env, progettata per essere temporanea.

1.  L'accesso SSH al server è richiesto.
2.  Modificare `.env` o le variabili del container:
    - `MFA_ADMIN_FORCED_RESET_EMAIL=admin@test.volcanicminds.com`
    - `MFA_ADMIN_FORCED_RESET_UNTIL=2025-12-31T15:00:00.000Z` (Deve essere nel futuro prossimo, max 10 min dall'avvio).
3.  Riavviare il backend.
4.  All'avvio, `index.ts` del core rileva le variabili. Se il timestamp è valido, **disabilita l'MFA** e cancella i secret per quell'utente specifico.
5.  L'admin può loggarsi con solo password e riconfigurare l'MFA.
6.  **Cleanup**: Rimuovere le variabili e riavviare per chiudere la falla di sicurezza.

---

# Parte 7: Validazione, Utilities, Scheduler e Testing

Un backend enterprise non si limita a salvare dati nel DB. Deve garantire che i dati in ingresso siano validi, eseguire operazioni in background, tracciare chi ha modificato cosa e garantire stabilità tramite test automatizzati.

## 7.1 Validazione JSON Schema e Schema Overriding

Il framework utilizza **Fastify** per la validazione, basata su **JSON Schema** (draft-7). Questo approccio garantisce prestazioni elevatissime (grazie alla compilazione Just-In-Time degli schemi) e genera automaticamente la documentazione Swagger/OpenAPI.

### Definizione degli Schemi (`src/schemas/*.ts`)

Ogni file in questa cartella viene caricato automaticamente all'avvio. Ogni schema deve esportare un oggetto con un `$id` univoco.

**Esempio: Validazione Creazione Ordine (`src/schemas/order.ts`)**

```typescript
import { VALID_COMPANIES } from '../entities/all.enums.js'

export const orderBodySchema = {
  $id: 'orderBodySchema', // ID Univoco usato nei $ref
  type: 'object',
  nullable: true, // Il body può essere null (gestito dal controller)
  required: ['code', 'name', 'company'], // Campi obbligatori
  properties: {
    code: {
      type: 'string',
      minLength: 5,
      description: 'Codice univoco ordine (es. 2025_GER_CLI)'
    },
    name: { type: 'string' },
    year: { type: 'number', minimum: 2000, maximum: 2100 },

    // Validazione Enum (importati dalle entità per coerenza)
    company: {
      type: 'string',
      enum: VALID_COMPANIES
    },

    // Relazioni (si aspettano l'ID stringa dal frontend)
    client: { type: 'string', format: 'uuid' }
  },
  additionalProperties: false // Best Practice: Rifiuta campi non definiti per sicurezza
}
```

### Schema Overriding (Funzionalità Core)

`@volcanicminds/backend` fornisce schemi nativi per le funzioni core (es. Login, Registrazione). Spesso un'applicazione reale deve estendere questi schemi (es. aggiungere `company` e `firstName` alla risposta del login) senza modificare il codice della libreria.

Il loader implementa un **Deep Merge intelligente**: se uno schema locale ha lo stesso `$id` di uno schema core, le proprietà vengono fuse.

**Esempio Reale: Estensione Login Response (`src/schemas/user.ts`)**

```typescript
// src/schemas/user.ts

// 1. Definiamo lo schema del profilo professionale
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

// 2. Override dello schema di risposta Login (definito nel core lib/schemas/auth.ts)
export const authLoginResponseSchema = {
  $id: 'authLoginResponseSchema', // STESSO ID del core
  type: 'object',
  nullable: true,
  properties: {
    // Campi ereditati dal core (non serve ripeterli):
    // - token, refreshToken, username, email, id

    // Campi AGGIUNTI dall'applicazione:
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    company: { type: 'string' },

    // Riferimento a schema custom
    professional: {
      $ref: 'professionalSchema#'
    }
  }
}
```

Al runtime, la risposta `/auth/login` restituirà sia il token JWT che i dati del profilo professionale.

---

## 7.2 Utilities Core (`@volcanicminds/tools`)

Il framework espone utility globali per semplificare lo sviluppo.

### Logging Strutturato (Pino)

L'oggetto `log` è globale. È configurato per alte prestazioni: utilizza un meccanismo di "short-circuit" basato su getter booleani (`log.i`, `log.e`) per evitare di interpolare stringhe se il livello di log è disattivato.

**Best Practices:**

```typescript
// 1. Info: Operazioni di successo, avvio server
if (log.i) log.info(`Order ${orderId} created successfully`)

// 2. Warn: Situazioni anomale ma gestite (es. Login fallito, Risorsa non trovata)
if (log.w) log.warn(`User ${email} failed login attempt (IP: ${ip})`)

// 3. Error: Eccezioni, crash, fallimenti servizi esterni
// Passare sempre l'oggetto errore come primo argomento per lo stack trace
if (log.e) log.error({ err: errorObject }, 'Payment gateway unreachable')

// 4. Debug/Trace: Payload completi (solo in dev)
if (log.d) log.debug('Incoming payload:', JSON.stringify(data))
```

### Mailer

Il wrapper `Mailer` (da `@volcanicminds/tools`) gestisce l'invio email. In `volcanic-sample-backend`, la configurazione SMTP risiede in genere in un service dedicato o inizializzata all'uso.

```typescript
import { Mailer } from '@volcanicminds/tools/mailer'

const mailer = new Mailer({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  secure: false
})

// Genera automaticamente la versione text/plain dall'HTML
await mailer.send({
  to: 'client@example.com',
  subject: 'Conferma Ordine',
  html: '<p>Il tuo ordine <strong>#123</strong> è stato confermato.</p>'
})
```

---

## 7.3 Job Scheduler

Il framework integra un sistema di scheduling (basato su `toad-scheduler`) per eseguire task ricorrenti (es. reportistica, pulizia token).

### Configurazione

1.  Abilitare lo scheduler in `src/config/general.ts`:
    ```typescript
    export default {
      // ...
      options: {
        scheduler: true
      }
    }
    ```
2.  Creare i job in `src/schedules/*.job.ts`.

### Struttura di un Job

Ogni file `.job.ts` deve esportare una configurazione `schedule` e una funzione `job`.

**Esempio: Report Mensile Automatico**

```typescript
import { JobSchedule } from '@volcanicminds/backend'

export const schedule: JobSchedule = {
  active: true, // Switch ON/OFF
  async: true, // Il task è asincrono?
  preventOverrun: true, // Evita sovrapposizioni se il task precedente è lento

  // Tipo CRON (Consigliato per orari precisi)
  type: 'cron',
  cron: {
    expression: '0 2 1 * *', // Alle 02:00 del primo giorno di ogni mese
    timezone: 'Europe/Rome'
  }
}

export async function job() {
  log.info('Starting monthly report generation...')
  try {
    // Logica di business (es. chiamare un Service)
    // await reportingService.generateMonthlyStats()
    log.info('Monthly report generated.')
  } catch (err) {
    log.error({ err }, 'Failed to generate monthly report')
  }
}
```

---

## 7.4 Audit Tracking (Tracciamento Modifiche)

Volcanic include un sistema "magico" per tracciare le modifiche alle entità (Change Data Capture applicativo) senza sporcare i controller con logica di logging.

### Configurazione (`src/config/tracking.ts`)

Si definiscono quali rotte e quali entità monitorare.

```typescript
export default {
  config: {
    enableAll: false,
    changeEntity: 'Change', // Entità dove salvare i log (src/entities/change.ts)
    primaryKey: 'id'
  },
  changes: [
    {
      enable: true,
      method: 'PUT', // Traccia solo gli aggiornamenti
      path: '/orders/:id', // Rotta API corrispondente
      entity: 'Order', // Entità TypeORM da interrogare per lo stato "vecchio"

      // Filtri sui campi
      fields: {
        includes: ['status', 'amount', 'deliveryDate'], // Traccia solo questi
        excludes: ['updatedAt'] // Ignora timestamp tecnici
      }
    }
  ]
}
```

### Funzionamento Interno

1.  **Hook `preHandler`**: Se la rotta corrisponde a una regola di tracking, il framework legge lo stato attuale del record dal DB e lo salva in `req.trackingData`.
2.  **Controller**: Esegue l'aggiornamento.
3.  **Hook `preSerialization`**: Il framework confronta il payload di input (nuovi valori) con `req.trackingData` (vecchi valori).
4.  **DB Write**: Se ci sono differenze nei campi monitorati, crea un record nella tabella `change` con il delta JSON, l'ID utente e il timestamp.

---

## 7.5 Strategie di Testing

La suite di test utilizza `mocha` come runner, `expect` per le asserzioni e un wrapper personalizzato intorno ad `axios` per le chiamate HTTP simulate.

### Setup (`test/common/bootstrap.ts`)

Questo file avvia un'istanza del server (spesso con un DB in memoria o dedicato ai test) prima di eseguire la suite.

```typescript
import { start as startServer } from '@volcanicminds/backend'
import { userManager } from '@volcanicminds/typeorm'

// Hook globale Mocha
export const beforeAll = async () => {
  // Avvia il server su una porta di test (es. 2231)
  await startServer({ userManager })
}
```

### Test E2E (End-to-End)

I test E2E simulano un client reale che chiama le API. Risiedono in `test/e2e/`.

**Esempio: Test flusso Ordini**

```typescript
import { expect } from 'expect'
import { login, get, post } from '../common/api.js' // Helper wrapper di Axios

describe('Orders E2E', () => {
  let token = ''

  // 1. Setup: Ottieni Token Admin
  before(async () => {
    const auth = await login('admin@test.volcanicminds.com', 'password')
    token = auth.token
  })

  // 2. Test Creazione
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

  // 3. Test Lista con Filtri
  it('should find the created order via magic query', async () => {
    // Testiamo la traduzione URL -> SQL
    const { data, headers } = await get('/orders?code:eq=TEST_ORD_001')

    expect(data).toHaveLength(1)
    expect(data[0].name).toBe('Test Order')
    expect(headers['v-total']).toBe('1')
  })
})
```

### Test Unitari (`test/unit/`)

Testano la logica dei Service o delle Utility senza avviare l'intero server HTTP. Possono richiedere il mocking del Repository se non si vuole usare il DB reale.

```typescript
import { expect } from 'expect'
import { professionalService } from '../../src/services/professional.service.js'

describe('Professional Service', () => {
  it('should calculate counts correctly', async () => {
    // Nota: richiede DB connesso o Mock del repository
    const count = await professionalService.count({ role: 'admin' }, {})
    expect(typeof count).toBe('number')
  })
})
```

---

# Parte 8: System Administration e Deployment

Il deployment del Volcanic Stack è progettato per essere container-native. L'applicazione deve girare dietro un Reverse Proxy (Nginx) che gestisce la terminazione SSL e la sicurezza perimetrale, mentre il container Docker gestisce la logica applicativa isolata.

## 8.1 Hardening del Server (Ubuntu/Linux)

Prima di installare qualsiasi applicazione, il server host deve essere messo in sicurezza.

### 1. Configurazione Firewall (UFW)

Adottiamo una strategia "Deny by Default". Si aprono solo le porte strettamente necessarie.

```bash
# 1. Installa UFW se non presente
sudo apt update && sudo apt install ufw -y

# 2. Policy di base: Blocca tutto in ingresso, consenti tutto in uscita
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 3. CRUCIALE: Consenti SSH (altrimenti ti chiudi fuori dal server)
sudo ufw allow OpenSSH

# 4. Consenti traffico Web Standard (HTTP/HTTPS) gestito da Nginx
sudo ufw allow 'Nginx Full'

# 5. Attiva il firewall
sudo ufw enable
```

### 2. Installazione Stack Base

Installazione di Docker, Nginx e Certbot.

```bash
# Docker & Compose
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Nginx & Certbot
sudo apt install nginx certbot python3-certbot-nginx -y
```

---

## 8.2 Nginx: Reverse Proxy & Security Gateway

Nginx non serve solo a girare le richieste. Agisce come **WAF (Web Application Firewall)** di base, terminatore SSL e gestore del Rate Limiting per proteggere il processo Node.js (single-threaded).

### Configurazione (`/etc/nginx/sites-available/volcanic-sample-backend`)

```nginx
# --- 1. RATE LIMITING (Protezione DDoS/Bruteforce) ---
# Zona API: Max 10 richieste al secondo per IP.
# Protegge il backend da saturazione CPU per troppe richieste.
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

# Zona Connessioni: Protegge da esaurimento socket TCP (Slowloris).
limit_conn_zone $binary_remote_addr zone=addr_limit:10m;

# --- 2. REINDIRIZZAMENTO HTTP -> HTTPS ---
server {
    listen 80;
    server_name api.example.com; # Sostituire con dominio reale
    return 301 https://$host$request_uri;
}

# --- 3. SERVER PRINCIPALE (HTTPS) ---
server {
    listen 443 ssl;
    server_name api.example.com;

    # --- CERTIFICATI SSL (Gestiti da Certbot) ---
    # Certbot li inserirà automaticamente qui dopo il primo run
    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # --- SECURITY HARDENING ---
    server_tokens off; # Nasconde la versione di Nginx (Security by obscurity)
    client_max_body_size 10M; # Limita upload per evitare DoS su disco/ram

    # Header di Sicurezza Browser
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # --- BACKEND API PROXY ---
    location / {
        # Rate Limit Applicato: Max 10 req/s, burst (picco) fino a 20 senza delay
        limit_req zone=api_limit burst=20 nodelay;
        limit_conn addr_limit 10;

        # Proxy verso Docker (Localhost porta 2230)
        # Nota: Il container espone la porta solo su localhost per sicurezza
        proxy_pass http://127.0.0.1:2230;

        # Supporto WebSocket e KeepAlive
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # IP Passthrough (Fondamentale per i log di audit del backend)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Attivazione

```bash
# Link simbolico
sudo ln -s /etc/nginx/sites-available/volcanic-sample-backend /etc/nginx/sites-enabled/

# Rimuovi default
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null

# Verifica e Riavvio
sudo nginx -t
sudo systemctl reload nginx

# Ottenimento Certificato (al primo setup)
sudo certbot --nginx -d api.example.com
```

---

## 8.3 Docker Deployment Strategy

Il backend gira in un container Docker isolato. L'immagine è costruita usando una strategia **Multi-Stage Build** (visibile nel `Dockerfile`) per mantenere l'immagine di produzione leggera (senza compilatori TypeScript o devDependencies).

### File Environment Produzione (`.env.prod`)

Questo file deve risiedere sul server (es. `/home/ubuntu/volcanic-sample-backend/.env.prod`) e **NON** nel repository Git.

```properties
# --- CORE SETTINGS ---
NODE_ENV=production
HOST=0.0.0.0
PORT=2230 # Porta interna al container

# --- NODE TUNING ---
# Limita il Garbage Collector a circa il 75% della RAM allocata al container
# Esempio per container con 4GB RAM
NODE_OPTIONS=--max-old-space-size=3072

# --- AUTH SECURITY ---
# Generare con: openssl rand -base64 64
JWT_SECRET=CHANGE_THIS_TO_VERY_LONG_RANDOM_STRING
JWT_EXPIRES_IN=15m
JWT_REFRESH=true
JWT_REFRESH_SECRET=CHANGE_THIS_TO_DIFFERENT_RANDOM_STRING
JWT_REFRESH_EXPIRES_IN=30d

# --- DATABASE (Es. OVH Managed o AWS RDS) ---
START_DB=true
DB_HOST=pg-databases.ovh.net
DB_PORT=20184
DB_NAME=db_production
DB_USERNAME=db_user
DB_PASSWORD=secure_db_password

# --- DB SSL ---
# Richiesto per connessioni cloud sicure
DB_SSL=true
# Percorso INTERNO al container (montato via volume)
DB_SSL_CA_PATH=/app/certs/ca.pem

# --- LOGGING ---
# In produzione 'info' riduce I/O. Usa 'false' per colorize per parsers (Datadog/ELK)
LOG_LEVEL=info
LOG_COLORIZE=false
```

### Script di Avvio Docker

Non usare `docker run` manuale ogni volta. Crea uno script o usa questo comando completo.

**Comando di Run:**

```bash
docker run -d \
  --name volcanic-sample-backend \
  --restart always \
  # Espone la porta SOLO su localhost (Nginx farà da proxy)
  -p 127.0.0.1:2230:2230 \
  # Risolve problemi DNS interni in alcune reti cloud
  --add-host host.docker.internal:host-gateway \
  # Monta il file .env di produzione
  --env-file /home/ubuntu/volcanic-sample-backend/.env.prod \
  # Monta i certificati CA per il DB (se necessario)
  -v /home/ubuntu/certs:/app/certs \
  volcanic-sample-backend:latest
```

---

## 8.4 Continuous Deployment ("Poor Man's CI/CD")

Per un setup rapido senza Kubernetes, un semplice script bash eseguito via cron è robusto ed efficace. Controlla Git, se ci sono modifiche, rebuilda e riavvia.

### Script `deploy.sh`

```bash
#!/bin/bash

# Configurazione
LOG_FILE="/home/ubuntu/deploy.log"
APP_DIR="/home/ubuntu/volcanic-sample-backend"
IMAGE_NAME="volcanic-sample-backend"
CONTAINER_NAME="volcanic-sample-backend"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$APP_DIR" || { log "Directory not found"; exit 1; }

# 1. Fetch senza merge
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    log "🚀 Update found! ($LOCAL -> $REMOTE)"

    # 2. Scarica codice
    git pull origin main

    # 3. Build Docker
    log "Building Docker Image..."
    docker build -t $IMAGE_NAME .

    if [ $? -eq 0 ]; then
        # 4. Zero-Downtime Restart (concettuale: stop -> start veloce)
        log "Restarting Container..."
        docker stop $CONTAINER_NAME || true
        docker rm $CONTAINER_NAME || true

        # Esegui comando di run (copia i parametri dal paragrafo 8.3)
        docker run -d \
          --name $CONTAINER_NAME \
          --restart always \
          -p 127.0.0.1:2230:2230 \
          --env-file .env.prod \
          -v /home/ubuntu/certs:/app/certs \
          $IMAGE_NAME

        log "✅ Backend updated successfully."

        # Pulizia immagini vecchie
        docker image prune -f > /dev/null 2>&1
    else
        log "❌ Build Failed. Aborting restart."
    fi
else
    # Nessun aggiornamento, uscita silenziosa
    :
fi
```

### Automazione (Crontab)

Esegui il controllo ogni 15 minuti.

```bash
*/15 * * * * /home/ubuntu/volcanic-sample-backend/deploy.sh >> /dev/null 2>&1
```

---

## 8.5 Database Operations

### Estensioni Obbligatorie

PostgreSQL deve avere l'estensione UUID attiva.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Data Seeding (Popolamento Iniziale)

Invece di lanciare SQL manuali che potrebbero violare i vincoli di integrità o bypassare l'hashing delle password, `volcanic-sample-backend` fornisce un endpoint dedicato per l'inizializzazione sicura.

File di riferimento: `src/api/tools/controller/tools.ts`.

1.  Assicurarsi che l'utente chiamante abbia un token temporaneo o che la sicurezza sia disabilitata per il primo avvio.
2.  Chiamare:
    ```bash
    curl -X GET http://localhost:2230/api/tools/prepare-database \
         -H "Authorization: Bearer <ADMIN_TOKEN>"
    ```
3.  **Cosa fa:**
    - Pulisce le tabelle nell'ordine corretto (rispettando FK).
    - Crea Utenti, Professionisti, Clienti e Ordini di test definiti in `src/utils/initialData.ts`.
    - Applica l'hashing corretto alle password (`bcrypt`).

---

## 8.6 Diagnostica e Monitoraggio

Strumenti essenziali per capire lo stato del sistema in produzione.

### 1. Log Applicativi

Vedere cosa sta succedendo nel backend in tempo reale.

```bash
docker logs volcanic-sample-backend --tail 200 -f
```

### 2. Risorse (CPU/RAM)

Verificare se il container è sotto stress o se c'è un memory leak.

```bash
# Visione live
docker stats --no-stream

# Verifica limite memoria applicato
docker inspect volcanic-sample-backend --format='Memory Limit: {{.HostConfig.Memory}}'
```

### 3. Connettività Database

Se l'app non parte ("Connection Timeout"), verificare se il container riesce a raggiungere il DB.

```bash
# Entra nel container e usa nc (netcat) o ping
docker exec -it volcanic-sample-backend sh
/usr/src/app # nc -zv pg-databases.ovh.net 20184
```

---

# Parte 9: Integrazione GraphQL & Apollo

Il Volcanic Stack supporta un'architettura **Dual-Stack**: è possibile esporre le stesse funzionalità di business sia via REST (per integrazioni standard/web) che via GraphQL (per client mobile o frontend complessi che richiedono data-fetching selettivo), mantenendo il codice DRY (Don't Repeat Yourself).

## 9.1 Attivazione e Configurazione

L'integrazione di Apollo Server è gestita condizionalmente all'avvio.

### 1. Variabili d'Ambiente (`.env`)

Per abilitare l'endpoint `/graphql` e la Sandbox (se in dev):

```properties
GRAPHQL=true
```

### 2. Struttura dei File

Per convenzione, il codice GraphQL risiede in `src/apollo`:

```bash
src/
└── apollo/
    ├── type-defs.ts    # Definizioni Schema (SDL)
    ├── resolvers.ts    # Mappatura Query/Mutation -> Service
    └── context.ts      # Costruzione del contesto (Auth)
```

---

## 9.2 Autenticazione e UserContext

In GraphQL non abbiamo i middleware di Fastify (`global.isAuthenticated`) eseguiti prima del resolver nello stesso modo lineare. L'autenticazione deve avvenire durante la costruzione del **Context**.

Il nostro obiettivo è iniettare lo stesso `UserContext` usato nelle API REST, in modo che i Service (`applyPermissions`) funzionino senza modifiche.

### Implementazione `src/apollo/context.ts`

```typescript
import { FastifyRequest, FastifyReply } from 'fastify'
import { UserContext } from '../../types/index.js'

export interface MyContext {
  userContext: UserContext
}

export const myContextFunction = async (request: FastifyRequest, reply: FastifyReply): Promise<MyContext> => {
  // 1. Estrazione Token
  const authHeader = request.headers.authorization
  const token = authHeader?.replace('Bearer ', '')

  // Contesto Default (Public/Guest)
  let userContext: UserContext = {
    userId: null,
    role: 'public',
    company: undefined,
    professionalId: undefined
  }

  if (token) {
    try {
      // 2. Validazione JWT (usa l'istanza jwt del server Fastify)
      const decoded: any = request.server.jwt.verify(token)

      // 3. Recupero Utente dal DB (similare all'hook preHandler REST)
      // Nota: usiamo userManager globale o repository diretto
      const user = await repository.users.findOne({
        where: { externalId: decoded.sub },
        relations: ['professional']
      })

      if (user && !user.blocked) {
        userContext = {
          userId: user.id,
          role: 'user', // Logica di mapping ruoli (semplificata)
          company: user.professional?.company,
          professionalId: user.professional?.id
        }

        if (user.roles.includes('admin')) userContext.role = 'admin'
        else if (user.roles.includes('manager')) userContext.role = 'manager'
      }
    } catch (err) {
      // Token invalido: procediamo come public o lanciamo errore se l'intera API è privata
      // throw new GraphQLError('Invalid Token', { extensions: { code: 'UNAUTHENTICATED' } });
    }
  }

  return { userContext }
}
```

---

## 9.3 Schema First: TypeDefs e Resolvers

L'approccio consigliato è **Schema First**: definire i tipi, poi implementare i resolver che delegano ai Service.

### 1. Definizione (`src/apollo/type-defs.ts`)

```typescript
export const typeDefs = `
  type Order {
    id: ID!
    code: String!
    name: String!
    status: String
    # Relazioni
    workOrders: [WorkOrder]
  }

  type WorkOrder {
    id: ID!
    code: String!
  }

  # Input per filtri complessi (Mapping su Magic Query)
  input OrderFilter {
    code: String      # eq
    status: String    # eq
    nameContains: String # contains
  }

  type Query {
    # Recupera un ordine specifico
    order(id: ID!): Order
    
    # Lista con filtri
    orders(filter: OrderFilter, page: Int, pageSize: Int): [Order]
  }
`
```

### 2. Resolvers (`src/apollo/resolvers.ts`)

I resolver **NON** devono contenere logica SQL. Devono solo chiamare i Service esistenti.

```typescript
import { orderService } from '../services/order.service.js'
import { workOrderService } from '../services/workOrder.service.js'

export const resolvers = {
  Query: {
    order: async (_: any, args: { id: string }, context: MyContext) => {
      // Riutilizzo del Service: la sicurezza è garantita da findOne internamente
      return await orderService.findOne(context.userContext, args.id)
    },

    orders: async (_: any, args: any, context: MyContext) => {
      // Mapping argomenti GraphQL -> Volcanic Query Params
      // (Vedi sezione 9.4 per helper avanzati)
      const queryParams = {
        page: args.page || 1,
        pageSize: args.pageSize || 25,
        // Esempio mapping manuale
        ...(args.filter?.code && { code: args.filter.code }),
        ...(args.filter?.nameContains && { 'name:contains': args.filter.nameContains })
      }

      const { records } = await orderService.findAll(context.userContext, queryParams)
      return records
    }
  },

  // Field Resolver per le relazioni (risolve N+1 o caricamento lazy)
  Order: {
    workOrders: async (parent: any, _: any, context: MyContext) => {
      // Se workOrders è già stato caricato dal service padre, usalo
      if (parent.workOrders) return parent.workOrders

      // Altrimenti chiama il service figlio filtrando per padre
      // Nota: findAll del service applica la sicurezza anche qui!
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

Il sistema di filtri REST (`name:contains=foo`) è molto potente. Per non perdere questa potenza in GraphQL senza riscrivere migliaia di input type, possiamo creare un **adapter**.

### Utility: `graphqlToVolcanic`

Immaginiamo di passare un JSON stringify o un oggetto libero in GraphQL per i filtri avanzati.

**TypeDefs:**

```graphql
scalar JSON # Richiede graphql-type-json
type Query {
  # queryParams accetta l'oggetto standard di Volcanic { "name:like": "A%", "sort": "id:desc" }
  ordersGeneric(queryParams: JSON): [Order]
}
```

**Resolver:**

```typescript
ordersGeneric: async (_: any, args: { queryParams: any }, ctx: MyContext) => {
  // Passaggio diretto ("Pass-through")
  // Il Service riceve esattamente ciò che riceverebbe dal controller REST
  const { records } = await orderService.findAll(ctx.userContext, args.queryParams || {})
  return records
}
```

**Vantaggi:**

1.  **Parità di Feature**: Qualsiasi filtro supportato da `@volcanicminds/typeorm` (incluso `_logic` o nested filtering `client.name:eq`) funziona in GraphQL immediatamente.
2.  **Manutenibilità**: Non serve creare `InputType` per ogni combinazione di filtri.

---

## 9.5 Performance: Il Problema N+1

In GraphQL, è facile cadere nel problema N+1 (es. chiedo 100 ordini, e per ognuno il resolver `client` fa una query al DB).

### Soluzione 1: `addRelations` nel Service (Eager Loading)

Se sappiamo che una query GraphQL richiederà spesso una relazione, configuriamo il Service per caricarla di default.

```typescript
// src/services/order.service.ts
protected addRelations(qb, alias) {
    // Carica sempre il cliente.
    // Il resolver Order.client non dovrà fare query extra.
    return qb.leftJoinAndSelect(`${alias}.client`, 'client')
}
```

### Soluzione 2: DataLoader (Avanzato)

Se l'eager loading è troppo pesante, si usa `DataLoader` nel contesto.

1.  Creare un `BatchLoader` che accetta array di ID.
2.  Eseguire `repository.find({ where: { id: In(ids) } })`.
3.  Usare il loader nel resolver: `return context.loaders.clientLoader.load(parent.clientId)`.

> **Consiglio Volcanic**: Per il 90% dei casi di business (dashboard, liste), l'uso intelligente di `addRelations` nel `BaseService` combinato con la paginazione è sufficiente e molto più semplice da mantenere rispetto ai DataLoader.

---

## 9.6 Riassunto Integrazione

1.  **Abilita** GraphQL in `.env`.
2.  **Implementa** `src/apollo/context.ts` per estrarre il token JWT e creare un `UserContext` identico a quello REST.
3.  **Definisci** lo Schema (`type-defs.ts`).
4.  **Implementa** i Resolver mappandoli 1:1 sui metodi `findAll`/`findOne` dei Service esistenti.
5.  **Goditi** la sicurezza RLS automatica: poiché i resolver chiamano i Service, un utente GraphQL non potrà mai vedere dati che non potrebbe vedere via REST.

---

# Parte 10: Pattern Avanzati e Troubleshooting

Questa sezione finale raccoglie i pattern specifici implementati in `volcanic-sample-backend` per la gestione del ciclo di vita del dato e la risoluzione dei problemi comuni.

## 10.1 Data Seeding & Maintenance

A differenza delle migrazioni classiche, `volcanic-sample-backend` utilizza un approccio a **"Smart Seeding"** tramite API. Questo è utilissimo per ambienti di test, staging o per ripristinare un ambiente di sviluppo pulito.

### L'approccio `src/api/tools`

Il controller `tools.ts` espone endpoint amministrativi che eseguono operazioni distruttive o massive.

**Endpoint: `POST /api/tools/prepare-database`**

Questo endpoint (protetto da Admin Auth) esegue tre passi critici:

1.  **Clean**: Svuota le tabelle nell'ordine inverso rispetto alle Foreign Key (per evitare errori di vincolo).
    ```typescript
    // Esempio da src/api/tools/controller/tools.ts
    const queryRunner = connection.createQueryRunner()
    // Ordine inverso di dipendenza
    await queryRunner.query('DELETE FROM "timesheet";') // Figlio
    await queryRunner.query('DELETE FROM "activity";') // Padre
    // ...
    ```
2.  **Seed**: Inserisce i dati statici definiti in `src/utils/initialData.ts`.
    - Utenti, Ruoli, Stati Ordine, Categorie.
3.  **Link**: Collega le entità (es. assegna i WorkOrder agli Ordini appena creati usando logiche di business, come la generazione del codice univoco).

**Best Practice:**
Non committare mai dati sensibili in `initialData.ts`. Usare librerie come `faker` o dati anonimizzati.

---

## 10.2 Gestione Enum e Costanti

Per mantenere la coerenza tra il database (Postgres) e il codice (TypeScript), `volcanic-sample-backend` centralizza le definizioni.

### File: `src/entities/all.enums.ts`

Invece di spargere stringhe magiche ('active', 'closed') nel codice, si usano Enum TypeScript esportati.

```typescript
export enum OrderStateEnum {
  ACTIVE = 'active',
  CLOSED = 'closed',
  LOST = 'lost'
}

export const VALID_COMPANIES = ['volcanicminds', 'acme']
```

**Utilizzo nell'Entità:**

```typescript
import { OrderStateEnum } from './all.enums.js'

@Column({
  type: 'enum',
  enum: OrderStateEnum,
  default: OrderStateEnum.ACTIVE
})
state: OrderStateEnum
```

**Utilizzo nel Service/Controller:**

```typescript
if (order.state === OrderStateEnum.CLOSED) {
  // ...
}
```

---

## 10.3 Troubleshooting: Errori Comuni e Soluzioni

Lavorando con il Volcanic Stack, potreste incontrare questi errori specifici. Ecco come risolverli.

### 1. "Relation not found" / "Missing FROM-clause entry"

**Sintomo:** Chiamate un'API con un filtro relazionale (es. `?client.name:eq=Acme`) e ricevete un errore 500 SQL.
**Causa:** La relazione `client` non è stata caricata nel Service.
**Soluzione:** Aggiungere la join in `addRelations` del Service.

```typescript
// src/services/order.service.ts
protected addRelations(qb, alias) {
    // L'alias 'client' DEVE corrispondere al prefisso usato nel filtro
    return qb.leftJoinAndSelect(`${alias}.client`, 'client')
}
```

### 2. "Circular Dependency" all'avvio

**Sintomo:** Il server crasha all'avvio o TypeORM si lamenta che un'entità è `undefined`.
**Causa:** Import circolare tra file di entità (es. Order importa WorkOrder che importa Order).
**Soluzione:**

1.  Usare `import type { ... }` per i tipi TypeScript.
2.  Nei decoratori TypeORM, usare le **stringhe** invece delle classi.

```typescript
// ERRORE: @OneToMany(() => WorkOrder, ...)
// CORRETTO: @OneToMany('WorkOrder', ...)
```

### 3. "Access Denied" silenzioso (Lista vuota)

**Sintomo:** Un utente chiama `GET /orders` e riceve `[]` (lista vuota), ma nel DB ci sono dati.
**Causa:** La RLS (`applyPermissions`) sta filtrando tutto.
**Debug:**

1.  Abilitare `DB_LOGGING=true` nel `.env`.
2.  Controllare la query SQL generata nella console.
3.  Verificare `req.userContext` nel controller: il ruolo è corretto? L'ID professionale è associato?

### 4. Gestione Date e Timezone

**Problema:** Le date salvate sembrano sbagliate di 1 o 2 ore.
**Regola:**

1.  Il DB (Postgres) deve essere in UTC.
2.  Il Backend (Node) deve lavorare in UTC.
3.  Il Frontend converte in Locale.
4.  In `src/entities/*.ts`, usare colonne `timestamp` (senza time zone) se si gestisce tutto in UTC applicativo, o `timestamptz` se si vuole che Postgres gestisca l'offset. Volcanic preferisce date ISO string standard (`YYYY-MM-DDTHH:mm:ss.sssZ`).

---

## 10.4 Checklist per il Rilascio in Produzione

Prima di deployare `volcanic-sample-backend`, verificare:

1.  [ ] **Env**: `NODE_ENV=production`.
2.  [ ] **Logs**: `LOG_LEVEL=info` (non `trace` o `debug`).
3.  [ ] **DB Sync**: `DB_SYNCHRONIZE=false` (fondamentale per non perdere dati).
4.  [ ] **Auth**: `JWT_SECRET` e `JWT_REFRESH_SECRET` sono lunghe, complesse e diverse tra loro.
5.  [ ] **MFA**: Policy impostata secondo requisiti business (`OPTIONAL` o `MANDATORY`).
6.  [ ] **Admin**: Verifica che l'utente Admin abbia una password forte e MFA attivo.
