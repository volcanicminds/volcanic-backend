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
| F68 | Precisa F64: l'SDK di OpenTelemetry lo avvia il framework in `preload()` quando è configurato, **senza `--import` obbligatorio**. Span HTTP da `@fastify/otel` (un plugin, non una patch), span delle query emessi dal data layer, `fetch` in uscita dall'instrumentazione di undici su `diagnostics_channel`. Il `--import` resta facoltativo, per l'auto-instrumentazione di librerie di terzi | `import-in-the-middle` 3.5.2 documenta solo `module.register()`, che su Node 26.10 stampa `DEP0205` (provato il 2 ottobre 2026); ok del manutentore lo stesso giorno |
| F69 | Precisa F65: `createAgent()` in `volcanic-tools` resta come **cablaggio** (modello da config ed env, tool di `defineTool`, identità del chiamante, span) e restituisce il `ToolLoopAgent` dell'SDK così com'è, senza un tipo suo. `ai` resta peer (`^7`): il consumer lo dichiara, come i provider `@ai-sdk/*`. Lo usano rag e il sample | un involucro dell'API di `ai` (messaggi, tool, stream, errori) insegue ogni minor, come TypeORM dentro il backend; una dipendenza interna darebbe due copie e tool non riconosciuti fra l'una e l'altra; ok del manutentore, 2 ottobre 2026 |
| F70 | Precisa F66: il server MCP accetta **sessioni e token d'integrazione** (`/token`), le credenziali che esistono già. Niente `oidc-provider` per ora: OAuth 2.1 per i connettori di terzi è un compito a parte, se servirà | un client di terzi (connettore di Claude.ai o ChatGPT) è l'unico caso che lo richiede; ok del manutentore, 2 ottobre 2026 |

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
- [x] **T-14.4** Statement preparati sui percorsi caldi (F62): banco prima, poi i preparati, poi lo
  stesso banco. L'evidenza riporta mediane e dispersione per percorso e motore; un preparato senza
  guadagno misurato non entra.
  Fatto il 2 ottobre 2026. Banco `scripts/bench-paths.ts` (`npm run bench:paths`): le letture che
  ogni richiesta autenticata fa prima del suo handler, chiamate attraverso i manager, con il login
  come controllo; 3 tenant da 2000 utenti e 200 token, 200 righe di registro, 200 utenti di
  sistema; PGlite a concorrenza 1, Postgres 14.22 a 1 e a 10 su un pool da 10; 15 giri da 1000
  operazioni, intercalati. Il cancello sul carico è quello di `tune`, spostato in
  `scripts/machine.ts`. Preparati in `lib/database/prepared.ts`, per database e per oggetto
  tabella, su mappe deboli: `getTenant` e `lookupTenant` del provider (lo stesso statement),
  `getTenantBySlug`, `retrieveUserByExternalId`, `retrieveTokenByExternalId`,
  `retrieveSystemUserByExternalId`. Mediane in µs, prima (giro 1) e dopo, IQR del dopo tra
  parentesi, su PGlite, Postgres a 1 e Postgres a 10:
  `tenant.byId` 494,4 → 374,6 (3,4%), 251,9 → 160,5 (8,1%), 136,8 → 52,1 (4,2%);
  `tenant.bySlug` 243,6 → 191,3 (10,5%), 123,4 → 73,7 (16,2%), 71,0 → 25,1 (3,9%);
  `user.byExternalId` 339,3 → 258,3 (5,9%), 177,7 → 105,0 (5,7%), 107,0 → 32,5 (10,6%);
  `token.byExternalId` 245,1 → 189,7 (2,7%), 122,8 → 79,6 (3,4%), 69,5 → 24,8 (4,3%);
  `systemUser.byExternalId` 265,6 → 205,8 (4,6%), 139,2 → 82,6 (8,9%), 81,0 → 27,8 (12,4%).
  Il login, controllo, resta tra 0,99 e 1,00. Tabella completa con i due giri prima e le loro IQR
  in `docs/TUNING.md`. I due giri prima differiscono al massimo dell'8%; il guadagno va dal 21% al
  24% su PGlite, dal 35% al 41% su Postgres a 1, dal 62% al 70% a 10. È il builder di Drizzle:
  costruire e rendere il lookup su `externalId` costa 64 µs di CPU in Node, misurati da soli; a
  concorrenza 10 il collo di bottiglia è il thread di Node. Il login non è preparato: la sua query
  sta sotto lo 0,1% della verifica bcrypt. Statement senza nome: con il nome, Postgres a
  concorrenza 1 scende ancora a 0,69-0,79 della variante senza nome, a 10 resta tra 0,98 e 1,06,
  PGlite è identico; il prezzo è uno stato di sessione sulla connessione (T-3.1) e PgBouncer 1.21
  o successivo in modalità transazione. Prove: `test/db/prepared.spec.ts`, 3 casi (isolamento tra
  due contenitori su PGlite e su Postgres con pool da 4; nessuno statement con nome sulla
  connessione dopo un lookup, pool da 1). Difetti piantati, presi e ritirati: cache per solo
  database (2 prove rosse, il contenitore B restituisce la riga di A), statement con nome (1 rossa,
  `pg_prepared_statements` a 1; su Postgres anche la prova d'isolamento si rompe sul nome
  riusato). `check-all` verde senza avvisi; `npm run coverage` 831 verdi e 30 saltate (prima 830),
  istruzioni 88,11% (3484 su 3954), rami 90,32%, funzioni 93,23%, righe 88,81%. Con un Postgres
  14.22 usa e getta e `DATABASE_URL`: `npm test` 936 verdi e 1 saltata (prima 933), banco
  multi-tenant 25 verdi.
