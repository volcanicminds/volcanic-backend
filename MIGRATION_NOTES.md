# MIGRATION_NOTES — Volcanic Backend v3 (temporaneo)

> File di lavoro per il merge del data layer `@volcanicminds/typeorm` dentro `@volcanicminds/backend`
> come subpath `@volcanicminds/backend/typeorm`. Vive sul branch `v3`. Fonte per la voce CHANGELOG `3.0.0` (Fase 10).
> Da rimuovere prima del merge su `main` (o convertire in CHANGELOG).

## Versioni di partenza
- `@volcanicminds/backend`: **2.4.0** → target **3.0.0**
- `@volcanicminds/typeorm`: **2.3.5** (EOL dopo il merge)

## Commit di riferimento del data layer (sorgente del merge)
Repo `volcanic-database-typeorm`, branch `main`:
- **`bbcf3ffacd6e5f6cbcc6b06289d3c43a6ee81d4d`** (`bbcf3ff`) — _"fix(userManager): improve password change logic to prevent null dereference and enhance security"_

## Baseline Fase 1 (stato verde prima di ogni modifica)
- **typeorm** (sorgente, `main`): `npm ci` ✅ · `check-all` ✅ (0 err, 2 warn) · `test` ✅ **32 passing** — self-contained.
- **backend** (branch `v3`): `npm ci` ✅ · `check-all` ✅ (0 err, 2 warn) · `test` ✅ **49 passing**.

## ⚠️ Drift rilevato vs documento V3 (§Fase 1, righe 127–130)
Il documento dà per verificato che la baseline `npm test` del backend giri verde **standalone**. In realtà:
- `test/common/bootstrap.ts:4` importa `userManager` da **`@volcanicminds/typeorm`**, pacchetto **non dichiarato**
  in `package.json` (né `dependencies` né `devDependencies`) e **assente** dopo un `npm ci` pulito.
- La suite passava storicamente solo perché il repo gemello era installato/linkato a mano nell'ambiente.
- **Workaround Fase 1** (deciso col maintainer): il sibling è la sorgente corretta del workspace →
  installato in node_modules con `npm install ../volcanic-database-typeorm --no-save` (symlink, `package.json` invariato).
- **Risoluzione definitiva**: in **Fase 7** `bootstrap.ts` verrà ripuntato a `@volcanicminds/backend/typeorm`
  (self-reference interno), rendendo la suite del backend self-contained per la prima volta. Il symlink temporaneo
  va rimosso a quel punto.

## Siblings del workspace (assunti corretti, sorgente di verità)
- `/Users/davide/Workspace/volcanic-minds/volcanic-database-typeorm`
- `/Users/davide/Workspace/volcanic-minds/volcanic-backend-sample`
- `/Users/davide/Workspace/volcanic-minds/volcanic-tools`

---

## Avanzamento (Fasi 2–9) — decisioni e scostamenti dal documento

### Scelte architetturali concordate col maintainer
- **Container generico `lib/database/typeorm/`** (NON `lib/typeorm/`): permette di affiancare un adapter
  alternativo sotto `lib/database/` deprecando typeorm. Parallelo: `types/database/typeorm/`. Il confine
  depcruise è a livello `lib/database/` (il core non importa NULLA sotto `lib/database/`). Invariati: entry
  pubblico `typeorm.ts`, subpath `@volcanicminds/backend/typeorm`, cartella `test/typeorm/` (adapter-specifici).
- **attw "full green"** (scelta: fixo tutto). Due fix di packaging, anche PRE-ESISTENTI del core:
  1. **Consegna tipi**: `tsc` non emette i `.d.ts` sorgente. Fix: `types/database/typeorm/global.d.ts`→`.ts`
     (emesso da tsc) + `copy-assets.mjs` copia `types/global.d.ts` e `types/orm.d.ts` in `dist/types/`.
  2. **`require` condition**: rimossa e poi **RIPRISTINATA** — la rimozione rompeva la risoluzione CJS di
     tsx/mocha (`ERR_PACKAGE_PATH_NOT_EXPORTED`). Con `--profile esm-only` attw ignora la colonna CJS, quindi
     `require` può restare. Validazione ufficiale: `attw --pack . --profile esm-only` (verde su node16-ESM+bundler).

### Drift documento → codice (rilevati e gestiti)
- **§Fase 1**: baseline backend `npm test` NON è standalone (vedi sopra: `bootstrap.ts` → typeorm). Risolto in Fase 7.
- **§9.2**: il doc dice "import solo in `index.ts`" del sample → FALSO: anche `test/common/bootstrap.ts`,
  `src/config/database.ts`, `src/services/base.service.ts`, `src/entities/user.e.ts`. Tutti ripuntati al subpath.
- **Effetto collaterale del fix-tipi**: i tipi del core, prima danglanti (=`any`), ora risolvono davvero ed
  hanno esposto 10 type-error latenti nel sample. Fix (scelta: core+sample):
  - **core**: aggiunti `rawBody`/`isMultipart()`/`file()`/`files()` all'augmentation `FastifyRequest`
    (`types/global.d.ts`, entrambi i blocchi) — il framework usa quei plugin e ora li espone ai consumer.
  - **sample**: `BaseService.use(manager?: EntityManager)` (db è opzionale per design) — fix a punto singolo.

### Stato verde (Fasi 1–9.2)
- **backend** (`v3`): check-all (lint/type-check/**depcruise**) ✅ · build ✅ · publint ✅ · attw esm-only ✅ ·
  test **49 core + 32 typeorm** ✅ (self-contained).
- **sample** (`v3`): check-all ✅ · test **4 passing** ✅ (contro tarball v3 locale; dep dichiarato `^3.0.0`).
- CI creata: `.github/workflows/ci.yml` (verify/test/release; attw esm-only). Secret `NPM_TOKEN`: TODO esterno.

### Residuo (documentazione + azioni esterne)
- Task 0 + Fase 10.1: doc del backend (CLAUDE.md, README, llms.txt, OUTPUT.md, combine.js, NPM.md, DOCKER.md,
  TODO.md, docs/*, CHANGELOG.md, MIGRATION.md, import di `docs/configuration.md`).
- Fase 9.2 doc: README/CLAUDE.md/OUTPUT.md del sample. Fase 10.2: banner EOL su typeorm (README/CLAUDE).
- **Azioni ESTERNE (non eseguibili in autonomia)**: `npm publish` (via tag CI), `npm deprecate @volcanicminds/typeorm`,
  archiviazione repo typeorm, secret `NPM_TOKEN`, re-indicizzazione Context7, merge `v3`→`main` + tag `v3.0.0`.
