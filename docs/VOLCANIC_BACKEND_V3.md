# Volcanic Backend v3 — Integrazione del data layer TypeORM

> **Scopo del documento**: istruzioni operative, complete e auto-contenute, per **fondere** il pacchetto
> `@volcanicminds/typeorm` dentro `@volcanicminds/backend` come **subpath interno**, mantenendo intatto il
> disaccoppiamento odierno. Destinatario: uno sviluppatore competente in TypeScript/Node/ESM **che non ha
> partecipato alle decisioni** e non conosce il contesto. Tutto ciò che serve è qui.
>
> Lavorare **a task con checkbox**, in ordine di fase. Non saltare la Fase 0.

---

## Fase 0 — Contesto, obiettivo, invarianti (LEGGERE PRIMA)

### 0.1 Stato attuale (fatti verificati)
Esistono oggi **due pacchetti npm separati**, in due repo Git separati:

| Pacchetto | Versione | Cosa fa | Dipendenze rilevanti |
|-----------|----------|---------|----------------------|
| `@volcanicminds/backend` (codename *rome*) | **2.4.0** | Wrapper opinionato su **Fastify v5**: HTTP, auth (JWT+refresh, forgot/reset, MFA), autodiscovery di route/schema/hook, ruoli, multi-tenant hooks. | nessuna dipendenza da typeorm |
| `@volcanicminds/typeorm` | **2.3.5** | Data layer: wrapper su **TypeORM 0.3** + **"Magic Query"** (filtri/sort/paginazione da query-string) + multi-tenancy Postgres via `search_path`. | `typeorm ^0.3.28`, `bcrypt ^6`, `pluralize ^8`, `reflect-metadata ^0.2`, `glob`, `dotenv` |

Caratteristiche comuni (valgono per entrambi e vanno mantenute):
- **Node >= 24**, **ESM puro** (`"type":"module"`), TypeScript 5.9, `tsconfig` `module/moduleResolution: NodeNext`,
  `target: ES2022`, `rootDir: "."`, `outDir: "dist"`, `declaration: true`.
- **Import sempre con estensione `.js`** anche nei file `.ts` (es. `import x from './x.js'`).
- Sorgente in **`lib/`**, entry `index.ts`, build `tsc` → `dist/`.
- ESLint 9 flat config (`eslint.config.js`), Prettier, `combine.js` → `OUTPUT.md`.
- **Nessuna CI** oggi presente in nessuno dei due repo (`.github/workflows` assente).

### 0.2 Come sono integrati OGGI (importante)
Il backend **non dipende** da typeorm: l'integrazione avviene per **iniezione di "Manager"** (Null Object Pattern).
La funzione `start(decorators)` del backend accetta implementazioni dei manager; le interfacce
(`UserManagement`, `TokenManagement`, `DataBaseManagement`, `MfaManagement`, `TransferManagement`) sono **tipi
esportati dal core**. Il pacchetto typeorm fornisce le **implementazioni** (`userManager`, `tokenManager`,
`dataBaseManager`, `TenantManager`). Se un manager non è iniettato, il backend usa un **default no-op** e parte comunque.

Una app consumer oggi fa così (esempio reale):
```typescript
import { start as startServer } from '@volcanicminds/backend'
import { start as startDatabase, userManager, DataSource } from '@volcanicminds/typeorm'

const db = await startDatabase(databaseOptions)   // inizializza il DataSource
await startServer({ userManager })                // inietta il manager nel backend
```

**Verificato**: nessun file in `lib/**` o `index.ts` del backend importa `typeorm` o `@volcanicminds/typeorm`.
Il disaccoppiamento è reale ed è **una proprietà architetturale voluta** (consente di non usare il data layer o
di usarne un altro).

### 0.3 Obiettivo della v3
**Un solo pacchetto** `@volcanicminds/backend@3.0.0` che contiene anche il data layer, esposto come **subpath**:
- `@volcanicminds/backend` → core (come oggi);
- `@volcanicminds/backend/typeorm` → ex `@volcanicminds/typeorm` (stessa API pubblica).

Vantaggi: un solo install, una sola versione, niente sync di versioni fra due repo, tooling/CI condivisi.

### 0.4 INVARIANTI DA NON VIOLARE (criterio di accettazione globale)
1. **Il core non deve importare il data layer.** `index.ts` e `lib/**` (esclusa la nuova cartella `lib/typeorm/**`)
   **non** devono importare `typeorm`, `bcrypt`, `pluralize`, `reflect-metadata`, né `./lib/typeorm/**`.
   Questo va **garantito da una regola in CI** (Fase 5), non solo a parole.
2. **Le dipendenze del data layer sono `peerDependencies` opzionali.** Chi installa il pacchetto e **non** usa il
   subpath `/typeorm` **non** deve essere costretto a installare `typeorm`/`bcrypt`/ecc. (nessun errore, nessun warning).
