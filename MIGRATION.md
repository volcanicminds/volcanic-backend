# Migration guide — v2 → v3

La v3 **fonde il data layer `@volcanicminds/typeorm` dentro `@volcanicminds/backend`** come subpath
`@volcanicminds/backend/typeorm`. Il cambiamento per le app consumer è **solo di import + dipendenze**:
nessuna modifica al codice runtime, l'iniezione dei manager resta identica.

## 1. Aggiornare gli import del data layer

```diff
- import { start as startDatabase, userManager, DataSource } from '@volcanicminds/typeorm'
+ import { start as startDatabase, userManager, DataSource } from '@volcanicminds/backend/typeorm'
```

Vale per **ogni** file che importa dal data layer (entità, service, config, bootstrap dei test, ecc.), non solo
l'entry point. Cerca `@volcanicminds/typeorm` in tutto il progetto.

## 2. Aggiornare le dipendenze (`package.json` del consumer)

```diff
  "dependencies": {
-   "@volcanicminds/backend": "^2.x",
-   "@volcanicminds/typeorm": "^2.x",
+   "@volcanicminds/backend": "^3.0.0",
+   "typeorm": "^0.3.28",
+   "bcrypt": "^6.0.0",
+   "pluralize": "^8.0.0",
+   "reflect-metadata": "^0.2.2",
+   "pg": "^8.13.0"
  }
```

Le dipendenze del data layer sono **peer opzionali** del backend: vanno dichiarate dal consumer **solo se** si
usa il subpath `/typeorm`. Chi usa solo il core non installa nulla di tutto questo.

## 3. Invariato

- Iniezione manager: `await startServer({ userManager })`.
- `global.repository.X` resta **vietato** (Proxy fail-fast): usa `service.use(req.db)`.
- API pubblica del data layer identica (`start`, `User/Tenant/Token/Change`, manager, `DataSource`,
  `applyQuery`/`executeFindQuery`/`useWhere`/`useOrder`/…). Vedi `docs/configuration.md`.

## 4. Pacchetto vecchio

`@volcanicminds/typeorm@2.x` è **EOL** (nessun aggiornamento futuro). Chi resta su quella versione continua a
funzionare in modo standalone, ma per ricevere fix va migrato al subpath.
