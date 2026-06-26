# CLAUDE.md — @volcanicminds/backend

> **Questo repo È il framework, non un'applicazione.** Pacchetto npm `@volcanicminds/backend`
> (codename `rome`, **v3.x**). Wrapper opinionato attorno a **Fastify v5**. **Dalla v3 include anche il
> data layer** (ex `@volcanicminds/typeorm`) esposto come **subpath interno `@volcanicminds/backend/typeorm`**.
> Gli esempi "applicativi" in `llms.txt` (controller, service, entità di dominio come `Order`/`Client`) si
> riferiscono a un **repo consumer separato** (`volcanic-backend-sample`), NON a questo.
> Qui si lavora sugli **interni del framework** in `lib/`.

## Ecosistema (2 pilastri, indipendenti ma integrati)

| Pacchetto | Repo | Ruolo | Context7 |
|---|---|---|---|
| `@volcanicminds/backend` | `volcanic-backend` (questo) | Core HTTP/Fastify, auth, autodiscovery, hooks **+ data layer come subpath `/typeorm`** (Magic Query + multi-tenant) | `/volcanicminds/volcanic-backend` |
| `@volcanicminds/tools` | `volcanic-tools` | Utility tree-shakeable: mfa, mailer, logger, storage, transfer, ai | `/volcanicminds/volcanic-tools` |

> ⚠️ `@volcanicminds/typeorm` (repo `volcanic-database-typeorm`) è **EOL**: fuso qui in v3. Importa da
> `@volcanicminds/backend/typeorm`.

**Disaccoppiamento (resta reale, garantito diversamente):** il core **non** importa il data layer. Dalla v3
il decoupling non è più dato dalla separazione fisica del pacchetto, ma da **subpath export + peer dependencies
opzionali + boundary enforced in CI** (`dependency-cruiser`, regola `core-no-datalayer-import`). Verifica:
`npm run depcruise`. L'integrazione runtime è invariata: **iniezione di "Manager"** (Null Object Pattern) via
`start(decorators)` — `userManager`, `tokenManager`, `dataBaseManager`, `mfaManager`, `transferManager`,
`tenantManager`. I tipi delle interfacce (`UserManagement`, `TokenManagement`, `DataBaseManagement`,
`MfaManagement`, `TransferManagement`) sono esportati da `index.ts`. Se un manager non è iniettato, parte un
default no-op → il server si avvia comunque.

Wiring consumer (v3):
```typescript
import { start as startServer } from '@volcanicminds/backend'
import { start as startDatabase, userManager, DataSource } from '@volcanicminds/backend/typeorm'

const db = await startDatabase(databaseOptions)
await startServer({ userManager })
```
Le dipendenze del data layer (`typeorm`, `bcrypt`, `pluralize`, `reflect-metadata`, `pg`) sono **peer
opzionali**: chi usa solo il core non le installa. Chi usa il subpath `/typeorm` le aggiunge nel proprio
`package.json`.

## Stack & convenzioni (valgono per entrambi i repo)

- **Node >= 24** (`.nvmrc` = v24.11.0), **ESM puro** (`"type": "module"`, tsconfig `module: NodeNext`).
- **Import sempre con estensione `.js`** anche nei `.ts` (es. `import x from './x.js'`).
- **Sorgente in `lib/`** (NON `src/`). Entry point `index.ts` (core) + `typeorm.ts` (subpath data layer). Build `tsc` → `dist/`.
- TypeScript 5.9, ESLint 9 flat config (`eslint.config.js`), Prettier.
- `combine.js` (`npm run combine`) genera `OUTPUT.md` (dump del codice, base per `llms.txt`/Context7).

## Comandi

```bash
npm run dev          # tsx watch server.ts (hot reload, --env-file .env)
npm start            # tsx server.ts
npm run build        # tsc -> dist/ (prebuild fa clean; postbuild copy-assets)
npm test             # test:core (49) + test:typeorm (32), tutto NODE_ENV=memory (no Postgres)
npm run type-check   # tsc --noEmit
npm run lint         # eslint .   (lint:fix per autofix)
npm run depcruise    # confine core ↛ lib/database/** (dependency-cruiser)
npm run check-all    # lint + type-check + depcruise  <-- esegui prima di committare
```

## Architettura interna (`lib/`)

- `index.ts` — bootstrap `start()` del **core**: registra plugin Fastify, JWT (+refresh come namespace separato),
  Swagger (opz.), poi loader: tenant → hooks → schemas → router. Gestisce TUS transfer mount e il check
  "Admin MFA forced reset" all'avvio.
