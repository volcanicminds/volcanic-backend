# CLAUDE.md: @volcanicminds/backend

> **Questo repo è il framework, non un'applicazione.** Pacchetto npm `@volcanicminds/backend`
> (codename `rome`). Linea di lavoro **v5** su branch `v5` (`5.0.0-alpha.0`; su npm `latest` è
> ancora la 4.x). Si lavora solo su `v5`: `main` e `develop` non si toccano, nemmeno per allinearli. Wrapper
> opinionato attorno a **Fastify v5**, con il **data layer su Drizzle** esposto come subpath `@volcanicminds/backend/db`. Gli esempi applicativi di `llms.txt`
> (controller, service, tabelle di dominio) si riferiscono a un repo consumer separato
> (`volcanic-backend-sample`), non a questo. Qui si lavora sugli interni in `lib/`.
>
> **Stato dei lavori**: `EVO_STATO.md` (stato, una riga per compito), `EVO_FRAMEWORK.md` (piano;
> la sezione 0 dice in che ordine leggere), `EVO_PUNTI_APERTI.md` (decisioni), `EVO_FASE_10.md`
> (igiene e consumer). Lo stato sta lì, non in questo file.

## Ecosistema npm

| Pacchetto | Repo | Ruolo |
|---|---|---|
| `@volcanicminds/backend` | `volcanic-backend` (questo) | core HTTP/Fastify, auth, autodiscovery, hooks, data layer come subpath `/db` |
| `@volcanicminds/tools` | `volcanic-tools` | utility tree-shakeable: mfa, mailer, logger, storage, transfer, ai |
| `@volcanicminds/admin` | `volcanic-admin` | pannello manifest-driven che consuma il backend |
| `@volcanicminds/rag` | `volcanic-rag` | retrieval; pacchetto unico con subpath, non ancora pubblicato (D7 in `volcanic-rag/TASKS.md`) |

`@volcanicminds/typeorm` è deprecato su npm, e il subpath `/typeorm` della v3/v4 non esiste più
in v5. I consumer in produzione su v3/v4 restano su TypeORM finché non migrano
(`docs/MIGRATION_V4_V5.md`).

**Disaccoppiamento**: il core non importa il data layer. Lo garantiscono il subpath export, le
peer dependencies opzionali e il confine verificato in CI (`dependency-cruiser`, regole
`core-no-datalayer-import` e `datalayer-may-use-core-types-only`, `npm run depcruise`).
L'integrazione è per iniezione di manager (Null Object): `startDataLayer()` restituisce i
manager e il consumer li passa a `startServer(layer)`. Contratti in `docs/MANAGERS_V5.md`; da
`index.ts` sono esportati i tipi (`UserManagement`, `TokenManagement`, `TrackingManagement`,
`MfaManagement`, `TransferManagement`, `ControlHandle`, `TenantHandle`, `DataHandle`). Senza data
layer partono i default no-op e il server si avvia comunque.

Wiring consumer, in quest'ordine (il motivo è nel README):

```typescript
import { preload, start as startServer } from '@volcanicminds/backend'
import { start as startDataLayer } from '@volcanicminds/backend/db'

await preload() // prima del data layer: senza, ripiega in silenzio sui propri default
const layer = await startDataLayer()
await layer.migrations.apply({ locator: 'public' }) // in produzione: npm run db:migrate
await startServer(layer)
```

Peer opzionali del data layer: `drizzle-orm`, `pg`, `better-sqlite3`, `@libsql/client`,
`@electric-sql/pglite` (con `pglite-pgvector`), `bcrypt`. `drizzle-kit` va nelle
devDependencies del consumer: genera le migrazioni, non le applica.

## Stack e convenzioni

- **Node >= 24** (`.nvmrc` = v24.11.0), **ESM puro** (`"type": "module"`, `module: NodeNext`).
- **Import sempre con estensione `.js`** anche nei `.ts`.
- **Sorgente in `lib/`** (non `src/`). Entry `index.ts` (core) e `db.ts` (subpath `/db`); CLI
  `bin/volcanic.mjs` (`npx volcanic migrate --tenants`). Build `tsc` → `dist/`.
- ESLint flat config (`eslint.config.js`), Prettier. `combine.js` genera `OUTPUT.md`.

## Comandi

```bash
npm run dev               # tsx watch server.ts
npm run build             # tsc -> dist/
npm test                  # test:lib + test:db + test:migrations (scripts/run-tests.mjs)
npm run test:e2e:mt:pg    # banco nero multi-tenant, vuole Postgres reale
npm run check-all         # lint, type-check, depcruise, check:session-state, check:migration-sets, check:refusals
npm run coverage          # c8 (backend monocart) + scripts/check-coverage.mjs; gira in CI
npm run db:migrate        # piano di controllo; i tenant con npx volcanic migrate --tenants
npm run db:generate       # anche :tenant, :sqlite, :tenant:sqlite
npm run tune              # banco di taratura (docs/TUNING.md)
```

**Senza `DATABASE_URL` le suite che vogliono Postgres saltano invece di fallire**: un verde senza
quella variabile non dice quello che sembra. Il comando Docker per il Postgres di prova è in
`EVO_STATO.md`.

## Architettura interna (`lib/`)

- `index.ts`: bootstrap `start()` del core (plugin Fastify, JWT, Swagger opzionale, CORS con
  allowlist in `lib/util/cors.ts`, loader).
- `lib/loader/*`: autodiscovery, risoluzione del tenant (`tenant.ts`), controllo di allineamento
  dello schema all'avvio (`schemaVersion.ts`).
