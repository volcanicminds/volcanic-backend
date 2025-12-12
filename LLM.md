# Indice: The Volcanic Stack - Definitive Backend Guide

1.  **[Parte 1: Fondamenta e Infrastruttura](#parte-1-fondamenta-e-infrastruttura)**

    - **1.1 Introduzione e Filosofia**
      - Panoramica dello Stack (`@volcanicminds/backend`, `typeorm`, `tools`)
      - Principi Architetturali: Thin Controllers, Fat Services, Secure by Default
    - **1.2 Struttura del Progetto**
      - Anatomia delle Cartelle (`src/api`, `src/services`, `src/entities`, ecc.)
      - Bootstrapping (`index.ts`)
    - **1.3 Configurazione Database (Production Grade)**
      - Driver PostgreSQL e Naming Strategy
      - Configurazione Pool e Timeout (Connection, Statement, Idle)
      - Gestione SSL Condizionale
      - Query Result Cache

2.  **[Parte 2: Deep Dive Data Modeling & Entities](#parte-2-deep-dive-data-modeling--entities)**

    - **2.1 Anatomia di un'Entità Volcanic**
      - Estensione di `BaseEntity`
      - Decoratori Primari (`@Entity`, `@Unique`, `@Index`)
      - Tipi di Colonna PostgreSQL (`jsonb`, `array`, `enum`, `uuid`)
    - **2.2 Gestione Avanzata delle Relazioni**
      - **One-to-One**: Owner side, `@JoinColumn`, e casi d'uso (es. `User` <-> `Professional`).
      - **Many-to-One / One-to-Many**: La spina dorsale del grafo. Configurazione del lato inverso, gestione delle _Circular Dependencies_ (uso delle stringhe `'Order'` vs classi).
      - **Many-to-Many**: Tabelle di giunzione implicite vs esplicite.
    - **2.3 Opzioni delle Relazioni**
      - `eager: true` vs `lazy: true` vs caricamento manuale (Best practices).
      - `cascade`: Quando usare insert/update/remove.
      - `onDelete`: Gestione dell'integrità referenziale (`CASCADE`, `SET NULL`).
    - **2.4 Logica nelle Entità: Computed Fields & Hooks**
      - Il decoratore `@AfterLoad`: Calcolare proprietà a runtime (es. `doneHours`, `delta`).
      - Virtual Properties: Campi che esistono nel modello ma non nel DB.
    - **2.5 Viste SQL e `@ViewEntity`**
      - Quando usarle (Reportistica, Aggregazioni complesse).
      - Mapping su classi per l'uso nei Service.

3.  **[Parte 3: Magic Queries & Data Access](#parte-3-magic-queries--data-access)**

    - **3.1 Translation Layer: URL to SQL**
      - Come funziona `executeFindQuery`.
      - Tabella completa Operatori (`:eq`, `:gt`, `:in`, `:likei`, `:null`, ecc.).
    - **3.2 Filtri Relazionali (Deep Filtering)**
      - Filtraggio tramite Dot Notation (es. `order.client.name:eq=Acme`).
    - **3.3 Advanced Boolean Logic**
      - Utilizzo del parametro `_logic` per query complesse `(A OR B) AND C`.
    - **3.4 Paginazione e Ordinamento**
      - Standardizzazione parametri `page`, `pageSize`, `sort`.
      - Header di risposta (`v-total`, `v-count`, ecc.).

4.  **[Parte 4: API Layer (Routing & Controllers)](#parte-4-api-layer-routing--controllers)**

    - **4.1 Autodiscovery delle Rotte**
      - Il loader automatico (`loader/router.ts`).
    - **4.2 Configurazione `routes.ts`**
      - Definizione Endpoint, Handler e Middleware.
      - Configurazione Swagger/OpenAPI automatica.
    - **4.3 Controllers: Best Practices**
      - Normalizzazione input (`req.data()`).
      - Normalizzazione Relazioni per il salvataggio (trasformazione stringa ID -> Oggetto).
      - Gestione Errori e Status Code.

5.  **[Parte 5: Service Layer Architecture](#parte-5-service-layer-architecture)**

    - **5.1 Il Pattern `BaseService`**
      - Astrazione del Repository TypeORM.
      - Metodi core: `findAll`, `findOne`, `create`, `update`, `delete`.
    - **5.2 Security Context & RLS**
      - Iniezione di `UserContext` (Ruolo, Company, ID).
      - Implementazione di `applyPermissions` per il filtraggio obbligatorio dei dati.
    - **5.3 QueryBuilder Avanzato**
      - Metodo `addRelations` per join automatiche e sicure.
      - Sub-queries e Select calcolate (es. somma ore dai timesheet).

6.  **[Parte 6: Autenticazione e Sicurezza](#parte-6-autenticazione-e-sicurezza)**

    - **6.1 Stack Auth**
      - JWT Lifecycle (Access & Refresh Tokens).
      - Configurazione `src/config/roles.ts`.
    - **6.2 Multi-Factor Authentication (MFA)**
      - Policy di sicurezza (`OPTIONAL`, `MANDATORY`, `ONE_WAY`).
      - Flusso Gatekeeper (Token "Pre-Auth").
      - Implementazione con `@volcanicminds/tools`.
    - **6.3 TypeScript Augmentation**
      - Estensione tipi globali in `types/index.d.ts`.

7.  **[# Parte 7: Validazione, Utilities, Scheduler e Testing](#parte-7-validazione-utilities-scheduler-e-testing)**

    - **7.1 Validazione JSON Schema**
      - Override degli schemi core (es. Login Response custom).
    - **7.2 Utilities Core (`@volcanicminds/tools`)**
      - Logging e Mailer.
    - **7.3 Job Scheduler e Tracking**
      - Task ricorrenti e Audit Log automatico.
    - **7.4 Testing**
      - Strategie Unit e E2E.

8.  **[Parte 8: System Administration e Deployment](#parte-8-system-administration-e-deployment)**
    - **8.1 Hardening del Server (Ubuntu)**
      - Configurazione Firewall (UFW): Strategia "Deny by Default".
      - Installazione Stack Base (Nginx, Certbot).
    - **8.2 Nginx: Reverse Proxy & Security Gateway**
      - Configurazione Rate Limiting (Protezione DDoS/Bruteforce).
      - Terminazione SSL e Reindirizzamento HTTPS.
      - Hardening (Security Headers, `X-Frame-Options`, `X-XSS-Protection`).
      - Proxy Pass e gestione IP Reale.
    - **8.3 Docker Deployment Strategy**
      - Configurazione `.env.prod`: Memory Limit, Pool DB, SSL Tuning.
      - Comando di avvio robusto (`--restart always`, `--add-host`, volumi SSL).
    - **8.4 Continuous Deployment ("Poor Man's CI/CD")**
      - Script `deploy.sh`: Auto-update basato su Git Hash check.
      - Automazione via Crontab e gestione cleanup immagini.
    - **8.5 Database Operations**
      - Estensioni obbligatorie (`uuid-ossp`).
      - Script SQL per Data Wipe (Reset pulito rispettando FK).
      - Seeding iniziale.
    - **8.6 Diagnostica e Monitoraggio**
      - Strumenti live: `htop`, `docker stats`.
      - Analisi Log e Network Check (`netstat`, `nc`).

---

# The Volcanic Stack: Guida Tecnica Definitiva

**Versione: 1.0 - PostgreSQL Edition**

Questa documentazione serve come riferimento assoluto per la costruzione di applicazioni backend enterprise utilizzando l'ecosistema `@volcanicminds`. È progettata per essere ingerita da LLM e utilizzata da Senior Architects per garantire standardizzazione, sicurezza e performance.

---

# Parte 1: Fondamenta e Infrastruttura

In questa sezione costruiremo le basi dell'applicazione. Non si tratta solo di "far partire il server", ma di predisporre un ambiente capace di scalare, gestire pool di connessioni complessi, negoziare SSL sicuri e organizzare il codice per l'autodiscovery.

## 1.1 Introduzione e Filosofia dello Stack

Il framework non è una semplice libreria, ma un **framework opinionato**. Questo significa che impone decisioni architetturali precise per rimuovere il carico cognitivo su questioni banali (routing, auth, connessione db) e concentrare lo sviluppo sulla logica di business.

### I Tre Pilastri

1.  **`@volcanicminds/backend` (Server Core)**
    - Wrapper di **Fastify**.
    - Gestisce il ciclo di vita HTTP, i Middleware, gli Hooks e il caricamento automatico delle risorse.
    - Fornisce il sistema di Autenticazione (JWT + Refresh Token) e Sicurezza (MFA, RBAC) out-of-the-box.
2.  **`@volcanicminds/typeorm` (Data Layer)**
    - Wrapper di **TypeORM**.
    - Introduce il concetto di **"Magic Query"**: trasforma automaticamente payload JSON/URL in query SQL ottimizzate.
    - Gestisce la connessione al database e fornisce i repository tipizzati globalmente.
3.  **`@volcanicminds/tools` (Utilities)**
    - Libreria di supporto tree-shakeable.
    - Include: Logger (Pino), Mailer (Nodemailer wrapper), MFA (OTP generation/verification), Utils comuni.

### Principi Architetturali Vincolanti

Per mantenere la manutenibilità, ogni sviluppatore (o LLM) deve aderire a questi principi:

- **Thin Controllers**: I controller sono "stupidi". Non devono MAI contenere logica di business o query dirette al DB. Il loro unico scopo è:
  1.  Ricevere la `FastifyRequest`.
  2.  Estrarre e normalizzare i dati (`req.data()`).
  3.  Invocare un metodo del **Service Layer**.
  4.  Restituire la risposta al client.
- **Fat Services**: Tutta la logica, le transazioni DB e le validazioni complesse risiedono nei Service. I Service sono agnostici rispetto all'HTTP (non conoscono `req` o `res`).
- **Context-Driven Security**: Ogni operazione del Service Layer deve ricevere un `UserContext`. La sicurezza non è solo sull'endpoint (guardia alla porta), ma sui dati (Row Level Security applicativa).
- **Convention over Configuration**: Il nome dei file e la loro posizione nel filesystem determinano automaticamente URL, Iniezioni e Configurazioni.

---

## 1.2 Struttura del Progetto e Bootstrapping

Il framework utilizza un sistema di **autodiscovery** basato su `glob` patterns. Deviare dalla struttura standard comporterà il mancato caricamento di rotte, entità o configurazioni.

### Anatomia delle Cartelle (Project Root)

```bash
./
├── .env                    # Configurazioni segrete (NON committare)
├── package.json            # type: "module", engines: node >= 24
├── tsconfig.json           # target: "ES2022", module: "NodeNext"
├── index.ts                # Entry Point (Bootstrap)
├── types                   # Definizioni TypeScript custom
│   └── index.d.ts          # Estensione tipi globali (FastifyRequest, UserContext)
└── src
    ├── api                 # MODULI FUNZIONALI (Domain Driven)
    │   └── [domain_name]   # es. "orders", "users"
    │       ├── controller  # Logica di controllo
    │       │   └── [name].ts
    │       └── routes.ts   # Definizione endpoint e config Swagger
    ├── config              # CONFIGURAZIONI GLOBALI
    │   ├── constants.ts    # Costanti (es. Cache TTL, Regex)
    │   ├── database.ts     # Configurazione complessa TypeORM
    │   ├── general.ts      # Configurazione Framework (MFA, Scheduler)
    │   ├── plugins.ts      # Plugin Fastify (CORS, Helmet, RateLimit)
    │   ├── roles.ts        # Definizione Ruoli RBAC
    │   └── tracking.ts     # Configurazione Audit Log
    ├── entities            # MODELLI DATI (TypeORM .e.ts)
    ├── services            # BUSINESS LOGIC (Service Layer)
    ├── schemas             # JSON SCHEMAS (Validazione & Swagger)
    ├── hooks               # HOOKS GLOBALI (onRequest, preHandler)
    ├── schedules           # CRON JOBS (*.job.ts)
    └── utils               # Helper functions
```

### Il Bootstrapping (`index.ts`)

Il file `index.ts` è il punto di ingresso. Deve orchestrare l'avvio del database prima di quello del server, iniettando le dipendenze necessarie per l'autenticazione.

**Codice Standard di `index.ts`:**

```typescript
'use strict'

import { start as startServer, yn } from '@volcanicminds/backend'
import { start as startDatabase, userManager, DataSource } from '@volcanicminds/typeorm'
// Importiamo l'adapter MFA dai tools (se necessario per logiche custom)
import { mfaAdapter } from './src/services/mfa.adapter.js'
import { database } from './src/config/database.js'

const start = async () => {
  let db: DataSource | null = null

  // 1. Avvio Database (Condizionale o Obbligatorio a seconda dell'ENV)
  if (yn(process.env.START_DB, true)) {
    const options = database?.default || {}
    db = await startDatabase(options)

    if (db && log.i) {
      const opts = db.options as any
      log.info(`Database attached at ${opts.host}:${opts.port} (${opts.database})`)
    }
  }

  // 2. Avvio Server
  // È CRUCIALE passare 'userManager' (da typeorm) e 'mfaManager' (adapter)
  // per abilitare il sistema di autenticazione integrato nel backend.
  await startServer({
    userManager: userManager,
    mfaManager: mfaAdapter
  })
}

start().catch((err) => {
  console.error('Fatal Error during startup:', err)
  process.exit(1)
})
```

---

## 1.3 Configurazione Database (Production Grade)

Questa è la sezione più critica per la stabilità. Una configurazione errata qui porta a timeout, connessioni cadute ("hanging queries") e problemi di SSL in ambienti cloud (AWS, Azure, OVH).

File di riferimento: `src/config/database.ts`.

### 1. Naming Strategy Custom

PostgreSQL utilizza standard `snake_case` per tabelle e colonne, mentre TypeScript utilizza `camelCase`. TypeORM tenta di gestirlo, ma per avere un controllo preciso sui nomi delle colonne (evitando doppie virgolette o nomi generati strani), implementiamo una strategia esplicita.

```typescript
import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm'

class CustomNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  // Converte myPropertyName in my_property_name
  columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    return embeddedPrefixes
      .concat(customName || propertyName)
      .map((s, i) => (i > 0 ? s.replace(/^(.)/, (c) => c.toUpperCase()) : s))
      .join('')
  }
}
```

### 2. Gestione SSL (Certificati CA)

In sviluppo locale (`localhost`), SSL è disabilitato. In produzione, molti provider (es. OVH, AWS RDS) richiedono SSL e spesso un certificato CA specifico per prevenire MITM attacks.

```typescript
import fs from 'node:fs'

const getSslConfig = () => {
  // Se DB_SSL è falso o non settato, niente SSL
  if (process.env.DB_SSL !== 'true') return false

  // Se abbiamo un percorso al certificato CA, lo leggiamo e forziamo la verifica
  if (process.env.DB_SSL_CA_PATH) {
    try {
      return {
        rejectUnauthorized: true, // Sicurezza Massima: verifica che il server sia chi dice di essere
        ca: fs.readFileSync(process.env.DB_SSL_CA_PATH).toString()
      }
    } catch (e) {
      console.error('CRITICAL: Could not read SSL CA file:', e)
      // In caso di errore file, fallback sicuro (o lanciare errore bloccante)
      throw new Error('SSL Configuration Failed')
    }
  }

  // Fallback: SSL attivo ma senza verifica del certificato (Meno sicuro, accettabile in staging)
  return { rejectUnauthorized: false }
}
```

### 3. Configurazione Completa ed Esaustiva

Ecco l'oggetto `database` completo. Nota l'uso della proprietà `extra` per passare configurazioni native al driver `node-postgres` (`pg`), essenziali per il **Connection Pooling** e i **Timeout**.

```typescript
import { Database } from '@volcanicminds/typeorm'
import { GLOBAL_CACHE_TTL } from './constants.js'

// Helper per parsing booleani da env
const isTrue = (val: string | undefined, defaultVal: boolean) => {
  if (val === undefined) return defaultVal
  return val === 'true' || val === '1'
}

export const database: Database = {
  default: {
    // --- TypeORM Core Settings ---
    type: 'postgres', // Forziamo Postgres per questa guida
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'myapp',

    // Schema Sync: MAI 'true' in produzione. Rischio perdita dati.
    synchronize: isTrue(process.env.DB_SYNCHRONIZE, false),

    logging: isTrue(process.env.DB_LOGGING, true), // 'all', 'query', 'error'
    namingStrategy: new CustomNamingStrategy(),

    // Nome applicazione visibile nelle tabelle di monitoraggio PG (pg_stat_activity)
    applicationName: process.env.APP_NAME || 'volcanic-backend',

    // --- Pool Settings (TypeORM Level) ---
    // Tempo massimo per ottenere una connessione dal pool prima di un errore
    connectTimeoutMS: Number(process.env.DB_CONNECTION_TIMEOUT) || 30000,
    // Dimensione pool (ridondante con extra.max, ma buona pratica settarlo)
    poolSize: Number(process.env.DB_MAX_CONNECTING) || 50,

    // --- Driver Settings (Native 'pg' driver) ---
    // Queste opzioni vanno direttamente al driver sottostante
    extra: {
      application_name: process.env.APP_NAME || 'volcanic-backend',

      // 1. Connection Pool Tuning
      // Numero massimo di client nel pool.
      // Calcolo empirico: (Core * 2) + Spool effettivo. 50 è un buon default per server medi.
      max: Number(process.env.DB_MAX_CONNECTING) || 50,

      // Numero minimo di client da mantenere aperti (idle). Evita il "cold start" delle connessioni.
      min: Number(process.env.DB_MIN_CONNECTING) || 5,

      // 2. Timeouts & KeepAlive
      // Tempo massimo (ms) che un client può rimanere inattivo nel pool prima di essere chiuso
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT) || 30000,

      // Tempo massimo (ms) per completare l'handshake di connessione TCP
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT) || 30000,

      // TCP KeepAlive: Fondamentale in Azure/AWS per evitare che il load balancer tagli la connessione silenziosamente
      keepAlive: isTrue(process.env.DB_KEEP_ALIVE, true),
      keepAliveInitialDelayMillis: Number(process.env.DB_KEEP_ALIVE_INITIAL_DELAY) || 10000,

      // 3. Safety Guardrails (Prevengono query zombie)
      // Termina qualsiasi query che impiega più di X ms lato server PG
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT) || 60000,

      // Termina la query lato client se non risponde entro X ms (deve essere > statement_timeout)
      query_timeout: Number(process.env.DB_QUERY_TIMEOUT) || 65000,

      // Termina transazioni rimaste aperte ma inattive (es. dimenticato commit/rollback)
      idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TRANSACTION_TIMEOUT) || 30000
    },

    // --- SSL Config ---
    ssl: getSslConfig(),

    // --- Caching Strategy ---
    // Abilita la cache dei risultati delle query su tabella DB dedicata.
    // Richiede la creazione della tabella 'query_result_cache'.
    cache: {
      type: 'database',
      tableName: 'query_result_cache',
      duration: GLOBAL_CACHE_TTL || 60000 // Default 1 minuto se non specificato nella query
    }
  }
}
```

---

## 1.4 Variabili d'Ambiente (Reference)

Per far funzionare la configurazione di cui sopra, il file `.env` deve essere popolato correttamente. Ecco un template di riferimento per un ambiente di produzione.

```properties
# --- Server Basics ---
NODE_ENV=production
HOST=0.0.0.0
PORT=2230
APP_NAME=gerico-backend

# --- Database Connection ---
START_DB=true
DB_HOST=10.0.0.5
DB_PORT=5432
DB_NAME=gerico_prod
DB_USERNAME=admin
DB_PASSWORD=secret_complex_password

# --- Database Tuning (Advanced) ---
DB_SSL=true
DB_SSL_CA_PATH=/usr/src/app/certs/ca-certificate.crt
DB_SYNCHRONIZE=false
DB_LOGGING=false

# Pool sizing: Regolare in base alla CPU del DB e al numero di istanze del backend
# Se hai 2 istanze backend e il DB regge 100 conn, metti MAX=45 per istanza.
DB_MAX_CONNECTING=50
DB_MIN_CONNECTING=5

# Timeouts (in ms)
DB_CONNECTION_TIMEOUT=10000
DB_IDLE_TIMEOUT=30000
DB_STATEMENT_TIMEOUT=60000
DB_QUERY_TIMEOUT=65000
DB_LOCK_TIMEOUT=10000
DB_IDLE_TRANSACTION_TIMEOUT=30000

# KeepAlive
DB_KEEP_ALIVE=true
DB_KEEP_ALIVE_INITIAL_DELAY=10000
```

---

# Parte 2: Deep Dive Data Modeling & Entities

In `@volcanicminds/typeorm`, il Data Layer non è solo un mappatore di tabelle, ma il motore che abilita le "Magic Queries". Le entità devono essere definite seguendo pattern precisi per garantire che l'autodiscovery, la sicurezza e le performance funzionino correttamente.

## 2.1 Anatomia di un'Entità Volcanic

Tutte le entità **devono** estendere `BaseEntity` di TypeORM. Questo abilita il pattern **Active Record**, permettendo operazioni dirette come `User.save()` o `User.findOne()`, che sono fondamentali per la pulizia del codice nei Service.

### Struttura Base e Tipi PostgreSQL

Utilizziamo UUID v4 come chiave primaria standard per evitare enumerazione sequenziale e conflitti di merge in ambienti distribuiti.

```typescript
import {
  Entity,
  BaseEntity,
  PrimaryGeneratedColumn, // Generazione automatica (UUID, Serial)
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn, // Per Soft Delete
  Index,
  Unique
} from 'typeorm'

// Enum Typescript esportato per riuso
export enum UserRole {
  ADMIN = 'admin',
  USER = 'user'
}

@Entity() // Nome tabella derivato dalla classe (snake_case via NamingStrategy)
@Unique(['email']) // Vincolo di unicità a livello DB
@Index(['username', 'role']) // Indice composito per performance su query frequenti
export class User extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @CreateDateColumn()
  createdAt: Date

  @UpdateDateColumn()
  updatedAt: Date

  // Soft Delete: se presente, .delete() imposterà questa data invece di rimuovere il record
  @DeleteDateColumn()
  deletedAt: Date

  // --- Tipi di Colonna ---

  @Column({ type: 'varchar', length: 255, nullable: false })
  username: string

  @Column({ type: 'text', nullable: true }) // 'text' in PG non ha limiti di lunghezza
  bio: string

  @Column({ type: 'boolean', default: false })
  isActive: boolean

  @Column({ type: 'int', default: 0 })
  loginCount: number

  // --- Tipi Avanzati PostgreSQL ---

  // JSONB: Permette query performanti dentro il JSON (indicizzabile)
  @Column({ type: 'jsonb', nullable: true, default: {} })
  settings: Record<string, any>

  // Array nativi di Postgres
  @Column('text', { array: true, default: [] })
  tags: string[]

  // Enum nativo (mappato su stringa lato DB per flessibilità o enum PG)
  // Best Practice Volcanic: Usare 'varchar' o 'enum' controllando i valori via TS o Check Constraint
  @Column({
    type: 'enum',
    enum: UserRole,
    default: UserRole.USER
  })
  role: UserRole
}
```

---

## 2.2 Gestione Avanzata delle Relazioni

La gestione delle relazioni è dove molti progetti falliscono (Circular Dependency).
**Regola Aurea Volcanic:** Usare sempre le **stringhe** per riferirsi alle altre classi entità all'interno dei decoratori, mai la classe importata direttamente, a meno che non si usino `import type` per evitare cicli a runtime.

### One-to-One (`@OneToOne`)

Relazione 1:1. Una tabella deve possedere la chiave esterna (Owner Side).

**Esempio:** `User` (Identity) <-> `Professional` (Profile).
Vogliamo che `User` abbia un riferimento a `Professional`.

```typescript
// entities/user.e.ts
@Entity()
export class User extends BaseEntity {
  // ...

  // EAGER: TRUE => Carica sempre il professional quando carico lo user
  @OneToOne('Professional', { eager: true, nullable: true, cascade: true })
  @JoinColumn() // NECESSARIO sull'owner side (crea professional_id su user)
  professional: Professional
}

// entities/professional.e.ts
@Entity()
export class Professional extends BaseEntity {
  // ...

  // Lato inverso (opzionale, ma utile per navigare al contrario)
  @OneToOne('User', (user: User) => user.professional)
  user: User
}
```

### Many-to-One / One-to-Many

La relazione più comune. `ManyToOne` è il lato che "possiede" la chiave esterna.

**Esempio:** `Order` (Molti) -> `Client` (Uno).

```typescript
// entities/order.e.ts
@Entity()
export class Order extends BaseEntity {
  // ...

  // INDEX: Fondamentale sulle foreign key per performance di join
  @Index()
  @ManyToOne('Client', (client: Client) => client.orders, {
    nullable: false,
    onDelete: 'CASCADE' // Se il cliente viene cancellato, cancella gli ordini (DB Level)
  })
  @JoinColumn({ name: 'clientId' }) // Opzionale: forza il nome colonna
  client: Client
}

// entities/client.e.ts
@Entity()
export class Client extends BaseEntity {
  // ...

  // LAZY: TRUE => Restituisce una Promise.
  // Non carica gli ordini a meno che non vengano richiesti esplicitamente o acceduti.
  @OneToMany('Order', (order: Order) => order.client, { lazy: true })
  orders: Promise<Order[]>
}
```

### Many-to-Many

**Approccio Volcanic:** Preferire **sempre** una tabella di giunzione esplicita (Entity intermedia) rispetto alla `@ManyToMany` implicita, specialmente in progetti enterprise. Questo permette di aggiungere colonne alla relazione (es. `assignedAt`, `role`).

**Esempio Esplicito:** `User` <-> `UserGroup` (tramite `GroupMembership`).

```typescript
// entities/groupMembership.e.ts
@Entity()
export class GroupMembership extends BaseEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @ManyToOne('User', 'memberships')
  user: User

  @ManyToOne('UserGroup', 'members')
  group: UserGroup

  @CreateDateColumn()
  joinedAt: Date // Colonna extra impossibile con ManyToMany implicito
}
```

---

## 2.3 Opzioni delle Relazioni: Tuning Performance

Le opzioni passate ai decoratori determinano drasticamente le performance.

### `eager: true` vs `lazy: true`

- **`eager: true`**: Esegue una `LEFT JOIN` automatica ogni volta che l'entità principale viene caricata.
  - _Pro_: Dati pronti subito.
  - _Contro_: Se usato a catena, scarica l'intero database.
  - _Best Practice_: Usare solo per relazioni 1:1 o Many:1 critiche (es. `Order.Type`). **MAI** su `OneToMany` (es. `Client.Orders` eager ucciderebbe il server).
- **`lazy: true`**: Restituisce una `Promise`. TypeORM esegue una query separata quando si accede alla proprietà.
  - _Pro_: Entity leggera.
  - _Contro_: Problema N+1 se iterata in un ciclo.
  - _Best Practice_: Usare per le collezioni (`OneToMany`).

### `cascade`

Definisce se le operazioni di persistenza (`save`, `remove`) si propagano.

- `cascade: ['insert', 'update']`: Se salvo un `Order` con nuovi `WorkOrder` dentro, salva tutto in una transazione.
- `cascade: true`: Abilita tutto (incluso remove).

### `onDelete`

Definisce il comportamento a livello di Database (Foreign Key constraint).

- `CASCADE`: Cancella i figli se il padre muore. (es. Order -> OrderItems).
- `SET NULL`: Imposta a null (es. User -> Manager).
- `RESTRICT`: (Default) Impedisce la cancellazione del padre se ha figli.

---

## 2.4 Logica nelle Entità: Computed Fields & Hooks

Le entità non devono essere solo DTO anemici. Possono calcolare valori derivati che servono al frontend ma non esistono nel DB.

### Decoratore `@AfterLoad`

Metodo eseguito automaticamente dopo che TypeORM ha idratato l'oggetto dal DB.

**Esempio Reale (tratto da Gerico): Calcolo Ore**
Un'attività (`Activity`) ha delle ore pianificate (`expectedHours`) e delle ore fatte (`timesheets`).

```typescript
import { AfterLoad, OneToMany } from 'typeorm'

@Entity()
export class Activity extends BaseEntity {
  @Column({ type: 'float' })
  expectedHours: number

  // Relazione OneToMany con Timesheet
  @OneToMany('Timesheet', (ts: Timesheet) => ts.activity)
  timesheets: Promise<Timesheet[]> // o Timesheet[] se caricato via query builder

  // --- Virtual Properties (Non @Column) ---
  doneHours: number = 0
  deltaHours: number = 0
  status: 'safe' | 'overburn' = 'safe'

  @AfterLoad()
  calculateMetrics() {
    // Nota: this.timesheets è disponibile solo se la relazione è stata caricata (join)
    // Spesso 'doneHours' viene calcolato via subquery nel Service e assegnato qui.

    // Logica di calcolo
    this.deltaHours = (this.doneHours || 0) - (this.expectedHours || 0)

    if (this.doneHours > this.expectedHours) {
      this.status = 'overburn'
    }
  }
}
```

> **Nota Tecnica**: Quando si usa `executeFindQuery` o `QueryBuilder`, le _Virtual Properties_ non vengono popolate automaticamente se dipendono da dati non caricati. Spesso i Service usano `addSelect` per iniettare valori calcolati via SQL direttamente in queste proprietà virtuali (vedi `ActivityService` in Gerico).

---

## 2.5 Viste SQL e `@ViewEntity`

Per report, dashboard o aggregazioni complesse che richiederebbero troppe join o logiche SQL avanzate (Window Functions, Group By), utilizzare le Viste. `@volcanicminds/typeorm` tratta le viste esattamente come tabelle (read-only), permettendo di usare paginazione e filtri magici su di esse.

### 1. Creazione della Vista (Migration o SQL diretto)

Creare la vista sul DB:

```sql
CREATE VIEW planning_view AS
SELECT
  p.id as planning_id,
  a.id as activity_id,
  u.username as professional_name,
  (p.month_1 + p.month_2 + ...) as total_planned
FROM planning p
JOIN activity a ON p.activity_id = a.id
JOIN professional prof ON a.professional_id = prof.id
JOIN "user" u ON prof.user_id = u.id;
```

### 2. Definizione Entity

```typescript
import { ViewEntity, ViewColumn, BaseEntity } from 'typeorm'

// expression: opzionale, utile se si vuole che TypeORM sincronizzi la vista (sconsigliato in prod complessa)
@ViewEntity({
  name: 'planning_view',
  expression: `...SQL Definition...`
})
export class PlanningView extends BaseEntity {
  @ViewColumn()
  planningId: string

  @ViewColumn()
  activityId: string

  @ViewColumn()
  professionalName: string

  @ViewColumn()
  totalPlanned: number
}
```

### 3. Utilizzo

Questa vista ora supporta nativamente le query API:
`GET /api/plannings/view?professionalName:contains=Mario&totalPlanned:gt=100&sort=totalPlanned:desc`

---

# Parte 3: Magic Queries & Data Access

In un'architettura backend tradizionale, lo sviluppatore deve scrivere controller o repository che manualmente estraggono parametri (`req.query.search`), costruiscono condizioni (`WHERE name LIKE...`) e gestiscono paginazione/ordinamento.

Volcanic elimina questo strato. Il metodo `executeFindQuery` (e il sottostante `applyQuery`) funge da **traduttore universale** tra il linguaggio dell'API (URL/JSON) e il linguaggio del Database (SQL/TypeORM FindOptions).

---

## 3.1 Translation Layer: URL to SQL

Il cuore del sistema è la capacità di parsare le chiavi degli oggetti di input (query string o body) alla ricerca di **operatori suffissi**.

### Come funziona `executeFindQuery`

```typescript
import { executeFindQuery } from '@volcanicminds/typeorm'

// Esempio tipico dentro un Service o Controller
const result = await executeFindQuery(
  repository.users, // 1. Repository target
  { company: true, profile: true }, // 2. Relazioni (Join) da caricare
  req.data(), // 3. Input Data (contiene filtri, paginazione, sort)
  { isActive: true } // 4. Extra Where (filtri forzati/hardcoded)
)
```

Il flusso interno è:

1.  **Parsing**: Analizza `req.data()` separando i parametri riservati (`page`, `pageSize`, `sort`, `_logic`) dai filtri.
2.  **Mapping**: Trasforma ogni chiave filtro (es. `age:gt`) in un operatore TypeORM (es. `MoreThan(valore)`).
3.  **Validation**: Assicura che i campi esistano (se l'entità è tipizzata rigorosamente, altrimenti è permissivo).
4.  **Execution**: Esegue `findAndCount()` sul repository.
5.  **Formatting**: Restituisce `{ records: [], headers: { ... } }`.

### Tabella Completa degli Operatori

Questa tabella è il riferimento definitivo per costruire query dal frontend.

| Operatore     | Tipo Dato    | SQL (PostgreSQL) | Esempio URL                        | Esempio JSON Body               | Descrizione                                         |
| :------------ | :----------- | :--------------- | :--------------------------------- | :------------------------------ | :-------------------------------------------------- |
| **(nessuno)** | Any          | `=`              | `status=active`                    | `{ "status": "active" }`        | Uguaglianza esatta (Default).                       |
| `:eq`         | Any          | `=`              | `status:eq=active`                 | `{ "status:eq": "active" }`     | Esplicito per uguaglianza.                          |
| `:neq`        | Any          | `!=`             | `type:neq=guest`                   | `{ "type:neq": "guest" }`       | Diverso da.                                         |
| `:gt`         | Number/Date  | `>`              | `price:gt=100`                     | `{ "price:gt": 100 }`           | Maggiore di.                                        |
| `:ge`         | Number/Date  | `>=`             | `age:ge=18`                        | `{ "age:ge": 18 }`              | Maggiore o uguale.                                  |
| `:lt`         | Number/Date  | `<`              | `qty:lt=10`                        | `{ "qty:lt": 10 }`              | Minore di.                                          |
| `:le`         | Number/Date  | `<=`             | `qty:le=10`                        | `{ "qty:le": 10 }`              | Minore o uguale.                                    |
| `:like`       | String       | `LIKE`           | `code:like=A-%`                    | `{ "code:like": "A-%" }`        | Pattern matching Case Sensitive. Richiede `%`.      |
| `:likei`      | String       | `ILIKE`          | `email:likei=%@gmail%`             | `{ "email:likei": "%@gmail%" }` | Pattern matching Case Insensitive (PG only).        |
| `:contains`   | String       | `LIKE '%v%'`     | `name:contains=Rossi`              | `{ "name:contains": "Rossi" }`  | Contiene (Case Sensitive). Aggiunge `%` autom.      |
| `:containsi`  | String       | `ILIKE '%v%'`    | `desc:containsi=err`               | `{ "desc:containsi": "err" }`   | Contiene (Case Insensitive). Aggiunge `%` autom.    |
| `:starts`     | String       | `LIKE 'v%'`      | `sku:starts=XY`                    | `{ "sku:starts": "XY" }`        | Inizia con.                                         |
| `:startsi`    | String       | `ILIKE 'v%'`     | `user:startsi=adm`                 | `{ "user:startsi": "adm" }`     | Inizia con (Case Insensitive).                      |
| `:ends`       | String       | `LIKE '%v'`      | `file:ends=.pdf`                   | `{ "file:ends": ".pdf" }`       | Finisce con.                                        |
| `:endsi`      | String       | `ILIKE '%v'`     | `file:endsi=.PDF`                  | `{ "file:endsi": ".PDF" }`      | Finisce con (Case Insensitive).                     |
| `:in`         | Array/String | `IN (...)`       | `id:in=1,2,3`                      | `{ "id:in": [1, 2, 3] }`        | Incluso nella lista. URL: stringa CSV. Body: Array. |
| `:nin`        | Array/String | `NOT IN (...)`   | `role:nin=admin`                   | `{ "role:nin": ["admin"] }`     | Escluso dalla lista.                                |
| `:between`    | String       | `BETWEEN`        | `dt:between=2024-01-01:2024-02-01` | N/A                             | Range inclusivo. Separatore `:` obbligatorio.       |
| `:null`       | Boolean      | `IS NULL`        | `deleted:null=true`                | `{ "deleted:null": true }`      | `true` -> IS NULL. `false` -> IS NOT NULL.          |
| `:notNull`    | Boolean      | `IS NOT NULL`    | `uuid:notNull=true`                | `{ "uuid:notNull": true }`      | Alias per leggibilità.                              |

> **Nota Tecnica**: L'operatore `:raw` esiste ma è disabilitato di default o fortemente sconsigliato per prevenire SQL Injection dirette, a meno che l'input non sia sanitizzato lato server.

---

## 3.2 Filtri Relazionali (Deep Filtering)

TypeORM permette di filtrare basandosi sulle colonne delle tabelle unite (Join). Volcanic espone questa capacità tramite la **Dot Notation**.

**Requisito Fondamentale**: La relazione deve essere caricata. Se si filtra per `client.name`, il service deve aver fatto `leftJoinAndSelect('order.client', 'client')` o passato `{ client: true }` a `executeFindQuery`.

### Esempi Pratici

1.  **Filtro semplice su relazione diretta (ManyToOne)**

    - _Scenario_: Trova tutti gli Ordini del cliente "Acme Corp".
    - _URL_: `GET /orders?client.name:eq=Acme Corp`
    - _SQL_: `SELECT ... FROM order LEFT JOIN client ON ... WHERE client.name = 'Acme Corp'`

2.  **Filtro profondo (Nested Relations)**

    - _Scenario_: Trova le Attività fatte da Professionisti che lavorano per l'azienda "TechSolutions".
    - _Struttura_: Activity -> Professional -> Company (campo stringa su Professional).
    - _URL_: `GET /activities?professional.company:eq=TechSolutions`

3.  **Filtro su collezioni (OneToMany) - ATTENZIONE**
    - _Scenario_: Trova Clienti che hanno almeno un Ordine "Attivo".
    - _URL_: `GET /clients?orders.state:eq=active`
    - _Comportamento_: Questo funziona e genererà una `DISTINCT` implicita se gestita da TypeORM, ma su grandi volumi di dati può essere lento perché moltiplica le righe prima del filtro.
    - _Best Practice_: Per filtri "EXISTS" complessi su collezioni, preferire i Custom Filters nel Service (`qb.andWhere(subQuery)`).

---

## 3.3 Advanced Boolean Logic (`_logic`)

Di default, tutti i parametri nella query string sono combinati con l'operatore **AND**.
Esempio: `?status=active&type=vip` -> `WHERE status = 'active' AND type = 'vip'`.

Per logiche **OR** o raggruppamenti misti, si usa il parametro speciale `_logic`.

### Sintassi

1.  **Definizione Filtri con Alias**: Aggiungere `[alias]` alla fine della chiave filtro. L'alias deve essere alfanumerico univoco nella richiesta.
2.  **Costruzione Logica**: Scrivere l'espressione booleana nel parametro `_logic` usando gli alias, `AND`, `OR` e parentesi `()`.

### Caso d'Uso Complesso: Dashboard di Monitoraggio

Immaginiamo una dashboard che deve mostrare:

- Ordini **Urgenti** (Priority > 8)
- **OPPURE** Ordini **Scaduti** (DueDate < Oggi e Status != Closed)

**Costruzione della Request:**

1.  Filtro Urgente: `priority:gt[urgent]=8`
2.  Filtro Scaduto (Data): `dueDate:lt[late]=2023-12-31`
3.  Filtro Scaduto (Stato): `status:neq[open]=closed`
4.  Logica: `_logic=urgent OR (late AND open)`

**URL Finale:**

```
GET /orders?priority:gt[urgent]=8&dueDate:lt[late]=2023-12-31&status:neq[open]=closed&_logic=urgent OR (late AND open)
```

**SQL Generato (Concettuale):**

```sql
WHERE
  (order.priority > 8)
  OR
  (order.due_date < '2023-12-31' AND order.status != 'closed')
```

---

## 3.4 Paginazione e Ordinamento

Volcanic impone standard rigidi per garantire che ogni endpoint di lista si comporti allo stesso modo.

### Input Parameters

- **`page`** (number):
  - Indice della pagina, base 1.
  - `page=1` restituisce i primi N record.
  - Se omesso, default a 1.
- **`pageSize`** (number):
  - Numero di record per pagina.
  - Default framework: 25.
  - Se `pageSize=0` o negativo (se permesso dalla config), potrebbe tentare di scaricare tutto (sconsigliato).
- **`sort`** (string | array):
  - Sintassi: `campo` (ascendente implicito), `campo:asc`, `campo:desc`.
  - Esempio Multiplo: `?sort=priority:desc&sort=createdAt:asc`.
  - Ordinamento Relazionale: `?sort=client.name:asc` (Ordina per nome cliente).

### Response Headers (Output)

Per mantenere il body pulito (solo array dati), i metadati sono negli header HTTP. Il frontend deve leggerli per costruire la UI di paginazione.

- **`v-page`**: La pagina attuale (es. "1").
- **`v-pageSize`**: Il limite applicato (es. "25").
- **`v-count`**: Il numero di record in _questa_ pagina (es. "25" o meno se ultima pagina).
- **`v-total`**: Il conteggio totale dei record che soddisfano i filtri (es. "1450"). Fondamentale per calcolare il numero di pagine.
- **`v-pageCount`**: Numero totale pagine (Math.ceil(total / pageSize)).

### Esempio JSON Response (Controller)

```json
// GET /users?page=1&pageSize=2
// Headers: v-total: 50, v-page: 1 ...

[
  { "id": "uuid-1", "username": "mario" },
  { "id": "uuid-2", "username": "luigi" }
]
```

### Nota sulle Performance (`count`)

Calcolare `v-total` richiede una query `COUNT(*)` separata. Su tabelle con milioni di righe e filtri complessi, questo può essere lento.

- **Ottimizzazione**: Se il frontend non ha bisogno del totale esatto (es. infinite scroll), si può implementare una versione "light" di `executeFindQuery` che non esegue il count, o usare una stima. Nel framework standard, il count è sempre eseguito per coerenza.

---

# Parte 4: API Layer (Routing & Controllers)

In Volcanic Backend, l'API Layer è progettato per essere estremamente dichiarativo. Non si scrivono manualmente `server.get('/path', ...)` in un unico file gigante. Invece, si definiscono moduli funzionali dove il routing è dedotto dalla struttura dei file e dalla configurazione.

---

## 4.1 Autodiscovery delle Rotte

Il sistema di caricamento (`loader/router.ts`) scansiona la cartella `src/api` all'avvio.

### La Regola del Matching

Il loader cerca pattern del tipo: `src/api/[module_name]/routes.ts`.
Il nome della cartella (`[module_name]`) diventa il prefisso dell'URL per tutte le rotte definite in quel file.

**Esempio:**

- File: `src/api/users/routes.ts`
- Rotta definita: `path: '/details'`
- URL Risultante: `/users/details`

- File: `src/api/orders/v2/routes.ts` (Nidificato)
- Rotta definita: `path: '/'`
- URL Risultante: `/orders/v2/`

---

## 4.2 Configurazione `routes.ts`

Ogni modulo API deve esporre un oggetto di default conforme all'interfaccia `RouteConfig`. Questo file è la "Single Source of Truth" per il comportamento dell'endpoint, la sicurezza e la documentazione.

### Struttura del File

```typescript
import { roles } from '../../config/roles.js' // Import dei ruoli

export default {
  // Configurazione Globale del Modulo (applicata a tutte le rotte se non sovrascritta)
  config: {
    title: 'Orders API', // Swagger Tag Group
    description: 'Gestione degli ordini',
    controller: 'controller', // Cartella dove cercare i file controller (default: 'controller')
    tags: ['orders'], // Tag per raggruppamento Swagger
    enable: true // Master switch per disabilitare intero modulo
  },

  // Array delle Rotte
  routes: [
    {
      method: 'GET', // HTTP Verb: GET, POST, PUT, DELETE, PATCH
      path: '/:id', // Path relativo (diventa /orders/:id)

      // Security Layer
      roles: [roles.admin, roles.manager], // RBAC: Solo Admin o Manager
      middlewares: ['global.isAuthenticated'], // Hooks pre-handler (es. check JWT)

      // Mapping Handler
      // Sintassi: 'filename.functionName'
      // Cerca in src/api/orders/controller/order.ts la funzione findOne
      handler: 'order.findOne',

      // Configurazione Specifica e Swagger Doc
      config: {
        title: 'Get Order Detail', // Swagger Summary
        description: 'Recupera un ordine per ID',

        // JSON Schema References (Validazione Fastify + Swagger)
        // I nomi con # si riferiscono a schemi caricati globalmente
        params: { $ref: 'globalParamsSchema#' },
        response: {
          200: {
            description: 'Success',
            $ref: 'orderSchema#'
          },
          404: { description: 'Not Found' }
        }
      }
    }
    // ... altre rotte
  ]
}
```

### Parametri Chiave

- **`handler`**: La stringa magica `'file.metodo'`. Il framework cercherà il file `.ts` (o `.js`) nella cartella `controller` del modulo corrente.
- **`roles`**: Array di ruoli ammessi. Se l'utente non ha uno di questi ruoli, riceve `403 Forbidden` automatico. Se l'array è vuoto `[]`, la rotta è pubblica (a meno che non ci siano middleware che forzano auth).
- **`middlewares`**: Stringhe che puntano a funzioni in `src/middleware` o `lib/middleware`.
  - `global.isAuthenticated`: Verifica la presenza e validità del JWT.
  - `global.isAdmin`: Shortcut per verificare ruolo admin.
- **`rateLimit`**: (Opzionale) Sovrascrive i limiti globali per questa rotta specifica.
  ```typescript
  rateLimit: {
    max: 5,
    timeWindow: '1 minute'
  }
  ```

---

## 4.3 Controllers: Best Practices

I controller in Volcanic sono adattatori. Non devono contenere logica di business.

### La Firma Standard

Ogni handler deve essere una funzione asincrona che accetta `FastifyRequest` e `FastifyReply`.

```typescript
import { FastifyReply, FastifyRequest } from '@volcanicminds/backend'
import { orderService } from '../../../services/order.service.js'

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  // ... implementation
}
```

### 1. Normalizzazione Input (`req.data()`)

Non accedere mai direttamente a `req.body` o `req.query` se non per casi specifici (es. upload file raw).
Usa `req.data()` che unifica entrambi, dando priorità al body se presente.

```typescript
const data = req.data() // { id: '...', status: 'active', ... }
```

### 2. Parametri di Percorso (`req.parameters()`)

Per accedere ai parametri definiti nell'URL (es. `/:id`), usa l'helper:

```typescript
const { id } = req.parameters()
```

### 3. Normalizzazione Relazioni (Il Pattern "Id-to-Object")

Quando si crea o aggiorna un'entità che ha relazioni (es. `Order` ha un `Client`), il frontend spesso invia solo l'ID stringa (`clientId: "uuid"`). TypeORM però si aspetta un oggetto parziale `{ id: "uuid" }` per fare il link correttamente senza query aggiuntive.

**Best Practice nel Controller (Create/Update):**

```typescript
export async function create(req: FastifyRequest, reply: FastifyReply) {
  // 1. Estrai dati
  const { id: _ignore, ...payload } = req.data()

  // 2. Normalizza Relazioni (String -> Object)
  // Questo permette a TypeORM di salvare la FK 'client_id' direttamente
  if (payload.client && typeof payload.client === 'string') {
    payload.client = { id: payload.client }
  }

  if (payload.category && typeof payload.category === 'string') {
    payload.category = { code: payload.category }
  }

  // 3. Passa al Service (Context + Payload pulito)
  const result = await orderService.create(req.userContext, payload)

  // 4. Risposta
  return result
}
```

### 4. Gestione Errori e Status Code

Non usare `try-catch` per ogni cosa. Lascia che gli errori "bubblino" su. Il framework ha un error handler globale che cattura le eccezioni e formatta la risposta JSON.

- Per errori di validazione input -> `reply.status(400).send(...)`
- Per record non trovati -> `reply.status(404).send()`
- Per permessi negati logici -> `reply.status(403).send(...)`

```typescript
export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) return reply.status(400).send('Missing ID')

  try {
    const updated = await orderService.update(req.userContext, id, req.data())
    return updated
  } catch (err) {
    // Gestione specifica se necessario, altrimenti throw
    if (err.message === 'Access denied') {
      return reply.status(403).send(err.message)
    }
    throw err
  }
}
```

### 5. Accesso al Contesto Utente

Il middleware di auth popola `req.userContext`. Questo è l'oggetto fondamentale da passare al Service.

```typescript
// types/index.d.ts definisce questa struttura
interface UserContext {
  userId: string
  role: 'admin' | 'manager' | 'user'
  company?: string
  professionalId?: string
}

// Controller
const ctx = req.userContext
await service.doSomething(ctx, data)
```

---

# Parte 5: Service Layer Architecture

In Volcanic, il Service Layer non è solo una collezione di funzioni. È un layer strutturato che **deve** implementare la sicurezza a livello di riga (Row Level Security - RLS) e astrarre la complessità del database.

## 5.1 Il Pattern `BaseService`

Per evitare di riscrivere infinite volte `repository.find()`, creiamo una classe astratta `BaseService`. Questa classe funge da wrapper intelligente intorno al Repository TypeORM, iniettando automaticamente la logica di permissioning e le "Magic Queries".

### Implementazione della Classe Astratta

Creare il file `src/services/base.service.ts`.

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
   * Ogni servizio concreto DEVE implementare questo metodo.
   * Qui si definiscono le regole "Chi può vedere cosa".
   */
  protected abstract applyPermissions(qb: SelectQueryBuilder<T>, ctx: UserContext, alias: string): SelectQueryBuilder<T>

  /**
   * RELATIONS HOOK
   * Definisce quali join fare di default.
   */
  protected addRelations(qb: SelectQueryBuilder<T>, _alias: string): SelectQueryBuilder<T> {
    return qb
  }

  /**
   * CUSTOM FILTERS HOOK
   * Permette di intercettare parametri custom che non sono campi DB
   * (es. full-text search complessa).
   */
  protected applyCustomFilters(qb: SelectQueryBuilder<T>, queryParams: any, _alias: string): any {
    return queryParams
  }

  protected createQueryBuilder(alias: string): SelectQueryBuilder<T> {
    return this.repository.createQueryBuilder(alias)
  }

  // --- STANDARD CRUD METHODS ---

  /**
   * Trova molti record con filtri, paginazione, sort e permessi.
   */
  async findAll(ctx: UserContext, queryParams: any = {}): Promise<{ headers: any; records: T[] }> {
    const alias = this.repository.metadata.tableName
    let qb = this.createQueryBuilder(alias)

    // 1. Applica Relazioni (Join)
    qb = this.addRelations(qb, alias)

    // 2. Applica Sicurezza (RLS)
    qb = this.applyPermissions(qb, ctx, alias)

    // 3. Applica Filtri Custom e Standard
    const paramsToProcess = this.applyCustomFilters(qb, { ...queryParams }, alias)

    // (Qui viene invocata la logica interna per il parsing degli operatori :eq, :gt ecc.
    //  che abbiamo visto nella Parte 3, integrata nel BaseService)
    this.applyStandardFilters(qb, paramsToProcess, alias)

    // 4. Caching (se abilitato per l'entità)
    if (this.cacheTTL > 0) {
      qb.cache(this.cacheTTL)
    }

    // 5. Paginazione & Sort
    if (paramsToProcess.page && paramsToProcess.pageSize) {
      const page = parseInt(paramsToProcess.page) || 1
      const pageSize = parseInt(paramsToProcess.pageSize) || 25
      qb.skip((page - 1) * pageSize).take(pageSize)
    }
    // ... logica sort ...

    const [records, total] = await qb.getManyAndCount()

    // 6. Costruzione Headers
    const headers = {
      'v-count': records.length,
      'v-total': total,
      'v-page': paramsToProcess.page || 1
      // ...
    }

    return { headers, records }
  }

  async findOne(ctx: UserContext, id: string): Promise<T | null> {
    const alias = this.repository.metadata.tableName
    let qb = this.createQueryBuilder(alias)

    qb = this.addRelations(qb, alias)

    // CRUCIALE: Anche la findOne applica i permessi!
    // Se un utente chiede un ID che esiste ma non è suo, riceverà NULL (404/403 logico).
    qb = this.applyPermissions(qb, ctx, alias)

    qb.andWhere(`${alias}.id = :id`, { id })

    return qb.getOne()
  }

  // Metodo helper interno per parsing operatori (semplificato per brevità)
  private applyStandardFilters(qb: SelectQueryBuilder<T>, params: any, alias: string) {
    // ... logica switch operatori (:eq, :like, etc) ...
  }
}
```

---

## 5.2 Security Context & RLS (Row Level Security)

L'implementazione di `applyPermissions` è il punto più critico per la sicurezza dei dati.

### Esempio Reale: `OrderService`

Immaginiamo un sistema multi-tenant dove:

- **Admin**: Vede tutto.
- **Manager**: Vede solo gli ordini della sua azienda (`company`).
- **User**: Vede solo gli ordini dove ha lavorato (tramite `Activity`).

```typescript
import { SelectQueryBuilder } from 'typeorm'
import { BaseService } from './base.service.js'
import { Order } from '../entities/order.e.js'
import { UserContext } from '../../types/index.js'

export class OrderService extends BaseService<Order> {
  constructor() {
    // repository.orders è iniettato globalmente all'avvio
    super(repository.orders)
  }

  // Definisce le JOIN standard per evitare N+1 quando si serializza
  protected addRelations(qb: SelectQueryBuilder<Order>, alias: string): SelectQueryBuilder<Order> {
    return qb.leftJoinAndSelect(`${alias}.client`, 'client').leftJoinAndSelect(`${alias}.items`, 'items')
  }

  // IMPLEMENTAZIONE SICUREZZA
  protected applyPermissions(
    qb: SelectQueryBuilder<Order>,
    ctx: UserContext,
    alias: string
  ): SelectQueryBuilder<Order> {
    // 1. ADMIN: Accesso Totale
    if (ctx.role === 'admin') {
      return qb
    }

    // 2. MANAGER: Filtro per Company
    if (ctx.role === 'manager') {
      if (!ctx.company) {
        // Fail-safe: se manager non ha company, non vede nulla
        qb.andWhere('1=0')
        return qb
      }
      qb.andWhere(`${alias}.company = :company`, { company: ctx.company })
      return qb
    }

    // 3. USER: Filtro per Assegnazione (Complex Join)
    if (ctx.role === 'user') {
      if (!ctx.professionalId) {
        qb.andWhere('1=0')
        return qb
      }

      // Deve appartenere alla company
      qb.andWhere(`${alias}.company = :company`, { company: ctx.company })

      // E l'utente deve averci lavorato (EXISTS subquery è molto più veloce di una JOIN filtrante)
      qb.andWhere(
        (subQb) => {
          const subQuery = subQb
            .subQuery()
            .select('1')
            .from('work_order', 'wo')
            .innerJoin('activity', 'a', 'a.workOrderId = wo.id')
            .where(`wo.orderId = ${alias}.id`) // Correlazione con query esterna
            .andWhere('a.professionalId = :profId')
            .getQuery()
          return `EXISTS ${subQuery}`
        },
        { profId: ctx.professionalId }
      )

      return qb
    }

    // Default Deny: Se il ruolo non è riconosciuto, blocca tutto.
    qb.andWhere('1=0')
    return qb
  }
}

export const orderService = new OrderService()
```

---

## 5.3 QueryBuilder Avanzato: Sub-queries e Campi Calcolati

Spesso le entità hanno bisogno di campi "virtuali" calcolati al volo, come somme o conteggi, che non sono colonne fisiche.

### Esempio: Calcolare `doneHours` in `Activity`

Un'attività ha molte righe di timesheet. Vogliamo caricare l'attività e, in un solo colpo, sapere la somma delle ore lavorate.

```typescript
// services/activity.service.ts

export class ActivityService extends BaseService<Activity> {
  protected addRelations(qb: SelectQueryBuilder<Activity>, alias: string): SelectQueryBuilder<Activity> {
    // Aggiungiamo una SELECT virtuale
    qb.addSelect((subQuery) => {
      return subQuery
        .select('COALESCE(SUM(t.logTime), 0)', 'doneHours') // Somma o 0
        .from('timesheet', 't')
        .where(`t.activityId = ${alias}.id`) // Correlazione
    }, 'Activity_doneHours')
    // Nota: 'Activity_doneHours' è la convenzione TypeORM interna.
    // TypeORM mapperà questo valore sulla proprietà 'doneHours' dell'entità
    // SE l'entità ha un campo @Column({ select: false }) o una proprietà virtuale.

    return qb
      .leftJoinAndSelect(`${alias}.professional`, 'professional')
      .leftJoinAndSelect(`${alias}.workOrder`, 'workOrder')
  }

  // ... applyPermissions ...
}
```

### Gestione Filtri Custom

A volte il frontend invia un parametro che non mappa 1:1 su una colonna, ma richiede logica.

```typescript
protected applyCustomFilters(qb: SelectQueryBuilder<Order>, queryParams: any, alias: string): any {

    // Parametro speciale "isOverdue"
    if (queryParams.isOverdue === 'true') {
        qb.andWhere(`${alias}.dueDate < NOW()`)
        qb.andWhere(`${alias}.status != 'CLOSED'`)

        // Rimuoviamo il parametro per non farlo processare dal parser standard
        delete queryParams.isOverdue
    }

    // Ricerca full-text su più campi (Global Search)
    if (queryParams.q) {
        qb.andWhere(new Brackets(sqb => {
            sqb.where(`${alias}.code ILIKE :q`, { q: `%${queryParams.q}%` })
               .orWhere(`${alias}.note ILIKE :q`, { q: `%${queryParams.q}%` })
               // Se la relazione 'client' è joinata:
               .orWhere(`client.name ILIKE :q`, { q: `%${queryParams.q}%` })
        }))
        delete queryParams.q
    }

    return queryParams
}
```

---

## 5.4 Caching (Opzionale ma Potente)

Per dati "lenti a cambiare" (es. Tabelle di configurazione, Tipi Ordine, Stati), il `BaseService` supporta il caching integrato.

```typescript
import { STATIC_CACHE_TTL } from '../config/constants.js'

export class OrderTypeService extends BaseService<OrderType> {
  constructor() {
    super(repository.ordertypes)
    this.cacheTTL = STATIC_CACHE_TTL // es. 15 minuti (in ms)
  }

  // ...
}
```

Quando `cacheTTL > 0`, TypeORM:

1.  Genera un hash della query SQL + parametri.
2.  Cerca nella tabella `query_result_cache`.
3.  Se trova un risultato valido (non scaduto), lo restituisce senza toccare le tabelle reali.
4.  Altrimenti esegue e salva.

**Attenzione**: L'invalidazione della cache in TypeORM standard è basata sul tempo o manuale. Se i dati cambiano spesso, non usare la cache query.

---

# Parte 6: Autenticazione e Sicurezza

Il framework utilizza un approccio **JWT (JSON Web Token) Stateless**. Questo significa che il server non mantiene sessioni in memoria, rendendo l'architettura scalabile orizzontalmente. Tuttavia, per garantire la sicurezza (revoca dei token, MFA), vengono impiegati meccanismi ibridi come il "Refresh Token" e il controllo di validità sul database (`blocked`, `version`).

## 6.1 Stack di Autenticazione (JWT Lifecycle)

L'autenticazione è gestita dal plugin `@fastify/jwt` integrato nel core di `@volcanicminds/backend`.

### Configurazione Env

Nel file `.env`, le seguenti variabili sono obbligatorie:

```properties
# Secret per firmare i token di accesso (breve durata, es. 15min - 1h)
JWT_SECRET=super_long_random_string_at_least_64_bytes
JWT_EXPIRES_IN=1h

# Refresh Token (lunga durata, es. 30gg - 180gg)
JWT_REFRESH=true
# Se non specificato, usa JWT_SECRET, ma è MEGLIO averne uno dedicato
JWT_REFRESH_SECRET=another_super_long_random_string
JWT_REFRESH_EXPIRES_IN=30d
```

### Ciclo di Vita

1.  **Login (`POST /auth/login`)**:

    - L'utente invia `email` e `password`.
    - Il server valida le credenziali tramite `bcrypt`.
    - Verifica che l'utente non sia `blocked` o `!confirmed`.
    - Genera un **Access Token** (breve) e un **Refresh Token** (lungo).
    - Restituisce entrambi al client.

2.  **Accesso API (`Authorization: Bearer <token>`)**:

    - Il client invia l'Access Token nell'header.
    - Il middleware `global.isAuthenticated` verifica la firma e la scadenza.
    - **Controllo Extra**: Opzionalmente, verifica che l'utente esista ancora nel DB e che il suo `externalId` non sia cambiato (vedi Invalidation).

3.  **Refresh (`POST /auth/refresh-token`)**:

    - Quando l'Access Token scade (401), il client invia il Refresh Token.
    - Il server verifica il Refresh Token.
    - Se valido, emette un _nuovo_ Access Token.

4.  **Invalidazione (Logout forzato)**:
    - Poiché i JWT sono stateless, non si possono "distruggere".
    - **Soluzione Volcanic**: Ogni utente ha un `externalId` (UUID o random string) nel DB. Questo ID è inserito nel payload del token (`sub`).
    - Per invalidare tutti i token di un utente (es. cambio password, furto account), il server rigenera il suo `externalId` nel database. Tutti i vecchi token, contenenti il vecchio ID, falliranno la verifica al prossimo accesso che richiede il controllo DB.

---

## 6.2 Role Based Access Control (RBAC)

La gestione dei ruoli è definita staticamente nel codice ma applicata dinamicamente.

### Definizione Ruoli (`src/config/roles.ts`)

```typescript
// src/config/roles.ts
export default [
  {
    code: 'public', // Ruolo base implicito
    name: 'Public',
    description: 'Utente non autenticato o base'
  },
  {
    code: 'admin',
    name: 'Admin',
    description: 'Super User con accesso completo'
  },
  {
    code: 'manager',
    name: 'Manager',
    description: 'Gestore di una singola Company'
  },
  {
    code: 'user', // Ruolo standard
    name: 'User',
    description: 'Operatore standard'
  }
]
```

### Protezione delle Rotte

Nel file `routes.ts`, l'array `roles` funge da gatekeeper.

```typescript
// Esempio: Solo Admin può cancellare
{
  method: 'DELETE',
  path: '/:id',
  handler: 'user.remove',
  roles: [roles.admin], // Gatekeeper
  middlewares: ['global.isAuthenticated'] // Pre-check validità token
}
```

### Logica nel Controller (Granularità Fine)

A volte il ruolo non basta (es. un Manager può modificare solo la _sua_ company). Questo controllo non si fa nelle rotte, ma nel Service (come visto in Parte 5). Tuttavia, il controller può usare helper per logiche UI o flow diversi.

```typescript
// Controller
if (req.hasRole(roles.admin)) {
  // Logica speciale admin
}
```

---

## 6.3 Multi-Factor Authentication (MFA)

Volcanic implementa un sistema MFA nativo (TOTP standard, compatibile con Google Authenticator), senza dipendere da provider esterni (Auth0, Cognito).

### Policy di Sicurezza

Configurabile in `src/config/general.ts` o via ENV `MFA_POLICY`.

1.  **OPTIONAL** (Default): L'utente decide se abilitarlo.
2.  **MANDATORY**: L'utente è obbligato a configurarlo al primo login. Fino a quel momento, non può accedere alle altre API.
3.  **ONE_WAY**: Facoltativo all'inizio, ma una volta abilitato non può essere disabilitato dall'utente (solo dall'admin).

### Il Flusso "Gatekeeper" (Pre-Auth Token)

Per gestire l'MFA in modo sicuro, il login non restituisce subito il token vero se l'MFA è richiesto.

1.  **Login (`POST /auth/login`)**:

    - Credenziali valide? Sì.
    - MFA attivo per l'utente? Sì.
    - **Risposta**: `202 Accepted`.
    - **Payload**: `{ tempToken: "...", mfaRequired: true }`.
    - **Nota**: Il `tempToken` ha un ruolo speciale `pre-auth-mfa` e dura solo 5 minuti.

2.  **Middleware Guard (`hooks/onRequest.ts`)**:

    - Se il token presentato ha ruolo `pre-auth-mfa`, il framework blocca **qualsiasi** richiesta verso API standard (es. `/users`, `/orders`).
    - Permette solo le rotte in whitelist: `/auth/mfa/verify`, `/auth/mfa/setup`.

3.  **Verifica (`POST /auth/mfa/verify`)**:
    - Client invia `tempToken` (header) + Codice TOTP (body).
    - Server valida TOTP.
    - **Risposta**: `200 OK` con il vero `accessToken` e `refreshToken` (ruolo `user`/`admin`).

### Implementazione Tecnica

Il modulo `@volcanicminds/tools/mfa` fornisce le primitive crittografiche.

```typescript
// Esempio logica di verifica (semplificata dal controller auth)
import { mfa } from '@volcanicminds/tools'

// 1. Recupera segreto cifrato dal DB
const encryptedSecret = user.mfaSecret
const secret = decrypt(encryptedSecret) // Decifra (AES-256)

// 2. Verifica token
const isValid = mfa.verifyToken(inputToken, secret)

if (isValid) {
  // Emetti token finale
}
```

### Emergency Reset (Admin Backdoor)

Se l'admin perde il dispositivo MFA e non può più entrare, il sistema prevede una procedura di emergenza basata su variabili d'ambiente (da usare con estrema cautela).

1.  Impostare ENV:
    - `MFA_ADMIN_FORCED_RESET_EMAIL=admin@example.com`
    - `MFA_ADMIN_FORCED_RESET_UNTIL=2025-12-31T12:00:00Z` (Max 10 minuti nel futuro rispetto all'avvio server).
2.  Riavviare il server.
3.  All'avvio, il sistema rileva le variabili, verifica il timestamp, e disabilita forzatamente l'MFA per quell'utente.
4.  L'admin fa login solo con password.
5.  **IMPORTANTE**: Rimuovere le variabili e riavviare.

---

## 6.4 TypeScript Augmentation

Per lavorare con `req.user` o `req.userContext` senza errori di compilazione, è necessario estendere i tipi di Fastify.

File: `types/index.d.ts` (deve essere incluso in `tsconfig.json`).

```typescript
import { FastifyRequest as _FastifyRequest } from 'fastify'

// 1. Definiamo la struttura del contesto utente
export interface UserContext {
  userId: string | null
  role: 'admin' | 'manager' | 'user' | 'public'
  // Campi custom specifici dell'app
  company?: string
  professionalId?: string
}

// 2. Estendiamo l'interfaccia base di Fastify
declare module 'fastify' {
  export interface FastifyRequest {
    userContext: UserContext // Iniettato dal hook preHandler
    // user e token sono già gestiti da @volcanicminds/backend, ma si possono tipizzare meglio qui
  }
}

// 3. Estendiamo il Global Scope per i repository (opzionale ma comodo)
declare global {
  // Rende 'log' visibile ovunque senza import
  var log: any
  // Rende i repository accessibili globalmente (es. repository.users)
  var repository: any
}

export {}
```

---

# Parte 7: Validazione, Utilities, Scheduler e Testing

Un backend enterprise non si limita a salvare dati. Deve garantire che i dati siano validi (Schema Validation), comunicare con l'esterno (Mailer), eseguire operazioni ricorrenti (Scheduler), tracciare chi fa cosa (Audit Log) e dimostrare di funzionare (Testing).

---

## 7.1 Validazione JSON Schema e Schema Overriding

Il framework utilizza **Fastify** per la validazione, che si basa su **JSON Schema** (draft-7). Questo garantisce prestazioni elevatissime e genera automaticamente la documentazione Swagger.

### Definizione degli Schemi (`src/schemas/*.ts`)

Gli schemi sono definiti in file TypeScript/JavaScript e caricati all'avvio. Ogni schema deve avere un `$id` univoco.

```typescript
// src/schemas/product.ts

// Schema per il corpo della richiesta (POST/PUT)
export const productBodySchema = {
  $id: 'productBodySchema', // ID Univoco
  type: 'object',
  required: ['name', 'sku', 'price'], // Campi obbligatori
  properties: {
    name: { type: 'string', minLength: 3 },
    sku: { type: 'string', pattern: '^[A-Z0-9-]{5,10}$' }, // Regex validation
    price: { type: 'number', minimum: 0 },
    tags: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10
    }
  },
  additionalProperties: false // Rifiuta campi non definiti (Best Practice sicurezza)
}

// Schema per la risposta (Output Serialization)
export const productResponseSchema = {
  $id: 'productResponseSchema',
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    // Price non incluso qui? Allora non verrà inviato al client (Field Filtering)
    createdAt: { type: 'string', format: 'date-time' }
  }
}
```

### Schema Overriding (Funzionalità Core)

`@volcanicminds/backend` fornisce schemi predefiniti (es. per Login, Registrazione). Spesso è necessario estenderli (es. aggiungere `companyId` alla risposta del login) senza modificare il codice della libreria.

Il loader degli schemi implementa un **Deep Merge intelligente** basato sull'`$id`.

1.  **Individuare l'ID**: Trovare l'ID dello schema base (es. `authLoginResponseSchema` in `lib/schemas/auth.ts`).
2.  **Creare l'Override**: Creare un file in `src/schemas/auth_override.ts` con lo stesso `$id`.
3.  **Definire le Differenze**: Inserire solo i campi nuovi o modificati.

**Esempio Pratico:**

```typescript
// src/schemas/user.ts

// Stesso $id dello schema nativo del framework
export const authLoginResponseSchema = {
  $id: 'authLoginResponseSchema',
  type: 'object',
  nullable: true,
  properties: {
    // Aggiungiamo campi custom alla risposta del login
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    company: { type: 'string' },

    // Possiamo anche riferire altri schemi
    professionalProfile: { $ref: 'professionalSchema#' }
  }
  // Nota: 'token' e 'refreshToken' sono ereditati dallo schema base
}
```

Al boot, il framework fonderà le due definizioni.

---

## 7.2 Utilities Core (`@volcanicminds/tools`)

Il pacchetto tools fornisce utility ottimizzate.

### Logging Strutturato (Pino Wrapper)

L'oggetto globale `log` è disponibile ovunque. È configurato per essere performante: controlla il livello di log _prima_ di eseguire l'interpolazione delle stringhe.

**Livelli e Utilizzo:**

```typescript
// Uso corretto: Short-circuiting per performance
// Se il livello 'info' non è attivo, la stringa non viene nemmeno costruita.
if (log.i) log.info(`Order ${orderId} processed in ${elapsed}ms`)

// Errori con stack trace
if (log.e) log.error({ err: errorObject }, 'Critical failure in payment gateway')

// Debug verbose
if (log.d) log.debug('Payload received:', JSON.stringify(data))
```

Configurazione (`.env`):

- `LOG_LEVEL`: `trace` | `debug` | `info` | `warn` | `error` | `fatal`
- `LOG_COLORIZE`: `true` (dev) | `false` (prod, per log aggregators come ELK/Datadog).

### Mailer (Nodemailer Wrapper)

Una classe wrapper che semplifica la gestione delle email, gestendo automaticamente la conversione HTML-to-Text se mancante.

```typescript
import { Mailer } from '@volcanicminds/tools/mailer'

// Configurazione (spesso in un service singleton)
const mailer = new Mailer({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  defaultFrom: '"No Reply" <noreply@myapp.com>'
})

// Utilizzo
await mailer.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  // Genera automaticamente la versione text plain rimuovendo i tag HTML
  html: '<h1>Hello</h1><p>Welcome to our platform.</p>'
})
```

---

## 7.3 Job Scheduler

Il framework integra un sistema di scheduling (basato su `toad-scheduler`) per eseguire task ricorrenti (pulizia token, invio report, sync dati).

### Abilitazione

In `src/config/general.ts`, impostare `scheduler: true`.

### Creazione di un Job (`src/schedules/*.job.ts`)

Ogni file in questa cartella viene caricato automaticamente. Deve esportare una configurazione `schedule` e una funzione `job`.

**Esempio: Pulizia Log ogni notte**

```typescript
import { JobSchedule } from '@volcanicminds/backend'

// Configurazione
export const schedule: JobSchedule = {
  active: true, // Master switch
  async: true, // Il task è una Promise?
  preventOverrun: true, // Se il task precedente non è finito, salta il prossimo tick

  // Modalità 1: CRON (Consigliata per orari precisi)
  type: 'cron',
  cron: {
    expression: '0 3 * * *', // Ogni notte alle 03:00
    timezone: 'Europe/Rome'
  }

  /* Modalità 2: INTERVAL (Per task frequenti)
  type: 'interval',
  interval: {
    seconds: 30,
    runImmediately: true
  }
  */
}

// Logica
export async function job() {
  log.info('Starting nightly cleanup...')
  await repository.logs.delete({ createdAt: LessThan(thirtyDaysAgo) })
  log.info('Cleanup finished.')
}
```

---

## 7.4 Audit Tracking (Tracciamento Modifiche)

Volcanic include un sistema "magico" per tracciare le modifiche alle entità (chi ha cambiato cosa, vecchio valore vs nuovo valore) senza sporcare i controller.

### Configurazione (`src/config/tracking.ts`)

```typescript
export default {
  config: {
    enableAll: false, // Se true, traccia tutto (sconsigliato per performance)
    changeEntity: 'Change', // Nome dell'entità dove salvare i log (deve esistere in entities/)
    primaryKey: 'id'
  },
  changes: [
    {
      enable: true,
      method: 'PUT', // Traccia solo gli update
      path: '/users/:id', // Rotta specifica (matching esatto o pattern)
      entity: 'User', // Entità di riferimento per recuperare i dati vecchi

      // Filtri sui campi
      fields: {
        includes: ['email', 'role', 'status'], // Traccia solo questi
        excludes: ['updatedAt', 'lastLogin'] // Ignora questi
      }
    }
  ]
}
```

### Funzionamento

1.  **Pre-Handler**: Se la rotta è tracciata, il framework legge lo stato attuale del record dal DB (`oldData`) e lo salva nella richiesta.
2.  **Controller**: Esegue l'update.
3.  **Pre-Serialization (Post-Handler)**: Il framework confronta il payload di input con `oldData`.
4.  **Salvataggio**: Se ci sono differenze, scrive un record nella tabella `change` (JSONB con il delta).

---

## 7.5 Strategie di Testing

Un backend enterprise richiede test automatizzati. La struttura consigliata è:

- **Unit Test (`test/unit`)**: Testano funzioni pure, utility e servizi mockando il DB.
- **E2E / Integration Test (`test/e2e`)**: Testano l'intero stack (Route -> Controller -> Service -> DB).

### Setup dell'Ambiente di Test

Per i test E2E, è cruciale non usare il DB di produzione.

1.  **In-Memory DB**: `@volcanicminds/typeorm` supporta driver come `sqlite` in memoria o `pg-mem` per emulare Postgres.
2.  **Container dedicato**: La soluzione migliore è uno script che alza un container Docker Postgres pulito per i test.

### Esempio Test E2E (Mocha + Axios)

```typescript
import { expect } from 'expect'
import { login, get, post } from '../common/api.js' // Helper wrapper di Axios

describe('Order API', () => {
  let token = ''

  before(async () => {
    // Login come Admin per ottenere il token
    const auth = await login('admin@example.com', 'password')
    token = auth.token
  })

  it('should create a new order', async () => {
    const payload = {
      client: 'client-uuid',
      amount: 150.0,
      status: 'pending'
    }

    const response = await post('/orders', payload, {
      headers: { Authorization: `Bearer ${token}` }
    })

    expect(response.id).toBeDefined()
    expect(response.status).toBe('pending')
  })

  it('should list orders with pagination', async () => {
    const { data, headers } = await get('/orders?page=1&pageSize=10')

    expect(Array.isArray(data)).toBe(true)
    expect(headers['v-total']).toBeDefined()
  })
})
```

---

# Parte 8: System Administration e Deployment

Questa sezione trascende il codice TypeScript e si occupa del "ferro": come portare il backend in produzione in modo sicuro, performante e resiliente.

## 8.1 Hardening del Server (Ubuntu)

Prima di installare qualsiasi applicazione, il server deve essere messo in sicurezza.

### Configurazione Firewall (UFW)

Configurazione "Deny by Default". Si apre solo ciò che serve.

```bash
# 1. Policy di base: Blocca tutto in ingresso, consenti tutto in uscita
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 2. CRUCIALE: Consenti SSH (altrimenti ti chiudi fuori)
sudo ufw allow OpenSSH

# 3. Consenti traffico Web (Gestito da Nginx)
sudo ufw allow 'Nginx Full'

# 4. Attiva il firewall
sudo ufw enable
```

### Installazione Stack Base

Installazione di Nginx e Certbot per la gestione SSL automatica.

```bash
sudo apt update
sudo apt install nginx certbot python3-certbot-nginx -y
sudo systemctl status nginx
```

---

## 8.2 Nginx: Reverse Proxy & Security Gateway

Nginx non serve solo a girare le richieste. Agisce come **WAF (Web Application Firewall)** di base, terminatore SSL e gestore del Rate Limiting.

### Configurazione (`/etc/nginx/sites-available/gerico`)

```nginx
# --- 1. RATE LIMITING (Protezione DDoS/Bruteforce) ---
# Zona API: Max 10 richieste al secondo per IP.
# Protegge il backend Node.js (monothread) da saturazione CPU.
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

# Zona Generale: Protegge da esaurimento socket TCP.
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
    location /api/ {
        # Rate Limit Applicato: Max 10 req/s, burst (picco) fino a 20 senza delay
        limit_req zone=api_limit burst=20 nodelay;

        # Rewrite URL:
        # Il client chiama: https://dominio/api/auth/login
        # Il backend riceve: /auth/login
        rewrite ^/api/(.*) /$1 break;

        # Proxy verso Docker (Localhost porta 2230)
        proxy_pass http://127.0.0.1:2230;

        # Supporto WebSocket e KeepAlive
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;

        # IP Passthrough (Fondamentale per i log di sicurezza del backend e RateLimit interno)
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Attivazione

```bash
sudo ln -s /etc/nginx/sites-available/gerico /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default 2>/dev/null # Rimuovi default
sudo nginx -t # Verifica sintassi
sudo systemctl restart nginx
```

---

## 8.3 Docker Deployment Strategy

Il backend gira in un container Docker isolato. Usiamo `--network=host` o mapping porte esplicito per performance, ma qui mappiamo `127.0.0.1:2230` per evitare di esporre la porta 2230 sull'IP pubblico (bypassando UFW).

### File Environment (`.env.prod`)

Questo file deve risiedere sul server e **NON** nel repository.

```properties
# --- CORE ---
NODE_ENV=production
# Ascolta su tutte le interfacce interne al container
HOST=0.0.0.0
PORT=2230

# --- NODE MEMORY LIMIT ---
# Imposta il limite GC di Node.js per evitare OOM Kill del container.
# Setta a ~75-80% della RAM dedicata al container.
NODE_OPTIONS=--max-old-space-size=4096

# --- AUTH & SECURITY ---
# Generare con: openssl rand -base64 64
JWT_SECRET=<REPLACE_WITH_VERY_LONG_SECURE_STRING>
JWT_EXPIRES_IN=15d
JWT_REFRESH=true
JWT_REFRESH_SECRET=<REPLACE_WITH_DIFFERENT_SECURE_STRING>
JWT_REFRESH_EXPIRES_IN=180d

# --- DATABASE CONNECTION (OVH/AWS Example) ---
START_DB=true
DB_HOST=<DB_HOSTNAME_OR_IP>
DB_PORT=20184
DB_USERNAME=<DB_USER>
DB_PASSWORD=<DB_PASSWORD>
DB_NAME=<DB_NAME>

# --- DATABASE TUNING (Vedi Parte 1 della Guida) ---
DB_SSL=true
# Path interno al container (montato via volume)
DB_SSL_CA_PATH=/app/certs/ca.pem
DB_MAX_CONNECTING=50
DB_CONNECTION_TIMEOUT=60000
DB_SYNCHRONIZE_SCHEMA_AT_STARTUP=true

# --- LOGGING (Production Optimization) ---
# 'info' o 'warn' riduce I/O su disco/console drasticamente rispetto a 'trace'
LOG_LEVEL=info
LOG_COLORIZE=false
LOG_TIMESTAMP=true
```

### Comando di Avvio (Manuale o Script)

```bash
# 1. Build
docker build --network=host -t gerico-backend .

# 2. Stop & Remove
docker stop gerico-backend || true && docker rm gerico-backend || true

# 3. Run
# Nota su --add-host: Risolve problemi DNS interni in alcune infrastrutture Cloud (es. OVH Managed DB)
# dove il DNS del container non risolve l'hostname del DB privato.
docker run -d \
  --name gerico-backend \
  --restart always \
  -p 127.0.0.1:2230:2230 \
  --add-host <DB_HOSTNAME>:<DB_PRIVATE_IP> \
  -v /home/ubuntu/gerico/certs:/app/certs \
  --env-file /home/ubuntu/gerico/gerico-backend/.env.prod \
  gerico-backend
```

---

## 8.4 Continuous Deployment ("Poor Man's CI/CD")

Per progetti che non usano Kubernetes/Jenkins, un semplice script bash in crontab è estremamente efficace e resiliente per l'Auto-Update.

### Script `deploy.sh`

```bash
#!/bin/bash

# Configurazione
LOG_FILE="/home/ubuntu/gerico/deploy.log"
DIR_BE="/home/ubuntu/gerico/gerico-backend"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

cd "$DIR_BE" || exit

# Fetch senza merge per controllare aggiornamenti
git fetch origin main

LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" != "$REMOTE" ]; then
    log "🚀 Update found! ($LOCAL -> $REMOTE)"

    # 1. Scarica Codice
    git pull origin main

    # 2. Build Docker
    log "Building Docker Image..."
    docker build --network=host -t gerico-backend .

    if [ $? -eq 0 ]; then
        # 3. Restart Container (Solo se la build ha successo)
        log "Restarting Container..."
        docker stop gerico-backend || true && docker rm gerico-backend || true

        # Esegui comando di run (vedi sopra per parametri completi)
        docker run -d \
          --name gerico-backend \
          --restart always \
          -p 127.0.0.1:2230:2230 \
          -v /home/ubuntu/gerico/certs:/app/certs \
          --env-file /home/ubuntu/gerico/gerico-backend/.env.prod \
          gerico-backend

        log "✅ Backend updated successfully."

        # Pulizia immagini vecchie (risparmio spazio disco)
        docker image prune -f > /dev/null 2>&1
    else
        log "❌ Build Failed. Aborting restart."
        # Inviare notifica (mail/slack) qui se necessario
    fi
fi
```

### Automazione (Crontab)

Esegue il controllo ogni 30 minuti.

```bash
# crontab -e
0,30 * * * * /home/ubuntu/gerico/deploy.sh >> /home/ubuntu/cron_output.log 2>&1
```

---

## 8.5 Database Operations & Maintenance

### Estensioni Obbligatorie

Il framework usa `uuid` come primary key. Se il database è pulito, questa estensione deve essere attivata.

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Full Data Wipe (Reset script)

Utile in staging/dev. L'ordine di cancellazione è critico per via delle Foreign Keys.

```sql
-- Ordine inverso rispetto alle dipendenze
DELETE FROM "timesheet";
DELETE FROM "planning";
DELETE FROM "activity";
DELETE FROM "work_order";
DELETE FROM "order";
DELETE FROM "user";
DELETE FROM "professional";
DELETE FROM "client";
DELETE FROM "order_type";
DELETE FROM "order_state";
DELETE FROM "order_category";
-- Se necessario droppare le tabelle:
-- DROP TABLE "timesheet" CASCADE; ...
```

### Database Seeding Endpoint

Il backend espone (se configurato in `tools/routes.ts`) un endpoint per popolare il DB iniziale.
`curl -X POST http://127.0.0.1:2230/api/tools/prepare-database` (Richiede Auth Admin).

---

## 8.6 Diagnostica e Monitoraggio

Comandi essenziali per capire "perché il server è lento".

### Monitoraggio Risorse

```bash
# CPU e RAM in tempo reale (ordinare per %MEM)
htop

# Statistiche container Docker (CPU/RAM Usage live)
docker stats --no-stream

# Verifica limiti di memoria applicati
docker inspect gerico-backend --format='Memory: {{.HostConfig.Memory}}'
# Se restituisce 0, il container può usare tutta la RAM dell'host (PERICOLOSO)
```

### Log Analysis

```bash
# Log in tempo reale (follow)
docker logs gerico-backend --tail 100 -f

# Grep errori specifici nei log passati
docker logs gerico-backend 2>&1 | grep "Error"
```

### Network Check

```bash
# Verifica se il backend sta ascoltando sulla porta locale
sudo netstat -tulpn | grep 2230

# Verifica connettività dal container verso il DB
docker exec -it gerico-backend nc -zv <DB_HOST> <DB_PORT>
```