3. **L'API pubblica del data layer non cambia.** Gli stessi export di `@volcanicminds/typeorm` devono essere
   disponibili identici da `@volcanicminds/backend/typeorm` (stessi nomi, stesse firme).
4. **Il runtime di iniezione manager resta identico.** Cambia solo *da dove si importa*, non *come si usa*.
5. **ESM puro + import con `.js` + Node>=24** restano regole ferme.

### 0.5 Glossario (per chi non conosce il progetto)
- **Magic Query**: traduzione di query-string HTTP (`campo:operatore=valore`, `sort`, `page/pageSize`) in query
  TypeORM. Risponde con header `v-page/v-pageSize/v-count/v-total/v-pageCount`.
- **Manager injection / Null Object**: il backend riceve implementazioni dei manager; se assenti usa no-op.
- **`global.repository.X` VIETATO**: il data layer avvolge i repository in un `Proxy` che lancia errore fatale se si
  accede a `global.repository.X`; si deve usare `service.use(req.db)`. Mantenere questo comportamento.
- **Multi-tenancy**: isolamento via Postgres `search_path`; si passa sempre un `EntityManager`/`QueryRunner`
  (`runInTenantContext`), mai switch di contesto globale.
- **Subpath export**: voce nel campo `exports` del `package.json` che espone un secondo entry-point del pacchetto
  (es. `@volcanicminds/backend/typeorm`).

### 0.6 Checklist comprensione (spuntare prima di procedere)
- [ ] Ho letto §0.1–§0.5 e capito che il core **non** deve dipendere dal data layer.
- [ ] Ho chiaro che le dep del data layer diventano **peer opzionali**.
- [ ] Ho clonato entrambi i repo: `volcanic-backend` e `volcanic-database-typeorm`.
- [ ] So che il target è `@volcanicminds/backend@3.0.0` con subpath `/typeorm`.

---

## Task 0 (propedeutico) — Aggiornare `CLAUDE.md` al target state v3

> **Perché per primo.** Si aggiorna **subito** il `CLAUDE.md` del backend per fissare la *north star*: descrive
> com'è il pacchetto **dopo** il merge, così tutto il lavoro successivo ha un riferimento chiaro. È sicuro farlo per
> primo perché **vive solo sul branch `v3`** (creato in Fase 1) e **non viene mergiato su `main` finché il merge non
> è completo**: il `main` continua a descrivere lo stato attuale. Eseguire dopo aver creato il branch `v3` (Fase 1)
> e prima del resto.

Modifiche al `CLAUDE.md` di `volcanic-backend` (tutte sul branch `v3`):
- [ ] **Prerequisito**: branch `v3` creato e in checkout (Fase 1, secondo step). Se non l'hai ancora creato, esegui
      prima i primi due step della Fase 1, poi torna qui.
- [ ] **Intestazione**: versione `v2.3.x` → `v3.x`; aggiungere che il pacchetto **include il data layer come subpath
      `@volcanicminds/backend/typeorm`**.
- [ ] **Tabella Ecosistema**: da **3 pilastri a 2** (backend *con subpath typeorm* + tools); **rimuovere** la riga
      `@volcanicminds/typeorm` come pacchetto/repo separato.
- [ ] **Paragrafo "Disaccoppiamento reale"**: riformulare — il decoupling **resta**, ma è garantito da **subpath
      export + peer dep opzionali + boundary in CI**, non più dalla separazione fisica del pacchetto. Il core continua
      a **non** importare il data layer (verificato da `depcruise`).
- [ ] **Esempio wiring consumer**: `@volcanicminds/typeorm` → `@volcanicminds/backend/typeorm`.
- [ ] **Architettura `lib/`**: aggiungere `lib/typeorm/**` (data layer) e lo script `depcruise` (regola di confine).
- [ ] **Maturità**: "⚠️ Nessuna CI" → **CI presente** (verify/test/release).
- [ ] **Sezione Drift** (`global.repository.X`): aggiornare la dicitura — stesso pacchetto, non più typeorm separato.
- [ ] **Tooling/Context7**: rimuovere/segnare deprecato `/volcanicminds/volcanic-database-typeorm`; restano
      `/volcanicminds/volcanic-backend` e `/volcanicminds/volcanic-tools`.

**Accettazione Task 0**: il `CLAUDE.md` su branch `v3` descrive il pacchetto unico con subpath e CI; `main` invariato.
(Verifica finale di coerenza col codice reale del merge → Fase 10.)

---

## Fase 1 — Preparazione repo e branch

- [ ] Lavorare nel repo **`volcanic-backend`** (il data layer verrà importato qui).
- [ ] Creare il branch di lavoro **`v3`** (tutta la v3 vive qui fino al merge su `main` e al tag `v3.0.0`).
- [ ] Tenere una copia del repo `volcanic-database-typeorm` accanto, come **sorgente** da cui copiare (commit di
      riferimento annotato nel changelog).