- [x] **T-14.5** pino e OpenTelemetry nel backend (F63, F64, F68). **Fatto il 2 ottobre 2026**, in
  due commit. Pino (`83b3c68`): JSON in produzione e `pino-pretty` altrove (`LOG_FORMAT` vince,
  un valore sconosciuto rifiuta l'avvio), un solo logger anche per Fastify (`loggerInstance`, così
  `req.log` scrive dove scrive `log`), `redact` sulle credenziali che le rotte portano, e la query
  string fuori da ogni riga di log del framework (una prova scandisce i sorgenti). OpenTelemetry:
  spento finché gli `OTEL_*` standard non lo chiedono; lo avvia `preload()`, senza `--import`; tre
  peer opzionali (`@opentelemetry/sdk-node`, `@fastify/otel`, `@opentelemetry/instrumentation-undici`),
  la cui assenza rifiuta l'avvio; `@opentelemetry/api` è una dipendenza normale. Registra uno span
  per richiesta (`METHOD /route`), uno per statement del data layer, su Postgres e su PGlite, sotto
  lo span che l'ha emesso e con i letterali sostituiti da `?` (`queryTrace.ts`, nello stesso punto
  della guardia di sessione), uno per `fetch` in uscita, l'istogramma
  `http.server.request.duration` e `trace_id`/`span_id` su ogni riga di log scritta dentro uno
  span. Un SDK avviato prima con `--import` viene usato com'è. Trovati e chiusi: `@fastify/otel`
  scrive la query string in `url.path` (corretto con `requestHook`); a runtime gli span delle
  chiamate in uscita la portavano in `url.full` e `url.query` (corretto con `startSpanHook`); un
  client consegnato dalla coda d'attesa di `pg-pool` arriva nel contesto di chi l'ha rilasciato, e
  lo span della query prendeva come padre l'altra richiesta (corretto con `context.bind`). Prove:
  `test/db/queryTrace.spec.ts` (7 casi, 2 solo con `DATABASE_URL`) e `test/lib/telemetry.spec.ts`
  (7). Difetti piantati, presi e ritirati: niente `context.bind` (1 rossa), niente sostituzione dei
  letterali (2), niente override di `url.path` (1), niente `trace_id` nei log (1), niente
  `startSpanHook` (1). A runtime: server vero con OTLP/HTTP JSON verso un collector finto, span di
  richiesta con le query sotto l'handler, propagazione dal `fetch` al server, metrica e flush su
  `server.close()` con ritardo di batch a 60 s; zero occorrenze della query string in log ed export.
  Banco: A/B su PGlite con e senza span di query tra 0,989 e 1,003, dentro la dispersione; lo
  scarto di 3-5% su PGlite contro la baseline di T-14.4 è deriva della macchina. `check-all` verde;
  con un Postgres 14.22 usa e getta e `DATABASE_URL`, `npm run coverage` 963 verdi e 1 saltata,
  istruzioni 88,45% (3679 su 4159), rami 90,41%, funzioni 94,18%, righe 89,22%; banco
  multi-tenant 25 verdi. Non fatto, perché non deciso: l'id del tenant sugli span.
