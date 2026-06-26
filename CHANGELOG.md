# Changelog

## 3.0.0 — Consolidamento del data layer (BREAKING)

### BREAKING
- **Il data layer `@volcanicminds/typeorm` è ora incluso in `@volcanicminds/backend`** come subpath interno
  `@volcanicminds/backend/typeorm` (stessa API pubblica). Il pacchetto separato `@volcanicminds/typeorm` è **EOL**.
- Le dipendenze del data layer (`typeorm`, `bcrypt`, `pluralize`, `reflect-metadata`, `pg`) sono ora **peer
  dependencies opzionali**: un consumer che usa solo il core non le installa più.

### Migrazione (consumer)
```diff
- import { start as startDatabase, userManager, DataSource } from '@volcanicminds/typeorm'
+ import { start as startDatabase, userManager, DataSource } from '@volcanicminds/backend/typeorm'
```
- `package.json` del consumer: rimuovere `@volcanicminds/typeorm`, portare `@volcanicminds/backend` a `^3.0.0`,
  aggiungere le peer usate (`typeorm`, `pg`, `bcrypt`, `reflect-metadata`, `pluralize`).
- L'iniezione dei manager è invariata (`startServer({ userManager })`). Guida completa in `MIGRATION.md`.

### Added
- Subpath export `@volcanicminds/backend/typeorm`; sorgente sotto `lib/database/typeorm/**` (container
  `lib/database/` predisposto per futuri adapter alternativi).
- **CI** (`.github/workflows/ci.yml`): `verify` (lint/type-check/depcruise/build/publint/attw), `test`, `release` su tag `v*`.
- Boundary enforcement core ↛ data layer via `dependency-cruiser` (`npm run depcruise`, incluso in `check-all`).
- Augmentation `FastifyRequest`: esposti `rawBody`, `isMultipart()`, `file()`, `files()` (dai plugin del framework).

### Fixed
- Packaging dei tipi: i `.d.ts` del core (`types/global.d.ts`, `types/orm.d.ts`) ora vengono consegnati in
  `dist/types/` (prima i re-export dei tipi non risolvevano nel tarball — `attw` Internal resolution error).

### Note
- Sorgente del merge: `volcanic-database-typeorm@bbcf3ff`.
- Tutti i test (core + data layer) girano in-memory (`NODE_ENV=memory`), nessun Postgres richiesto.