- `lib/api/*`: `admin`, `auth`, `health`, `system` (piano di controllo, montato solo con il
  blocco `tenants`), `tenants`, `token`, `users`. `/tool` non esiste più.
- `lib/hooks/*`, `lib/middleware/*`, `lib/schemas/*`, `lib/manifest/*` (manifest per
  `volcanic-admin`), `lib/defaults/managers.ts`.
- `lib/database/**`: data layer. `ports.ts`, `capabilities.ts` (matrice motori e strategie, rifiuto
  all'avvio), `adapters/{postgres,sqlite}`, `schema/{pg,sqlite}.ts`, `query/` (Magic Query v5),
  `managers/`, `migrations/` (runner e flotta), `containers/` (export, replica Litestream),
  `leases.ts`, `access.ts`. Il core non deve importarlo.

## Nozioni non ovvie (v5)

- **Due piani**: `req.control` (piano di controllo) e `req.tenant` (contenitore del tenant);
  `dataContext(req)` sceglie e, senza contesto, lancia `NoDataContextError`. `req.db`,
  `global.connection`, `global.entity` e `global.repository` **non esistono più**.
- Una rotta di piattaforma dichiara `scope: 'control'`; `tenantContext` scritto da un consumer
  **rifiuta l'avvio**.
- **Il tenant parte dal token** (`tid`); header o sottodominio solo senza token, mai la query
  string. Token e header discordi: 403 `TENANT_MISMATCH`.
- **Niente stato di sessione su Postgres**: `set search_path` fuori transazione è vietato due
  volte (`scripts/check-session-state.mjs` e guardia sul driver).
- **Auth**: `AUTH_MODE` di default `COOKIE` (richiede il plugin `cookie`), `BEARER` in
  alternativa. Revoca via `externalId`. Il login è un flusso (`/auth/flow/*` e
  `/system/auth/flow/*`, `lib/auth/engine.ts`): stadi da `config/authFlows.ts`, che sostituisce e
  non fonde; secondo passo con risposta 202 e credenziale opaca `vf1.` (cookie `auth_flow` o campo
  `flow`, mai `Authorization`); il pavimento MFA lo applica il motore. Nessun JWT con claim `role`.
  Login fallito sempre `401 AUTH_INVALID_CREDENTIALS` (in v4 era 403). Spec in
  `docs/AUTH_FLOW_V5.md`.
- **Identità di sistema** separate da quelle dei tenant (`global.systemRoles`, capability a
  catalogo chiuso, rotte `/system/*`). Il fondatore è la colonna `is_founder` nel contenitore;
  `ADMIN_EMAIL` serve solo alla genesi.
- **Migrazioni** forward-only: SQL generato da drizzle-kit e applicato dal runner del framework,
  due insiemi (`control`, `tenant`) per dialetto (`pg`, `sqlite`).
- `HIDE_ERROR_DETAILS` vale su entrambi i gestori d'errore; il `code` resta sempre.
- `req.data()` fonde query string e corpo, e vince il corpo.
- Un codice di rifiuto nuovo arriva con un test, o `check:refusals` fallisce.
- `lib/util/mark.ts` stampa il banner; `global.log` (Pino) è impostato prima di tutto.

## Globals a runtime

`log`, `server`, `config`, `roles`, `systemRoles`, `t` (i18n), `tracking`/`trackingConfig`,
`routes`, `cache`, `transferConfig`/`transferPath`.

## Documentazione: cosa è v5 e cosa no

- **v5**: `README.md`, `llms.txt`, `docs/*_V5.md` (SCHEMA, MAGIC_QUERY, MANAGERS, AUTHORIZATION,
  AUTH_FLOW, API, CONFIGURATION, TESTING), `docs/MIGRATION_V4_V5.md`, `docs/SECURITY_MFA.md`,
  `docs/CACHE.md`, `docs/TUNING.md`, `docs/ADVANCED_ARCHITECTURE.md` e `docs/TYPESCRIPT_GUIDE.md`
  (riscritti sulla v5).
- **v4, con cartello di sostituzione**: `docs/DATA_LAYER_MAGIC.md`, `docs/CONFIGURATION.md`,
  `docs/PGLITE.md`. Il progetto v4 del motore di autenticazione è stato rimosso: lo sostituisce
  `docs/AUTH_FLOW_V5.md`.
- In caso di conflitto **vince il codice**.

## Maturità

- CI in `.github/workflows/ci.yml`: `verify` (lint, type-check, depcruise, check di sessione e di
  migrazioni, build, publint, attw `esm-only`), `test` (suite più `npm run coverage`, con
  `lcov.info` come artefatto), `test-pg` (Postgres 16 di servizio), `release` su tag `v*`.
- **La copertura si misura con il backend monocart di `c8`**: sotto `tsx` lo stesso modulo può
  essere compilato due volte, come CommonJS e come ESM, e c8 semplice tiene solo una delle due
  coperture. Il pavimento lo applica `scripts/check-coverage.mjs`, perché `--check-coverage` di c8
  sotto monocart confronta un numero che non stampa. Il perché per esteso è in `COVERAGE.md`.
- Pubblicazione npm: fino alla 3.x era manuale con OTP, perché `NPM_TOKEN` non era configurato.
  Verificare prima di pubblicare la v5.
- Versioning via `package.json` (i tag git storici non sono affidabili).

## Tooling: Context7

Indicizzati `/volcanicminds/volcanic-backend` e `/volcanicminds/volcanic-tools`. Gli snippet
derivano da `llms.txt` e README: per i pattern correnti valida sempre sul sorgente in `lib/`.