- [ ] Verificare baseline verde sul backend: `npm ci && npm run check-all && npm test`.
- [ ] Verificare baseline verde sul typeorm: `npm ci && npm run check-all && npm test`.
- [ ] Annotare in un file `MIGRATION_NOTES.md` (temporaneo) il **commit hash** del typeorm da cui si parte.

> **I test NON richiedono un Postgres reale.** Fatto verificato: entrambe le suite girano con `NODE_ENV=memory` e
> sono **unit test** (il typeorm testa `query`, `util`, `userManager`, `crypto`; il backend gira in memory). L'unica
> env aggiuntiva richiesta dai test del data layer è `MFA_DB_SECRET` (vedi Appendice C). Un Postgres serve solo a chi
> volesse, in futuro, scrivere test d'integrazione end-to-end (non in scope qui).

**Accettazione Fase 1**: entrambi i progetti compilano (`check-all`) e i test passano *prima* di toccare nulla.

---

## Fase 2 — Struttura del pacchetto e layout cartelle

### 2.1 Layout target nel repo backend
Il data layer va sotto una **cartella namespaced** `lib/typeorm/` per evitare collisioni (il core ha già
`lib/loader/`, `lib/entities/`, `lib/util/` con file omonimi a quelli del data layer).

```
volcanic-backend/
├─ index.ts                    # entry CORE (invariato)
├─ typeorm.ts                  # NUOVO entry del SUBPATH data layer (re-export)
├─ lib/                        # core (invariato)
│  ├─ loader/ … api/ … hooks/ … middleware/ … schemas/ … defaults/
│  └─ typeorm/                 # NUOVO — tutto il sorgente ex @volcanicminds/typeorm
│     ├─ loader/{entities,userManager,tokenManager,dataBaseManager,tenantManager}.ts
│     ├─ entities/{user,tenant,token,change}.ts
│     ├─ query.ts  query/{parser,builder}.ts
│     └─ util/{logger,crypto,yn}.ts
├─ types/
│  ├─ global.ts                # core (invariato)
│  └─ typeorm/global.ts        # NUOVO — i tipi del data layer (es. `Database`)
└─ dist/                       # output build: index.js + typeorm.js + .d.ts
```

- [ ] Creare la cartella `lib/typeorm/`.
- [ ] Creare il file entry `typeorm.ts` alla radice (contenuto in Fase 3).
- [ ] Spostare i tipi del data layer in `types/typeorm/`.

### 2.2 `package.json` — campo `exports` e metadati
- [ ] Bumpare la versione a **`3.0.0`** (cambio breaking: consolidamento + nuovo import path).
- [ ] Aggiornare il campo `exports` per esporre il subpath:
```jsonc
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js",
    "require": "./dist/index.js"
  },
  "./typeorm": {
    "types": "./dist/typeorm.d.ts",
    "import": "./dist/typeorm.js",
    "require": "./dist/typeorm.js"
  },
  "./package.json": "./package.json"
}
```
- [ ] Aggiungere `"lib"` è già in `files`; verificare che `dist` e `lib` siano inclusi.
- [ ] **`sideEffects`**: oggi è `false`. Il data layer ha side-effect intenzionali (`import 'reflect-metadata'`,
      `dotenv.config()`). Impostare:
```jsonc
"sideEffects": ["./dist/typeorm.js", "./lib/typeorm/**"]
```
  così il tree-shaking del core resta attivo ma i side-effect del data layer non vengono rimossi.

### 2.3 `tsconfig.json` — modifiche OBBLIGATORIE (altrimenti le entità non compilano)
Fatto verificato confrontando i due `tsconfig.json` reali: il backend ha **già** `experimentalDecorators: true` e
`emitDecoratorMetadata: true` (ok per TypeORM). **Ma** il tsconfig del data layer ha **3 opzioni in più** che il
backend NON ha, indispensabili per compilare le entità TypeORM (`@Column() name: string` senza inizializzatore va in
errore sotto `strict`). Inoltre l'`include` attuale non cattura le sottocartelle di `types/`.

- [ ] Aggiungere a `compilerOptions` del `tsconfig.json` del backend:
```jsonc
"strictPropertyInitialization": false,   // entità TypeORM: proprietà senza initializer
"useUnknownInCatchVariables": false,     // catch(e) come any nel data layer
"noUnusedLocals": false
```
- [ ] Modificare `include`: `"types/*"` → **`"types/**/*"`** (altrimenti `types/typeorm/global.ts` non viene compilato).
      Risultato atteso: `"include": ["*.ts", "*.d.ts", "lib/**/*", "types/**/*"]`.
