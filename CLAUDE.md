# CLAUDE.md — @volcanicminds/backend

> **Questo repo È il framework, non un'applicazione.** Pacchetto npm `@volcanicminds/backend`
> (codename `rome`, v2.3.x). Wrapper opinionato attorno a **Fastify v5**. Gli esempi "applicativi"
> in `llms.txt` (controller, service, entità di dominio come `Order`/`Client`) si riferiscono a un
> **repo consumer separato** (`volcanic-sample-backend` / `volcanic-backend-sample`), NON a questo.
> Qui si lavora sugli **interni del framework** in `lib/`.

## Ecosistema (3 pilastri, indipendenti ma integrati)

| Pacchetto | Repo | Ruolo | Context7 |
|---|---|---|---|
| `@volcanicminds/backend` | `volcanic-backend` (questo) | Core HTTP/Fastify, auth, autodiscovery, hooks, GraphQL | `/volcanicminds/volcanic-backend` |
| `@volcanicminds/typeorm` | `volcanic-database-typeorm` | Data layer: Magic Query + multi-tenant | `/volcanicminds/volcanic-database-typeorm` |
| `@volcanicminds/tools` | `volcanic-tools` | Utility tree-shakeable: mfa, mailer, logger, storage, transfer, ai | `/volcanicminds/volcanic-tools` |

**Disaccoppiamento reale:** questo pacchetto **non** dipende da `typeorm`/`tools` in `package.json`.
L'integrazione avviene per **iniezione di "Manager"** (Null Object Pattern) via `start(decorators)`:
`userManager`, `tokenManager`, `dataBaseManager`, `mfaManager`, `transferManager`, `tenantManager`.
Il consumer cabla: i manager DB da `@volcanicminds/typeorm`, un `mfaAdapter`/`transferManager` da
`@volcanicminds/tools`. I tipi delle interfacce (`UserManagement`, `TokenManagement`,
`DataBaseManagement`, `MfaManagement`, `TransferManagement`) sono esportati da `index.ts`.
Se un manager non è iniettato, parte un default no-op → il server si avvia comunque.

## Stack & convenzioni (valgono per tutti e 3 i repo)

- **Node >= 24** (`.nvmrc` = v24.11.0), **ESM puro** (`"type": "module"`, tsconfig `module: NodeNext`).
- **Import sempre con estensione `.js`** anche nei `.ts` (es. `import x from './x.js'`).
- **Sorgente in `lib/`** (NON `src/`). Entry point `index.ts`. Build `tsc` → `dist/`.
- TypeScript 5.9, ESLint 9 flat config (`eslint.config.js`), Prettier.
- `combine.js` (`npm run combine`) genera `OUTPUT.md` (dump del codice, base per `llms.txt`/Context7).

## Comandi

```bash
npm run dev          # tsx watch server.ts (hot reload, --env-file .env)
npm start            # tsx server.ts
npm run build        # tsc -> dist/ (prebuild fa clean)
npm test             # mocha + tsx, PORT=2231 NODE_ENV=memory  (test/index.spec.ts)
npm run type-check   # tsc --noEmit
npm run lint         # eslint .   (lint:fix per autofix)
npm run check-all    # lint + type-check  <-- esegui prima di committare
```

## Architettura interna (`lib/`)

- `index.ts` — bootstrap `start()`: registra plugin Fastify, JWT (+refresh come namespace separato),
  Swagger (opz.), Apollo (opz.), poi loader: tenant → hooks → schemas → router. Gestisce TUS transfer
  mount e il check "Admin MFA forced reset" all'avvio.
- `lib/loader/*` — autodiscovery: `router` (scansiona `src/api/**/routes.ts` del consumer),
  `schemas`, `hooks`, `plugins`, `roles`, `schedules`, `tracking`, `tenant`, `translation`, `general`.
- `lib/api/*` — API native del framework: `auth`, `health`, `tenants`, `token`, `tool`, `users`.
- `lib/hooks/*` — `onRequest`, `onResponse`, `onError`, `preHandler`, `preSerialization`.
- `lib/middleware/*` — `isAuthenticated`, `isAdmin`, pre/post auth & forgot-password.
- `lib/apollo/*` — GraphQL (attivo solo con `GRAPHQL=true`).
- `lib/schemas/*` — JSON Schema core (override via deep-merge se il consumer usa lo stesso `$id`).
- `lib/defaults/managers.ts` — i Null Object dei manager.

## Sicurezza / nozioni non ovvie

- **Auth dual-mode** via `AUTH_MODE`: `BEARER` (token nel body+header) o `COOKIE` (HttpOnly/Secure/SameSite, richiede `COOKIE_SECRET`).
- **Revoca token** via pattern `externalId`: il JWT porta `externalId`, non l'id DB; rigenerarlo invalida tutti i token (logout globale / cambio password).
- **MFA gatekeeper**: login con MFA pendente risponde `202` + `tempToken` (ruolo `pre-auth-mfa`, 5 min); solo `/auth/mfa/*` accessibile finché non si verifica il TOTP.
- **HIDE_ERROR_DETAILS** (default `true` in prod): nasconde i dettagli errore in risposta.
- `mark.ts` stampa il banner; `global.log` (Pino) è settato prima di tutto.

## Globals iniettati a runtime (da non reinventare)

`log` (Pino), `config`, `roles`, `t` (i18n), `server`, `tracking`/`trackingConfig`.
Da `@volcanicminds/typeorm` (lato consumer): `entity.[Pascal]`, `repository.[camelPlural]`, `connection`.

## ⚠️ Drift documentazione vs codice

`llms.txt` (3100+ righe, ottima guida ai pattern) e i doc Context7 sono **leggermente disallineati**
dal codice corrente. In particolare mostrano `repository.orders…` per l'accesso dati, ma il pacchetto
`typeorm` ora **vieta `global.repository.X`** (Proxy fail-fast) imponendo `service.use(req.db)`
(vedi `docs/ADVANCED_ARCHITECTURE.md`, che è la fonte aggiornata). In caso di conflitto, **vince il codice**.

## Maturità (stato al 2026-06)

- ✅ Suite di test reale (mocha/E2E/unit) — l'unico dei 3 repo ben coperto.
- ⚠️ **Nessuna CI** (`.github/workflows` assente). Test e `check-all` solo manuali.
- Versioning via `package.json` (i tag git sono fermi a `0.7.0`, non affidabili).

## Tooling / MCP — Context7

I 3 pacchetti sono indicizzati su **Context7** (MCP). Per docs/snippet aggiornati interroga:
`/volcanicminds/volcanic-backend`, `/volcanicminds/volcanic-database-typeorm`, `/volcanicminds/volcanic-tools`.
Usalo per **panoramica e firma API**, ma i suoi snippet derivano da `llms.txt`/README → possono riflettere
pattern v1. Per i **pattern correnti** valida sempre sul sorgente in `lib/` (vedi sezione "Drift" sopra).

## Documenti chiave da consultare

`llms.txt` (guida pattern completa), `README.md`, `docs/ADVANCED_ARCHITECTURE.md` (Service/Repository
pattern aggiornato, `.use(req.db)`), `docs/SECURITY_MFA.md`, `docs/SCHEMA_OVERRIDING.md`,
`docs/DATA_LAYER_MAGIC.md`, `docs/TYPESCRIPT_GUIDE.md`, `DOCKER.md`.
