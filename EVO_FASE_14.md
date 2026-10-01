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

- [ ] **T-14.1** PGlite nel provider (F60). Opzione `pglite` del provider, creata da
  `createPostgresProvider` per `control.engine: 'pglite'`; `withContainerLock` sull'unica
  sessione; export rifiutato con un messaggio che dice perché; la guardia sullo stato di sessione
  anche su PGlite; `shutdown` che chiude l'istanza. Prove: avvio da `start()` con
  `engine: 'pglite'`, migrazioni applicate, handle di controllo e di tenant, stato di sessione
  rifiutato. Difetto piantato: togliere il ramo PGlite da `createPostgresProvider`.
- [ ] **T-14.2** I test del data layer su PGlite (F61). `test/db/fixtures/migrated.ts` con il
  contenitore migrato su PGlite; le suite che oggi dicono «SQLite always, Postgres with
  DATABASE_URL» passano a PGlite; `managers`, `query`, `schema` e `sessions`, che girano solo su
  SQLite in memoria, passano a PGlite; in `test/migrations` gli insiemi, l'export e gli upgrade.
  L'evidenza riporta il conteggio delle prove prima e dopo, con il motivo di ogni prova che sparisce.
- [ ] **T-14.3** Via SQLite e libSQL (F58, F59). Codice: `adapters/sqlite`, `schema/sqlite.ts`,
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