- [ ] **T-14.6** AI SDK 7 e `ToolLoopAgent` in `volcanic-tools` (F65).
- [ ] **T-14.7** MCP (F66): `defineTool` e adattatori in `volcanic-tools`, il server nel backend,
  poi rag T-7.6.

## 3. Segnalato, non toccato

`docs/TESTING_V5.md` §1 elenca ancora suite PGlite della v4 che non esistono più
(`test:e2e:pglite`, `test:e2e:mt:pglite`, `test:perf`): T-14.2 allinea la riga del data layer, il
resto della tabella aspetta una decisione del manutentore.

~~La risoluzione del tenant legge due volte la stessa riga di registro.~~ **Corretto il 2 ottobre
2026**, su ok del manutentore: `DataProvider.tenant()` riceve la riga di registro che il chiamante ha
appena letto dal tenant manager (mai una costruita dalla richiesta) e non la rilegge;
`lookupTenant` è sparito, `openContainer(id)` legge la riga una volta sola. Il fan-out
`every-tenant` rilegge ogni riga prima del suo job, perché la lista può avere minuti: un tenant
sospeso nel frattempo è rifiutato (prova in `test/lib/schedules.spec.ts`, che cade se il job si
fida della lista: difetto piantato, 1 rosso su 12). Banco contro il giro senza nome:
`tenant.byId` 374,6 → 179,8 µs su PGlite (0,48), 160,5 → 82,8 su Postgres a concorrenza 1 (0,52),
52,1 → 28,5 a concorrenza 10 (0,55), ora pari a `tenant.bySlug` (178,5; 70,9; 24,2); gli altri
percorsi dentro la dispersione della baseline. Verde: `check-all`, coverage 832 test,
`npm test` con Postgres 937 test, `test:e2e:mt:pg` 25 test.

~~La genesi senza `ADMIN_EMAIL` non arriva al suo messaggio.~~ **Corretto il 3 ottobre 2026**, su
ok del manutentore. Trovato il 2 ottobre durante la prova a runtime di T-14.5: `ensureGenesisAdmin`
contava gli amministratori con `roles:in`, ma `roles` è una colonna `text[]` e l'avvio cadeva con
`TypeError: value.map is not a function`, con o senza amministratori; i test passavano perché la
genesi vi girava con `ADMIN_EMAIL` o con un manager finto. Ora conta con `roles:arrayContains`. La
correzione ha scoperto il guasto sotto: i tre operatori array e i due json a più chiavi
(`jsonHasAllKeys`, `jsonHasAnyKey`) legavano i valori come lista, `($1)::text[]`, e fallivano su
ogni database (`malformed array literal`, o `cannot cast type record to text[]` con due valori),
mentre i test ne verificavano solo il parsing. In `lib/database/query/operators.ts` i valori vanno
ora come un solo parametro. Prove: `test/db/genesis.spec.ts` (senza `ADMIN_EMAIL`, su PGlite e
Postgres) e due test di esecuzione in `test/db/query.spec.ts`; difetto piantato, 5 rossi. A runtime
su Postgres 14, schema vuoto: exit 1 con il messaggio su `ADMIN_EMAIL`; con un amministratore:
`/health` 200. Verde: `check-all`, `npm test` con Postgres 971 test.