- [ ] Lasciare invariati `module/moduleResolution: NodeNext`, `target: ES2022`, `rootDir: "."`, `outDir: "dist"`,
      `declaration`, `paths: { "@types": ["./types"] }`, `exclude: ["node_modules","dist","test"]`.
- [ ] **Non** servono `useDefineForClassFields` o altri flag: il data layer compila oggi con questi stessi `target`
      ed `experimentalDecorators`; replicarne solo le 3 opzioni sopra.

> Nota trade-off: `strictPropertyInitialization:false` si applica anche al core — è una **rilassatura sicura** (non
> rompe nulla, smette solo di pretendere l'inizializzazione delle proprietà). *Alternativa più rigorosa e opzionale*:
> un `tsconfig.typeorm.json` separato che estende il base con le 3 opzioni, e build a due passi
> (`tsc -p tsconfig.json && tsc -p tsconfig.typeorm.json`). Default consigliato: **un solo tsconfig** con le 3 opzioni.

**Accettazione Fase 2**: `package.json` valido (`npm pkg fix` non segnala errori), `exports` con le due voci;
`npm run type-check` compila le entità del data layer senza errori di property-initialization.

---

## Fase 3 — Migrazione del codice del data layer

### 3.1 Copia dei sorgenti
- [ ] Copiare il contenuto di `volcanic-database-typeorm/lib/**` in `volcanic-backend/lib/typeorm/**`.
- [ ] Copiare i tipi (`volcanic-database-typeorm/types/**`) in `volcanic-backend/types/typeorm/**`.
- [ ] **Non** copiare: `package.json`, `tsconfig.json`, `eslint.config.js`, `node_modules`, `dist`, `test` di
      typeorm (i test si gestiscono in Fase 7; il tooling è quello del backend).

### 3.2 Creazione dell'entry subpath `typeorm.ts`
Replicare **identicamente** la superficie di export dell'attuale `@volcanicminds/typeorm/index.ts`, ma puntando ai
nuovi percorsi `./lib/typeorm/...`. La superficie da garantire (verificata sul sorgente attuale) è:
```typescript
// typeorm.ts  (entry del subpath @volcanicminds/backend/typeorm)
import 'reflect-metadata'
// … logica di start() spostata qui (vedi index.ts originale del data layer) …

export { Database } from './types/typeorm/global.js'
export {
  start,                 // inizializza il DataSource, autoload entità/repository, popola i global
  User, Tenant, Token, Change,
  userManager, tokenManager, dataBaseManager, TenantManager,
  DataSource,
  applyQuery, executeCountQuery, executeCountView, executeFindQuery, executeFindView,
  useOrder, useWhere, configureSensitiveFields
}
```
- [ ] Spostare la funzione `start(options)` del data layer (oggi in `volcanic-database-typeorm/index.ts`) dentro
      `typeorm.ts` (o in `lib/typeorm/start.ts` e ri-esportata). Mantenere **identica** la logica: caricamento entità,
      `DataSource`, sync condizionale, popolamento `global.connection`/`global.entity` e il **Proxy fail-fast** su
      `global.repository`.
- [ ] Aggiornare **tutti** gli import relativi dei file spostati: restano relativi (`./loader/...`), quindi se la
      struttura interna è preservata sotto `lib/typeorm/` gli import non cambiano. Verificare comunque le estensioni `.js`.
- [ ] Verificare che eventuali `import` a `../types/global.js` del data layer puntino ora a `../../types/typeorm/global.js`.

### 3.3 Riconciliazione con il core (interfacce manager)
Il core esporta le **interfacce** dei manager; il data layer ne è l'implementazione. Non duplicare i tipi:
- [ ] Far sì che le implementazioni in `lib/typeorm/loader/*Manager.ts` **soddisfino** le interfacce del core
      (`UserManagement`, `TokenManagement`, `DataBaseManagement` da `types/global.ts`). Se servono i tipi, importarli
      con un import **type-only** dal core (`import type { UserManagement } from '../../types/global.js'`).
- [ ] ⚠️ Attenzione al confine (Fase 5): un import **type-only** dal core verso il data layer è ammesso; il **core
      verso il data layer no**. Il flusso delle dipendenze è **data layer → core** (mai il contrario).

### 3.4 Pulizia
- [ ] Rimuovere riferimenti residui a `@volcanicminds/typeorm` interni (non devono esistere: il data layer ora è locale).
- [ ] Allineare il logger: il data layer usa un suo `lib/util/logger.ts`; valutare se usare `global.log` (Pino) del
      core quando presente (comportamento già previsto). Non introdurre dipendenze nuove.

**Accettazione Fase 3**: `npm run type-check` passa; `typeorm.ts` esporta esattamente i simboli di §3.2.

---

## Fase 4 — Dipendenze: peer opzionali

Spostare le dipendenze **esclusive del data layer** da `dependencies` a **`peerDependencies` opzionali** nel
`package.json` del backend. `glob` e `dotenv` sono **già** dipendenze del core → restano in `dependencies`.

- [ ] Aggiungere a `package.json`:
```jsonc
"peerDependencies": {
  "typeorm": "^0.3.28",
  "bcrypt": "^6.0.0",
  "pluralize": "^8.0.0",
  "reflect-metadata": "^0.2.2",
  "pg": "^8.13.0"
},
"peerDependenciesMeta": {
  "typeorm": { "optional": true },
  "bcrypt": { "optional": true },
  "pluralize": { "optional": true },
  "reflect-metadata": { "optional": true },
  "pg": { "optional": true }
}
```
- [ ] Aggiungere a **`devDependencies`** del backend (servono per compilare/testare il data layer nel repo):
      `typeorm`, `bcrypt`, `pluralize`, `reflect-metadata`, `pg`, più i tipi mancanti **`@types/bcrypt`**,
      **`@types/pluralize`**, **`@types/pg`**. *(Nota: `typeorm` e `reflect-metadata` includono già i propri tipi →
      niente `@types` per loro; `bcrypt`/`pluralize`/`pg` no → servono i `@types/*`.)*
- [ ] **Non** lasciare `typeorm`/`bcrypt`/`pluralize`/`reflect-metadata` in `dependencies` (verrebbero forzati su tutti).
- [ ] Nota su `pg`: è il driver Postgres; il data layer non lo importa direttamente ma TypeORM lo richiede a runtime
      quando si usa Postgres → peer opzionale + dev.

**Accettazione Fase 4**: in un progetto che usa **solo** il core, `npm i @volcanicminds/backend` **non** tira dentro
`typeorm`/`bcrypt`/ecc. e non emette warning di peer mancanti.

---

## Fase 5 — Enforcement del confine core ↛ data layer (CI)

L'invariante §0.4.1 va **garantita meccanicamente**. Usare **dependency-cruiser**.

- [ ] `npm i -D dependency-cruiser`.
- [ ] Creare `.dependency-cruiser.cjs` con regole:
```js
module.exports = {
  forbidden: [
    {
      name: 'core-no-datalayer-import',
      comment: 'Il core non deve importare il data layer né le sue peer dep',
      severity: 'error',
      from: { path: '^(index\\.ts|lib/(?!typeorm/))' },
      to:   { path: '^lib/typeorm/|^typeorm\\.ts$|^(typeorm|bcrypt|pluralize|reflect-metadata|pg)$' }
    },
    {
      name: 'datalayer-may-use-core-types-only',
      comment: 'Il data layer può importare SOLO tipi dal core (no valori a runtime)',
      severity: 'warn',
      from: { path: '^lib/typeorm/' },
      to:   { path: '^(lib/(?!typeorm/)|index\\.ts)', dependencyTypesNot: ['type-only'] }
    }
  ],
  options: { tsConfig: { fileName: 'tsconfig.json' }, doNotFollow: { path: 'node_modules' } }
}
```
- [ ] Aggiungere script: `"depcruise": "depcruise index.ts typeorm.ts lib --config .dependency-cruiser.cjs"`.
- [ ] Aggiungere `depcruise` a `check-all`: `"check-all": "npm run lint && npm run type-check && npm run depcruise"`.
- [ ] (Opzionale, doppio presidio) Regola ESLint nel flat config `eslint.config.js`: un blocco mirato al core che
      vieta gli import del data layer e delle sue peer. Esempio:
```js
// eslint.config.js — aggiungere questo oggetto config
{
  files: ['index.ts', 'lib/**/*.ts'],
  ignores: ['lib/typeorm/**'],
  rules: {
    'no-restricted-imports': ['error', {
      paths: ['typeorm', 'bcrypt', 'pluralize', 'reflect-metadata', 'pg'],
      patterns: ['**/lib/typeorm/**', '**/typeorm.js']
    }]
  }
}
```

**Accettazione Fase 5**: introdurre di proposito un import vietato nel core → `npm run depcruise` **fallisce**.
Rimuoverlo → passa.

---

## Fase 6 — Build, tipi, validazione exports

- [ ] Verificare che `tsconfig.json` includa `typeorm.ts` (con `rootDir: "."` è già incluso; controllare che non sia in `exclude`).
- [ ] `npm run build` → in `dist/` devono comparire **sia** `index.js`+`index.d.ts` **sia** `typeorm.js`+`typeorm.d.ts`,
      più `lib/typeorm/**` compilato.
- [ ] Verificare la risoluzione dei subpath con **publint** e **@arethetypeswrong/cli**:
  - [ ] `npx publint` → nessun errore su `exports`/tipi.
  - [ ] `npx @arethetypeswrong/cli --pack .` → entrambe le entry (`.` e `./typeorm`) risolvono types+runtime per ESM.
- [ ] Smoke test import in un progetto esterno temporaneo (`npm pack` → install del tarball):
```typescript
import { start } from '@volcanicminds/backend'                 // core
import { start as db, userManager } from '@volcanicminds/backend/typeorm'  // subpath
```
- [ ] Aggiornare `postbuild`/`scripts/copy-assets.mjs` se copia asset, includendo eventuali asset del data layer.

**Accettazione Fase 6**: build pulita, `publint`/`attw` verdi, import dei due entry funzionante dal tarball.

---

## Fase 7 — Test

- [ ] Copiare la suite del data layer (`volcanic-database-typeorm/test/unit/*.spec.ts`) in **`test/typeorm/unit/`**.
      Gli import dei test sono relativi al sorgente: ripuntarli a `../../../lib/typeorm/...` (o usare il subpath
      `@volcanicminds/backend/typeorm` per ciò che è esportato).
- [ ] Definire gli **script test** nel `package.json` del backend (concreti):
```jsonc
"test:core":    "cross-env PORT=2231 NODE_ENV=memory BROWSER=false mocha --import=tsx ./test/index.spec.ts -t 100000 --exit",
"test:typeorm": "cross-env NODE_ENV=memory MFA_DB_SECRET=unit-test-secret-please-change-32xyz mocha --import=tsx ./test/typeorm/**/*.spec.ts -t 20000 --exit",
"test":         "npm run test:core && npm run test:typeorm"
```
- [ ] Aggiungere test NUOVI specifici della v3 (tutti **unit**, nessun DB reale):
  - [ ] **Subpath import**: `import * as t from '@volcanicminds/backend/typeorm'` espone tutti i simboli di §3.2.
  - [ ] **Core senza data layer**: con `typeorm` NON installato, `import { start } from '@volcanicminds/backend'` e
        l'avvio del solo core **funzionano** (manager no-op). *(Simulabile mockando l'assenza del modulo.)*
  - [ ] **Proxy fail-fast**: l'accesso a `global.repository.X` continua a lanciare l'errore atteso.
  - [ ] **Magic Query (unit)**: test su `applyQuery`/`useWhere`/`useOrder` con filtri/sort/paginazione (come l'attuale
        `query.spec.ts`), **senza** DataSource reale.
