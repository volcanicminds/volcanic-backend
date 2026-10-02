# EVO fase 14: solo Postgres, poi lo stack del 1° ottobre

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce dalle decisioni del manutentore del 1° ottobre 2026: restare sugli scenari S1, S2 e S3,
> tenere Postgres come unico motore (voce 23 di `EVO_PUNTI_APERTI.md`, riaperta) e adottare gli
> strumenti scelti per quegli scenari. Node 26 è già fatto: `.nvmrc` a v26.10.0 ed `engines` a
> `>=26` nei sei repository di v5 (qui il commit `53befa8`).
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5` da T-14.1 a T-14.4, con i ritocchi che ne
> discendono in `volcanic-backend-sample`, `volcanic-admin` (dati finti) e `volcanic-rag` (testi);
> `volcanic-tools` e `volcanic-rag` per i compiti successivi. Ordine scelto dal manutentore:
> SQLite per primo, poi gli statement preparati.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 0. Perché la fase esiste

Fino a oggi il data layer regge tre motori: Postgres, SQLite e libSQL. Il prezzo si paga a ogni
cambio di schema, scritto e provato due volte (T-13.1: `0004_step_up_*` nei quattro insiemi,
`control` e `tenant` per `pg` e per `sqlite`), e nella Magic Query, che tiene due dialetti e
rifiuta per nome gli operatori che SQLite non ha (Q9). Al 1° ottobre 2026 SQLite e libSQL
compaiono in 29 file di `lib/`, 24 di `test/` e 10 fra `docs/`, `README.md` e `llms.txt`;
l'adattatore conta 506 righe, il suo schema 371, la replica Litestream 184. Il manutentore ha
deciso di tenere Postgres soltanto, per il piano di controllo e per i tenant.

Togliere SQLite toglie anche il motore dei test. Oggi ogni suite del data layer gira su SQLite
sempre e su Postgres solo con `DATABASE_URL`, quindi `npm test` senza Postgres applica soltanto le
migrazioni `sqlite`, mai quelle che vanno in produzione. Eppure la specifica dei test assegna già
il data layer a PGlite (`docs/TESTING_V5.md` §1), e la decisione 13 di `EVO_FRAMEWORK.md` lo tiene
per sviluppo e test. Nel codice PGlite non c'è: `control.engine: 'pglite'` supera la matrice
(`lib/database/capabilities.ts`, `pglite: { none: true }`), poi `start()` lo passa a
`createPostgresProvider`, che apre un `pg.Pool` su `control.url`. È la casella `sì` senza codice
che l'intestazione della matrice vieta.

Prova del 1° ottobre 2026, con uno script usa e getta fuori dal repository (Node 26.9.0, PGlite
0.5.3, `drizzle-orm/pglite` 0.45.2). Le migrazioni `pg` del framework, applicate dal runner del
framework su due schemi di una sola istanza, arrivano a `0005` nel piano di controllo (14 tabelle)
e a `0004` nel tenant (9 tabelle) in 79 ms. Una query fuori transazione aspetta il commit di una
transazione aperta e non vede il suo `set local search_path`: PGlite serializza, quindi la regola
di T-3.1 regge anche su una connessione sola. Gli advisory lock sono rientranti sull'unica
sessione, e la contesa non si prova lì. Il costo: fra 0,6 e 1,0 s per avviare un'istanza e circa
1 GB di RSS (da 150 MB di base), che la chiusura non restituisce; `clone()` di un'istanza già
migrata costa fra 170 e 180 ms.

Il mini banco dello stesso giorno (Postgres 14 usa e getta, concorrenza 10, TypeORM 1.1.1 contro
drizzle-orm 0.45.2) ha confermato Drizzle e indicato dove sta il margine. Il builder è più lento
di TypeORM dal 18 al 26% su 5 query su 6; lo statement preparato va da 1,4 a 3,7 volte TypeORM e
da 0,81 a 1,05 volte il `pg` nudo. Heap 9,4 MB contro 14; cento schemi di tenant su una
connessione contro cento connessioni.

## 1. Decisioni

| # | Decisione | Motivo |
|---|---|---|
| F58 | **Solo Postgres**, per il piano di controllo e per i tenant, con le strategie `none`, `schema` e `container`. Escono l'adattatore SQLite e libSQL, `schema/sqlite.ts`, gli insiemi `control/sqlite` e `tenant/sqlite`, i contenitori a file con la replica Litestream, la copia del file nell'export, i peer `better-sqlite3` e `@libsql/client`, le righe della matrice e i rami SQLite della Magic Query. `Engine` diventa `'postgres' \| 'pglite'` | scelta del manutentore, 1° ottobre 2026 |
| F59 | La colonna `tenant.engine` del registro resta e vale `postgres`; l'API dei tenant non accetta altri motori | le migrazioni sono forward-only: toglierla costa una migrazione del piano di controllo e non cambia nessun comportamento |
| F60 | **PGlite ha un percorso vero.** Il provider Postgres accetta un'istanza PGlite al posto del pool (`drizzle-orm/pglite`), con le stesse tabelle qualificate, gli stessi handle, le stesse migrazioni `pg` e la stessa guardia sullo stato di sessione. `control.engine: 'pglite'` lo usa, in memoria o su `control.dataDir`. La matrice non cambia: `pglite` solo con `none`, rifiutato con un blocco `tenants` in produzione; export (`pg_dump`) e strategia `container` restano di un server Postgres | realizza ciò che `docs/TESTING_V5.md` §1 e la decisione 13 di `EVO_FRAMEWORK.md` già dicono; oggi la casella `pglite + none` è `sì` senza codice |
| F61 | I test del data layer girano **su PGlite sempre e su Postgres con `DATABASE_URL`**, come oggi su SQLite. Le fixture danno lo stesso contenitore migrato sui due motori; le prove legate al pool (D-01, D-02, la contesa dei lock) restano su Postgres reale | il verde senza `DATABASE_URL` continua a dire qualcosa, e da qui lo dice nel dialetto e con le migrazioni della produzione |
| F62 | Statement preparati di Drizzle sui percorsi caldi: login, token, risoluzione del tenant. Restano solo dove la misura prima e dopo, sullo stesso banco, mostra il guadagno | il margine misurato sta lì (§0); un preparato che non guadagna è solo codice in più |
| F63 | Log: pino resta, JSON in produzione e `pino-pretty` solo in sviluppo; Fastify riceve l'istanza come `loggerInstance`; `redact` sui segreti | oggi `lib/util/logger.ts` usa sempre il trasporto `pino-pretty`, anche in produzione, e Fastify ha un logger suo, spento di default (`index.ts:259`) |
| F64 | Tracce e metriche: OpenTelemetry su OTLP con `@fastify/otel` | scelta del manutentore, 1° ottobre 2026 |
| F65 | Modelli e agenti: AI SDK 7 e il suo `ToolLoopAgent` in `volcanic-tools`, al posto dell'involucro di Mastra (`lib/ai/agent.ts`); intervalli dei peer chiusi | oggi `"@mastra/core": ">=1.0.0"` e `"ai": ">=4.0.0"` accettano qualunque major futura |
| F66 | MCP: un contratto `defineTool` con adattatori in `volcanic-tools`; nel backend un server generato dalle rotte che lo dichiarano, che agisce con l'identità del chiamante e chiama l'API, mai il database | lo stesso confine di rag T-7.6: un assistente non vede più di quanto vedrebbe la persona che lo usa |
| F67 | Vettori: pgvector e LanceDB, entrambi motori di rag dietro `RetrievalStore`. Il lavoro sta già in `volcanic-rag/TASKS.md` §K, da T-11.2 a T-11.6, e qui non si duplica | scelta del manutentore, 1° ottobre 2026; §K l'aveva già pianificato il 28 settembre (D10) |

## 2. Compiti

- [x] **T-14.1** PGlite nel provider (F60). Opzione `pglite` del provider, creata da
  `createPostgresProvider` per `control.engine: 'pglite'`; `withContainerLock` sull'unica
  sessione; export rifiutato con un messaggio che dice perché; la guardia sullo stato di sessione
  anche su PGlite; `shutdown` che chiude l'istanza. Prove: avvio da `start()` con
  `engine: 'pglite'`, migrazioni applicate, handle di controllo e di tenant, stato di sessione
  rifiutato. Difetto piantato: togliere il ramo PGlite da `createPostgresProvider`.
  Evidenza: `test/db/pglite.spec.ts`, 8 prove verdi su Node 26.9.0 senza `DATABASE_URL` (avvio,
  migrazioni del controllo e di un tenant `schema`, `control.dataDir` dopo un riavvio, schema di
  controllo fissato all'avvio, SQL grezzo del tenant nel suo schema, lock, rifiuti per nome,
  chiusura); col ramo PGlite tolto 4 prove su 8 rosse. La guardia sull'istanza e nelle
  transazioni sta in `test/db/session-state.spec.ts`, con il resto della regola: è la suite che
  `check:session-state` esenta già, e l'elenco delle esenzioni non si allunga. `npm test` 864 verdi
  e 31 saltate, `check-all` verde. I tenant `schema` accanto a PGlite stanno
  nella stessa istanza fuori produzione, come dice la matrice (`capabilities.ts`); `container` è
  rifiutato prima di aprirla. Due difetti trovati dalle prove: `PGlite.create(undefined, opzioni)`
  scarta le opzioni (lo schema non veniva fissato); `isUniqueViolation` guardava solo l'errore di
  Drizzle, che avvolge quello del driver, quindi su Postgres un'email già registrata usciva come
  errore grezzo e il nuovo tentativo di `authFlow` non partiva (dal sorgente di `pg-core`, su un
  server non osservato). Ora scende nella catena `cause`.
- [x] **T-14.2** I test del data layer su PGlite (F61). `test/db/fixtures/migrated.ts` con il
  contenitore migrato su PGlite; le suite che oggi dicono «SQLite always, Postgres with
  DATABASE_URL» passano a PGlite; `managers`, `query`, `schema` e `sessions`, che girano solo su
  SQLite in memoria, passano a PGlite; in `test/migrations` gli insiemi, l'export e gli upgrade.
  L'evidenza riporta il conteggio delle prove prima e dopo, con il motivo di ogni prova che sparisce.
  Evidenza: non sparisce nessuna prova. Per file, prima e dopo, su Node 26.9.0 senza
  `DATABASE_URL`: `accessLog` 11, `accountCreation` 7, `authFlow` 24 e una saltata, `destruction` 5,
  `emailOtp` 12, `externalIdentity` 6, `oidc` 10, `managers` 26, `query` 23, `sessions` 11, gli
  upgrade 1, 2 e 1; `schema` da 12 a 13, con la prova nuova che mette ciò che le migrazioni
  costruiscono (colonne, tipi, chiavi, indici, nei due insiemi) accanto a ciò che `schema/pg.ts`
  dichiara. `npm run coverage` 865 verdi e 31 saltate (prima 864 e 31), istruzioni da 87,67% a
  88,07%; `check-all` verde. I file di `test/` che nominano SQLite o libSQL scendono da 24 a 11.
  Difetti piantati: una colonna dichiarata in `pg.ts` e mai generata fa rosse due prove (la nuova e
  la parità con SQLite); il modello col tenant fermo a `0001_sessions_tenant` ne fa rosse 50 in
  cinque suite. Ogni fixture è un'istanza a sé, clonata da una migrata una volta per processo
  (migrare costa circa 0,85 s, clonare circa 0,17 s); un upgrade fermo a una migrazione vecchia
  migra da zero. Il prezzo, una corsa per parte, col picco `maxRSS` del processo di mocha:
  `test:db` da 29,7 a 33,7 s e da 1261 a 1368 MB; `test:migrations` da 0,35 a 3,6 s e da 247 a
  1338 MB. Niente da portare in `sets`, che legge i file delle migrazioni e nessun database, né in
  `export`: il file SQLite se ne va con T-14.3, il dump vuole `pg_dump` e un server, e su PGlite
  l'export è rifiutato da T-14.1. Corretto per strada: `managers`, `query` e `sessions` aprivano il
  database in `before` e `after` al livello del file, che mocha esegue come hook di radice
  dell'intera corsa; ora stanno nel `describe` del file. Il rifiuto dell'email già registrata
  (D-17) gira sull'indice unico creato dalle migrazioni. La concorrenza di `authFlow` resta su
  Postgres con `DATABASE_URL`: PGlite serve tutto su una sessione. `docs/TESTING_V5.md` §1, riga
  del data layer, allineata; la riga Magic Query di §3 parla ancora di SQLite e va con T-14.3.
- [x] **T-14.3** Via SQLite e libSQL (F58, F59). Codice: `adapters/sqlite`, `schema/sqlite.ts`,
  `schema/entry/*.sqlite.ts`, `containers/replica.ts`, `exportSqliteFile`, i due insiemi `sqlite`,
  i rami di `db.ts`, `runner.ts`, `files.ts`, `query/operators.ts`, `managers/user.ts`,
  `access.ts`, `leases.ts`, `capabilities.ts`. Tipi: `Engine`, `ContainersConfig.directory` e
  `replica`. API: `lib/schemas/tenant.ts`. Script: `db:generate:sqlite`,
  `db:generate:tenant:sqlite`, `check-migration-sets`, `check-refusals`, e `tune`, che misura le
  pagine su PGlite. Poi `drizzle.config.ts`, peer e devDependencies, i documenti (README,
  `llms.txt`, `docs/*_V5.md`, `docs/MIGRATION_V4_V5.md`) e le righe di fatto di `CLAUDE.md`. Fuori
  dal backend: i commenti di `volcanic-backend-sample` (`drizzle.config.ts`,
  `src/config/general.ts`), i dati finti di `volcanic-admin` (`src/mock/data.ts`,
  `src/mock/controlManifest.ts`) e la frase di `volcanic-rag/TASKS.md` §K che lega LanceDB a chi
  gira su SQLite. Resta la coda della sentinella di rag su `node:sqlite`: è la coda locale di uno
  strumento da scrivania, non un motore del framework. Evidenza: `grep -rniE "sqlite|libsql"` sui
  repository, con l'elenco di ciò che resta e perché.
  Fatto il 2 ottobre 2026. Nel backend 90 file oltre a queste note: 33 tolti e 57 modificati,
  511 righe aggiunte e 17576 tolte, quasi tutte istantanee delle migrazioni SQLite. Fuori dal backend:
  `volcanic-backend-sample@ead18cd`, `volcanic-admin@6407c80`, `volcanic-rag@8dffaba`. Il sample
  voleva più dei commenti: `access()` non restituisce più `dialect` e `QueryOptions` non lo prende
  più, quindi `tsc` falliva su `base.service.ts` e 2 prove su 13 rispondevano 500 («the container
  speaks 'undefined'»); se ne vanno le due guardie sul dialetto e l'opzione passata a Magic Query.
  Cinque commenti motivavano una scelta con i due motori senza nominare SQLite, e il grep non li
  vedeva (`managers/session.ts` due volte, `managers/setting.ts`, `managers/user.ts`,
  `test/db/sessions.spec.ts`): riscritti sull'unico motore. Prove su Node 26.10.0, senza
  `DATABASE_URL`: `check-all` verde (insiemi `control` 6 e `tenant` 5, 94 rifiuti, 2 ritirati);
  `npm run coverage` 830 verdi e 30 saltate, prima 865 e 31. I 36 casi in meno: 29 nelle quattro
  suite tolte (`libsql`, `replica`, `sqlite`, `sqliteMigrations`) e 7 netti nelle altre, dove
  escono i casi del secondo motore (parità di tabelle, colonne e indici, istanti in millisecondi,
  LIKE ripiegato, operatori rifiutati per motore, checkpoint del file, `TENANT_CONTAINERS_DIR` col
  suo `envString`) e nascono tre prove: i motori a file rifiutati per nome, un `engine` diverso da
  `postgres` rifiutato prima di creare il tenant (F59), un insieme senza migrazioni rifiutato invece
  di riuscire vuoto. Istruzioni 88,04% (3475 su 3947; prima 88,07%), rami 90,27%, funzioni 93,14%,
  righe 88,72%. Con un Postgres 14.22 usa e getta e `DATABASE_URL`: `npm test` 933 verdi e 1
  saltata (vuole un `pg_dump` più vecchio del server), banco multi-tenant 25 verdi. Difetti
  piantati, presi e ritirati: `sqlite` nell'enum `engine` dell'API (1 prova rossa), una riga
  `sqlite` nella matrice (2), la cartella del consumer senza `pg` (1), `ilike` diventato `like` (2,
  su PGlite). Consumer sullo stesso Postgres: sample `check-all` senza errori, 13 prove più le 4
  della ricerca semantica; `volcanic-rag-sample` `tsc` pulito e 63 prove; admin `tsc` ed `eslint`
  sui due file verdi. `npm prune` toglie dal `node_modules` del backend i pacchetti SQLite rimasti;
  la lockfile non cambia. Cosa resta di `sqlite|libsql`, fuori da `node_modules`, `.git` e build:
  nel backend `lib/` 0 file (29 il 1° ottobre); `docs/`, README e `llms.txt` 1 file (erano 10),
  `docs/PGLITE.md`, documento v4 col cartello di sostituzione; `test/` 2 (24 il 1° ottobre), le
  guardie che rifiutano i motori a file per nome (`capabilities.spec.ts`,
  `tenantProvisioning.spec.ts`); i file `EVO_*`, storia e piano; nella lockfile i peer opzionali
  di `drizzle-orm`; fuori da git `OUTPUT.md`, `.playwright-mcp/` e `docs/_BRAINSTORMING_STACK.md`.
  Nelle lockfile di sample, rag e rag-sample restano i metadati del backend di prima (peer e
  devDependencies), che il prossimo `npm install` riallinea. In rag la coda della sentinella su
  `node:sqlite` (`src/sentinel/queue.ts`, `llms.txt`, `README.md`, `TASKS.md`), che resta. Admin e
  tools 0, salvo la build della demo (`dist-demo`, ignorata da git).
- [ ] **T-14.4** Statement preparati sui percorsi caldi (F62): banco prima, poi i preparati, poi lo
  stesso banco. L'evidenza riporta mediane e dispersione per percorso e motore; un preparato senza
  guadagno misurato non entra.
- [ ] **T-14.5** pino e OpenTelemetry nel backend (F63, F64).
- [ ] **T-14.6** AI SDK 7 e `ToolLoopAgent` in `volcanic-tools` (F65).
- [ ] **T-14.7** MCP (F66): `defineTool` e adattatori in `volcanic-tools`, il server nel backend,
  poi rag T-7.6.

## 3. Segnalato, non toccato

`docs/TESTING_V5.md` §1 elenca ancora suite PGlite della v4 che non esistono più
(`test:e2e:pglite`, `test:e2e:mt:pglite`, `test:perf`): T-14.2 allinea la riga del data layer, il
resto della tabella aspetta una decisione del manutentore.