- `typeorm.ts` (radice) — entry del **subpath** `@volcanicminds/backend/typeorm`: re-export del data layer.
- `lib/loader/*` — autodiscovery: `router`, `schemas`, `hooks`, `plugins`, `roles`, `schedules`, `tracking`,
  `tenant`, `translation`, `general`.
- `lib/api/*` — API native del framework: `auth`, `health`, `tenants`, `token`, `tool`, `users`.
- `lib/hooks/*` — `onRequest`, `onResponse`, `onError`, `preHandler`, `preSerialization`.
- `lib/middleware/*` — `isAuthenticated`, `isAdmin`, pre/post auth & forgot-password.
- `lib/schemas/*` — JSON Schema core (override via deep-merge se il consumer usa lo stesso `$id`).
- `lib/defaults/managers.ts` — i Null Object dei manager.
- **`lib/database/typeorm/**`** — **data layer** (ex `@volcanicminds/typeorm`): `query.ts`/`query/*` (Magic Query),
  `entities/*` (User/Tenant/Token/Change), `loader/*` (manager + autoload entità + multi-tenant), `util/*`.
  Il core **non** deve importarlo (regola `depcruise`); il flusso è data layer → core (solo import type-only).

## Sicurezza / nozioni non ovvie

- **Auth dual-mode** via `AUTH_MODE`: `BEARER` (token nel body+header) o `COOKIE` (HttpOnly/Secure/SameSite, richiede `COOKIE_SECRET`).
- **Revoca token** via pattern `externalId`: il JWT porta `externalId`, non l'id DB; rigenerarlo invalida tutti i token (logout globale / cambio password).
- **MFA gatekeeper**: login con MFA pendente risponde `202` + `tempToken` (ruolo `pre-auth-mfa`, 5 min); solo `/auth/mfa/*` accessibile finché non si verifica il TOTP.
- **HIDE_ERROR_DETAILS** (default `true` in prod): nasconde i dettagli errore in risposta.
- `mark.ts` stampa il banner; `global.log` (Pino) è settato prima di tutto.

## Globals iniettati a runtime (da non reinventare)

`log` (Pino), `config`, `roles`, `t` (i18n), `server`, `tracking`/`trackingConfig`.
Dal data layer `@volcanicminds/backend/typeorm` (lato consumer): `entity.[Pascal]`, `connection`.
**`global.repository.X` è VIETATO** (Proxy fail-fast in `typeorm.ts`/`start()`): usa `service.use(req.db)`.

## ⚠️ Drift documentazione vs codice

`llms.txt` (3100+ righe, ottima guida ai pattern) e i doc Context7 sono **leggermente disallineati**
dal codice corrente. In particolare mostrano `repository.orders…` per l'accesso dati, ma il data layer
**vieta `global.repository.X`** (Proxy fail-fast) imponendo `service.use(req.db)` (vedi
`docs/ADVANCED_ARCHITECTURE.md`, fonte aggiornata). I doc possono ancora citare `@volcanicminds/typeorm`
come pacchetto separato: dalla v3 è il subpath `@volcanicminds/backend/typeorm`. In caso di conflitto, **vince il codice**.

## Maturità (stato al 2026-06)

- ✅ Suite di test reale (mocha/E2E/unit) — core + data layer, tutto in-memory.
- ✅ **CI presente** (`.github/workflows/ci.yml`): job `verify` (lint/type-check/depcruise/build/publint/attw),
  `test`, `release` (publish su tag `v*`). Secret richiesto: `NPM_TOKEN`.
- Versioning via `package.json` (i tag git storici non sono affidabili).

## Tooling / MCP — Context7

I pacchetti sono indicizzati su **Context7** (MCP): `/volcanicminds/volcanic-backend`, `/volcanicminds/volcanic-tools`.
`/volcanicminds/volcanic-database-typeorm` è **deprecato** (EOL, fuso nel backend). Usa Context7 per **panoramica
e firma API**, ma i suoi snippet derivano da `llms.txt`/README → possono riflettere pattern v1/pacchetto separato.
Per i **pattern correnti** valida sempre sul sorgente in `lib/` (vedi sezione "Drift" sopra).

## Documenti chiave da consultare

`llms.txt` (guida pattern completa), `README.md`, `MIGRATION.md` (v2→v3), `CHANGELOG.md`,
`docs/ADVANCED_ARCHITECTURE.md` (Service/Repository pattern, `.use(req.db)`), `docs/SECURITY_MFA.md`,
`docs/SCHEMA_OVERRIDING.md`, `docs/DATA_LAYER_MAGIC.md`, `docs/configuration.md` (config data layer),
`docs/TYPESCRIPT_GUIDE.md`, `DOCKER.md`.