- [ ] **Nessun Postgres necessario**: tutte le suite girano `NODE_ENV=memory`. Eventuali test d'integrazione su DB
      reale sono fuori scope (e in CI userebbero il service opzionale commentato in Fase 8).

**Accettazione Fase 7**: `npm test` esegue core + data layer in memory; i 4 test nuovi passano; nessuna dipendenza da Postgres.

---

## Fase 8 — CI (oggi assente, va creata)

Creare il file **`.github/workflows/ci.yml`** (contenuto pronto):
```yaml
name: CI
on:
  push:
    branches: [main, v3]
    tags: ['v*']
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm run depcruise
      - run: npm run build
      - run: npx publint

  test:
    runs-on: ubuntu-latest
    needs: verify
    env:
      NODE_ENV: memory
      MFA_DB_SECRET: unit-test-secret-please-change-32xyz
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci          # compila bcrypt (nativo); ubuntu-latest ha i build tools
      - run: npm test

  release:
    runs-on: ubuntu-latest
    needs: [verify, test]
    if: startsWith(github.ref, 'refs/tags/v')
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm, registry-url: 'https://registry.npmjs.org' }
      - run: npm ci
      - run: npm run build
      - run: npm publish --access public
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```
- [ ] Creare il file sopra.
- [ ] Configurare il secret **`NPM_TOKEN`** nelle repo settings (token npm con permesso publish sullo scope `@volcanicminds`).
- [ ] (Opzionale, solo se in futuro si aggiungono test d'integrazione su DB reale) aggiungere al job `test` un
      **service Postgres**:
```yaml
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: vminds, POSTGRES_PASSWORD: vminds, POSTGRES_DB: vminds }
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U vminds" --health-interval 10s --health-timeout 5s --health-retries 5
```
- [ ] Aggiungere il badge CI al README.

**Accettazione Fase 8**: la CI gira verde su una PR di prova; un import vietato la fa fallire (presidio Fase 5 attivo);
il job `release` pubblica su npm solo sui tag `v*`.

---

## Fase 9 — Migrazione consumer & deprecazione di `@volcanicminds/typeorm`

### 9.1 Guida di migrazione per le app consumer (generale)
Documentare in `MIGRATION.md` del repo backend. Il cambiamento è **solo di import + dipendenze** (zero modifiche al
codice runtime):
- [ ] Cambiare gli import del data layer:
```diff
- import { start as startDatabase, userManager, DataSource } from '@volcanicminds/typeorm'
+ import { start as startDatabase, userManager, DataSource } from '@volcanicminds/backend/typeorm'
```
- [ ] Nel `package.json` dell'app consumer: rimuovere `@volcanicminds/typeorm`; portare `@volcanicminds/backend` a
      `^3.0.0`; aggiungere le peer usate (`typeorm`, `pg`, `bcrypt`, `reflect-metadata`, `pluralize`).
- [ ] Iniezione manager invariata (`startServer({ userManager })`).

### 9.2 Migrazione del repo `volcanic-backend-sample` (consumer di riferimento — DA FARE)
È l'app di esempio ufficiale: va migrata e diventa la prova vivente che la v3 funziona. Operare su un branch `v3` del
repo sample, puntando alla `@volcanicminds/backend@3.0.0` (via tarball locale `npm pack` finché non è pubblicata).
- [ ] `package.json` del sample:
  - [ ] rimuovere la dipendenza `@volcanicminds/typeorm`;
  - [ ] `@volcanicminds/backend`: `^2.x` → `^3.0.0`;
  - [ ] aggiungere/confermare le peer: `typeorm`, `pg`, `bcrypt`, `reflect-metadata`, `pluralize` (il sample già ha
        `pg`; verificare le altre).
- [ ] Codice: aggiornare gli import nel bootstrap (`index.ts`) e ovunque si usi `@volcanicminds/typeorm`
      → `@volcanicminds/backend/typeorm`. (Verificato: nel sample l'import è nel solo `index.ts`.)
- [ ] Verifica: `npm ci && npm run check-all && npm test` del sample **verdi**.
- [ ] Aggiornare i doc del sample: **`README.md`**, **`CLAUDE.md`** (riferimenti al pacchetto typeorm separato →
      subpath), e rigenerare **`OUTPUT.md`** (`npm run combine`). `DOCKER.md` invariato salvo riferimenti errati.

### 9.3 EOL del pacchetto/repo vecchio (nessuno shim)
**Niente layer di compatibilità.** Chi vuole il data layer aggiornato migra all'import dal subpath; chi resta su
`@volcanicminds/typeorm@2.3.5` continua a funzionare con quella versione (è standalone), ma il pacchetto è **EOL**:
non riceverà più aggiornamenti.
- [ ] `npm deprecate @volcanicminds/typeorm "EOL — merged into @volcanicminds/backend@^3. Import from '@volcanicminds/backend/typeorm'. No further updates."`.
- [ ] Aggiornare il README del repo `volcanic-database-typeorm` con avviso EOL + puntatore alla nuova sede.
- [ ] **Archiviare il repo `volcanic-database-typeorm`** (read-only su GitHub) dopo aver mergiato la v3 del backend.

**Accettazione Fase 9**: il sample migrato (import dal subpath, peer aggiunte) builda e gira; il pacchetto vecchio
risulta deprecato su npm e il repo archiviato.

---

## Fase 10 — Documentazione & release

### 10.1 Documenti del repo `volcanic-backend` (revisione completa, file per file)
Tutti i file `.md`/`.txt` presenti oggi; per ciascuno l'azione richiesta:
| File | Azione |
|------|--------|
| `CLAUDE.md` | Già modificato nel **Task 0** (in apertura). Qui **solo verifica** di coerenza col risultato reale (struttura `lib/typeorm/`, `depcruise`, CI, wiring subpath). |
| `README.md` | Aggiungere sezione **"Data layer (TypeORM)"** con import dal subpath + sezione **peer dep opzionali**; aggiungere **badge CI**; bump versione 3.x; rimuovere riferimenti a `@volcanicminds/typeorm` come pacchetto separato. |
| `llms.txt` | Rigenerare/aggiornare includendo il sottoalbero `lib/typeorm/**` e l'import dal subpath; correggere ogni menzione del pacchetto typeorm separato. |
| `OUTPUT.md` | Rigenerare con `npm run combine` **dopo** aver esteso `combine.js` (sotto). |
| `combine.js` | Se elenca esplicitamente cartelle/file, **aggiungere `lib/typeorm/**` e `typeorm.ts`** alla lista sorgenti. |
| `NPM.md` | Aggiornare istruzioni di pubblicazione se citano i due pacchetti/script; allineare al flusso v3 (CI release su tag). |
| `DOCKER.md` | Verificare credenziali/porte Postgres citate (coerenti con Appendice C); aggiornare se obsolete. |
| `TODO.md` | Spuntare/aggiornare voci relative al merge; rimuovere TODO ormai risolti. |
| `docs/ADVANCED_ARCHITECTURE.md` | Aggiornare i path/import del data layer al subpath; confermare il pattern `service.use(req.db)` (invariato). |
| `docs/DATA_LAYER_MAGIC.md` | Aggiornare import/riferimenti a `@volcanicminds/backend/typeorm`; contenuto Magic Query invariato. |
| `docs/SCHEMA_OVERRIDING.md` | Verificare riferimenti a pacchetti/percorsi; aggiornare se citano il typeorm separato. |
| `docs/SECURITY_MFA.md` | Verificare riferimenti import; per il resto invariato. |
| `docs/TYPESCRIPT_GUIDE.md` | Aggiungere nota su `tsconfig` (3 opzioni del data layer, §2.3) e import dal subpath. |
| `docs/AUDIT_TASKS_TODO.md` | Aggiornare/chiudere eventuali voci impattate dal merge. |
| **`docs/configuration.md`** (NUOVO) | **Importare** dal repo typeorm (`volcanic-database-typeorm/docs/configuration.md`): è la doc di configurazione del data layer e va a vivere qui. |
- [ ] **CHANGELOG.md** (creare se assente): voce `3.0.0` con **BREAKING** (consolidamento pacchetti + nuovo import
      path), guida migrazione sintetica, e l'hash di partenza del data layer annotato in Fase 1.
- [ ] **MIGRATION.md** (Fase 9.1): rifinire e linkare dal README.

### 10.2 Documenti del repo `volcanic-database-typeorm` (EOL — congelato)
- [ ] `README.md`: banner **EOL** in testa + puntatore a `@volcanicminds/backend/typeorm`.
- [ ] `CLAUDE.md`: banner **EOL** in testa (idem).
- [ ] Gli altri (`llms.txt`, `OUTPUT.md`, `NPM.md`, `DOCKER.md`, `TODO.md`, `pr_description.md`, `docs/configuration.md`):
      **NON aggiornare** — il repo viene archiviato; `docs/configuration.md` è stato copiato nel backend (§10.1).

### 10.3 Documenti del repo `volcanic-backend-sample`
Coperti in **Fase 9.2** (README, CLAUDE.md, OUTPUT.md rigenerato). Qui solo conferma che siano allineati alla v3.

### 10.4 Indicizzazione & release
- [ ] **Context7**: aggiornare l'indicizzazione di `/volcanicminds/volcanic-backend`; segnalare deprecato
      `/volcanicminds/volcanic-database-typeorm`.
- [ ] Merge del branch `v3` su `main`; **tag `v3.0.0`** → la CI (Fase 8) builda e pubblica su npm.

**Accettazione Fase 10**: `@volcanicminds/backend@3.0.0` pubblicato; **tutti** i doc del repo backend allineati (tabella
§10.1 completa); sample migrato; typeorm deprecato/archiviato; build da tarball pulita.

---

## Appendice A — Riepilogo invarianti (da rileggere a fine lavoro)
- [ ] Core non importa il data layer (verificato da `depcruise` in CI).
- [ ] `typeorm`/`bcrypt`/`pluralize`/`reflect-metadata`/`pg` sono **peer opzionali**; un consumer "solo core" non li installa.
- [ ] `@volcanicminds/backend/typeorm` espone la **stessa** API pubblica dell'ex pacchetto (§3.2).
- [ ] Runtime di iniezione manager invariato; `global.repository` resta vietato (Proxy fail-fast).
- [ ] ESM puro, import `.js`, Node>=24, `tsconfig` NodeNext invariati.
- [ ] Build emette `dist/index.*` + `dist/typeorm.*`; `publint`/`attw` verdi.
- [ ] CI presente e verde; release su tag.

## Appendice B — Comandi rapidi
```bash
# sviluppo
npm ci
npm run check-all          # lint + type-check + depcruise
npm run build              # dist/index.* + dist/typeorm.*
npm test                   # core + data layer (tutto in memory, nessun Postgres)

# validazione packaging
npx publint
npx @arethetypeswrong/cli --pack .
npm pack --dry-run         # verifica che dist/typeorm.* e dist/types/typeorm/* siano nel tarball

# release (via CI su tag)
git tag v3.0.0 && git push --tags
```

## Appendice C — Variabili d'ambiente

### Necessarie per build/test del merge (questo lavoro)
| Variabile | Valore | Dove |
|-----------|--------|------|
| `NODE_ENV` | `memory` | test (core + data layer): suite in-memory, niente DB |
| `MFA_DB_SECRET` | qualunque stringa ≥32 char (es. `unit-test-secret-please-change-32xyz`) | test del data layer |
| `PORT` | `2231` | test core |
| `BROWSER` | `false` | test core |

### Runtime del data layer (per i consumer, NON per buildare il pacchetto — solo riferimento)
Invariate rispetto a oggi (documentate in `docs/configuration.md`): `DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD/DB_NAME`
(Postgres; default repo: `vminds/vminds/vminds` su `127.0.0.1:5432`), `LOG_DB_LEVEL` (def `warn`),
`DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` (def `false`), `VOLCANIC_CUSTOM_QUERY_OPERATORS` (def `false`, abilita `:raw`),
più le env del core (`AUTH_MODE`, `COOKIE_SECRET`, ecc.). **Nessuna nuova env introdotta dal merge.**
