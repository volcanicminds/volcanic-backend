# EVO stato dei lavori

> **Questo file è lo stato, non il piano.** Cosa fare, con quali file e con quale criterio di
> chiusura, sta in `EVO_FRAMEWORK.md` e nei file `EVO_FASE_*.md`; le regole che le specifiche
> non dicono e i punti aperti stanno in `EVO_PUNTI_APERTI.md`. Qui lo stato per area e una riga
> per compito: descrivere di nuovo un compito qui significa crearne una seconda versione che
> diverge alla prima modifica.
>
> **Regola unica**: una casella si chiude solo con un'**evidenza citata**, cioè un `file:riga`,
> un identificativo di commit o l'output di un comando. Senza evidenza resta aperta.
>
> Linea di lavoro: branch `v5`, su `origin` nei sei repository; `develop` e `main` non si
> spingono. Versione `5.0.0`, data layer Drizzle, solo Postgres (PGlite per sviluppo e test).

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

**Il banco nero è verde, 8 test su 8**, su Postgres 18 in Docker
(`test/e2e-mt-pg/isolation.e2e.spec.ts`, dentro `npm run test:e2e:mt:pg`): è quello di T-0.2, non
modificato per farlo passare. Le quattro proprietà che la v4 viola (1, 2, 4, 5) passano sulla v5.
È un **cancello di regressione**: se torna rosso, qualcosa che funzionava si è rotto.

**Le fasi da 0 a 20 sono chiuse**: le fasi da 0 a 9 in `EVO_FRAMEWORK.md` con le tabelle in fondo
a questo file, le altre nei file `EVO_FASE_10.md` e seguenti. Tutti i difetti accertati della
sezione 4 di `EVO_FRAMEWORK.md` sono chiusi. Ciò che resta sta nel paragrafo «Cosa resta aperto».

## Cosa è fatto, per area

### Data layer e motori

Il data layer è Drizzle e il motore è solo Postgres: piano di controllo e tenant su Postgres, per
schema o per contenitore. SQLite e libSQL sono fuori dal framework (codice, tipi, API, script,
peer, documenti) e dai dati finti dell'admin, e il sample non ha guardie sul dialetto (T-14.3).
Restano le due guardie che rifiutano i motori a file per nome, le menzioni nei file `EVO_*` e la
coda della sentinella di rag su `node:sqlite`. `control.engine: 'pglite'` apre PGlite nel provider
Postgres, in memoria o in `control.dataDir`, con la stessa guardia, le stesse migrazioni e i
tenant `schema` fuori produzione (T-14.1). I test del data layer girano su PGlite, su istanze
clonate da una migrata con le migrazioni vere, e una prova tiene lo schema migrato contro quello
dichiarato (T-14.2); il costo misurato è di circa 7 s sulle due suite e, su `test:migrations`, un
picco di memoria di 1338 MB contro 247.

La risoluzione del tenant e le letture per `externalId` di utente, token e utente di sistema usano
statement preparati senza nome (T-14.4): mediane dal 21% al 24% più basse su PGlite, dal 35% al
41% su Postgres a concorrenza 1, dal 62% al 70% a concorrenza 10, misurate con
`npm run bench:paths` (numeri in `docs/TUNING.md`). Il login non è preparato. Gli statement con
nome sono vietati da una prova, perché la connessione tornerebbe al pool con uno stato (T-3.1).
`provider.tenant()` riceve la riga di registro già letta, e `tenant.byId` costa circa metà
(0,48-0,55), pari a `tenant.bySlug` (`EVO_FASE_14.md` §3).

`executeFind` lascia fuori `sensitiveFields` e applica `_fields` (tabella «Fuori piano»). Gli
operatori array e json di Magic Query funzionano su ogni database (`EVO_FASE_14.md` §3).
`npm run test:budget` conta gli statement per richiesta (0 per `/health`, 2 per `/users/me`, 4 per
`/users`, su un tenant creato via API) e fallisce se crescono; `npm run bench:http` misura
richieste intere con autocannon, a mano e senza cancello, e in CI gira solo come prova di
funzionamento (`docs/TUNING.md`, `docs/TESTING_V5.md` §1).

### Autenticazione, sessioni e token

Registro delle sessioni e rotazione del refresh token (`EVO_FASE_11.md`): tabella `session`, port
`SessionManagement` e manager, credenziale opaca con rotazione, finestra di grazia e rilevamento
del riuso, logout che revoca; rotte `/auth/sessions` sui due piani, purga per predicato e comando
`npx volcanic sessions --purge`, avviso di boot su `reset_external_id_on_login`. Il banco
multi-tenant prova che una sessione vive nel contenitore del suo tenant, che il credenziale di un
tenant presentato come un altro è rifiutato e che dopo logout o riuso la sessione non si rinnova.
La lista dei dispositivi collegati è un pannello dell'account nella console, non una risorsa del
manifest, che ne annuncia l'endpoint per piano (T-11.18).

Il motore di autenticazione è componibile e uno solo per i due piani (`lib/auth/engine.ts`,
`EVO_FASE_12.md`, `docs/AUTH_FLOW_V5.md`): autenticatori `password`, `totp`, `email-otp` e OIDC,
contratto per SMS e social con un autenticatore finto di forma social; rotte `/auth/flow/*` e
`/system/auth/flow/*` con il credenziale opaco in cookie o nel corpo; il pavimento MFA applicato
dal motore con l'iscrizione dentro il flusso; i metodi scritti sulla riga della sessione; il
tenant dei ritorni letto dallo `state`. `MANDATORY` senza store dei flussi rifiuta l'avvio e la
scrittura sul tenant. `email-otp` risponde in modo uniforme per indirizzo esistente e inesistente,
con tetti per flusso e per soggetto e la consegna dopo la risposta. I provider di deployment sono
validati all'avvio, con i segreti letti una volta; i provider per tenant stanno sulle rotte di
controllo e il segreto non viene mai restituito (F40). OIDC carica `openid-client` solo al primo
uso (l'import statico è vietato), usa sempre PKCE e `nonce`, spende lo `state` al primo ritorno,
apre la sessione solo al passo successivo e accetta `idp-mfa` solo dove il provider è dichiarato
affidabile; un IdP finto senza rete serve le prove (`npm run test:oidc:offline`, anche in CI). Il
ritorno dall'IdP fallito è risposto dal passo successivo con il suo codice. Il JIT rifiuta
l'indirizzo non verificato.

Chi crea un account in un tenant (F49): `invite`, `approval` o `open`, con l'insieme ammesso
fissato dal piano di controllo (per tutti o per un tenant) e la scelta del tenant dentro
l'insieme; registrazione chiusa di fabbrica, tabella `setting`, colonna `approved`, approvazione
da `/users/:id/approve`, stessa regola per `register` e per il JIT. `createUser` scrive il
`confirmation_token` per ogni account non confermato, consegnato al middleware `global.postAuth`.

Il login passa solo dal flusso: il gancio rifiuta con 401 ogni JWT con claim `role`,
`check:refusals` impedisce il ritorno di `MFA_REQUIRED`, le rotte MFA di gestione vogliono una
sessione completa ed `enable` non emette sessione, il manifest annuncia le rotte del flusso per
piano. Il login della piattaforma risponde 401 `AUTH_INVALID_CREDENTIALS`. Il reset MFA
d'emergenza cerca l'amministratore nel piano di controllo e scrive `mfa.emergency_reset` nel
registro degli accessi. Il sample (T-12.44, `volcanic-backend-sample@8c9648b`) e l'admin (T-12.45,
`volcanic-admin@80e981c`) entrano con il flusso: TOTP, iscrizione forzata, codice via email e,
nell'admin, OIDC, in bearer e in cookie, verificati con Playwright sui due piani.

Lo step-up (`EVO_FASE_13.md`) segue la strada A con una finestra di 5 minuti: `freshAuth` sulle
rotte, `auth_time` nel token, `POST /auth/flow/step-up` sui due piani, migrazioni
`0004_step_up_*`; nell'admin la finestra di riautenticazione e la richiesta ripetuta (T-13.6,
`volcanic-admin@3577eaa`). Lo step-up copre creazione, modifica, rigenerazione e sblocco dei token
di ogni piano (F101) e gli upload dell'admin.

`POST /token` restituisce il JWT una volta senza salvarlo e vuole `expiresAt`; un token bloccato o
cancellato smette alla richiesta dopo, e il blocco sta su `/token/:id/block`; lo stesso vale per un
utente cancellato, bloccato o che si disiscrive, su entrambi i piani (`EVO_FASE_14.md`, T-14.7).
Il token di integrazione porta `tid` come una sessione, e una macchina non nomina il tenant con
l'header (F79); sotto tenancy un token senza `tid` è 401 `TOKEN_TENANT_MISSING` (F81). I token
della piattaforma stanno a `/system/tokens`; l'etichetta `typ: 'integration'` distingue token e
persone su ogni piano con una regola unica fra token e sessione, e il catalogo di sistema è esteso
dai permessi dichiarati (F97, F98, F99, F103, F104, `EVO_FASE_18.md`).

Il registro degli accessi `access_log` ha il blocco `accessLog` della configurazione, con
l'ambiente che vince; scrive logout, revoca, invalidazione, MFA di gestione e riuso sui due piani;
si legge da `/access-log` per l'`admin` del tenant e da `/system/access-log` con la capability
`access-log` di `system:auditor`; si purga con due soglie (90 e 180 giorni), in modo
opportunistico e con `npx volcanic access-log --purge [--tenants]`.

Dall'audit (`docs/AUDIT_TASKS_TODO.md`) sono chiusi S5, S7, S13, S16, Q10 a meno di
`systemUserManager`, Q11 e Q12: limiti su ogni rotta che prende un segreto, account bloccato
risposto come segreto sbagliato, `BODY_LIMIT` e tetti multipart, `npm audit --omit=dev` in CI.

### Tenant e ciclo di vita

Con la strategia `container` il contenitore è un database per tenant, creato, migrato, esportato
intero ed eliminato con `FORCE`; una strategia diversa da quella del deployment è rifiutata (F77).
La porta pubblica `TenantLifecycle` (`start({ tenantLifecycles })`) annulla per intero una
creazione fallita, esporta con `artifacts` e ferma la distruzione se un pacchetto non rimuove la
sua parte; `access(handle).raw` dà l'accesso diretto (F78). Un contenitore esistente è rifiutato
anche sotto `schema`, 409 `TENANT_LOCATOR_TAKEN`, perché l'annullamento non elimini quello di un
altro tenant (F80, `EVO_FASE_16.md`). La distruzione porta la riga allo stato finale `destroyed`
e chiede come secondo fattore TOTP, o un codice via email per l'operatore senza MFA (tabella
«Fuori piano», `docs/API_V5.md` §6.2). `withTenant(server, slug, fn)` presta il contenitore di un
tenant fuori da una richiesta o da un job, sullo stesso prestito dei job (F94, T-19.1,
`EVO_FASE_19.md`).

Il pacchetto di un tenant (`EVO_FASE_17.md`, da F82 a F93) ha due profili, cliente e operatore;
la chiave di cifratura non esce mai e le credenziali viaggiano svuotate, preparate in un
contenitore temporaneo. Il pacchetto è una cartella con manifest e busta, scaricabile in tar, e lo
servono `POST /tenants/import`, `POST /tenants/:id/move` e `POST /token/:id/reissue`; ogni
ripristino scrive una riga nuova con un id nuovo e cambia l'`external_id` dei token; gli indici
unici lasciano fuori le righe `destroyed`. Il ripristino esegue l'SQL del dump con il ruolo del
data layer e il lettore dei meta-comandi si aggira (barra a metà riga, `\.\r`, `$$`, codifiche
client): per questo la busta è firmata con `PACKAGE_SIGNING_KEY` e un pacchetto non firmato da
questa piattaforma non si ripristina, 422 `RESTORE_SIGNATURE_INVALID` (T-17.9). I dati dell'app,
cifrati o no, sono del cliente e li tratta un aggancio dell'app con il profilo scelto all'export
(F92, F93, T-17.10). L'amministratore del tenant esporta e scarica il suo tenant; export,
download, import e trasloco nel piano di controllo restano al solo `system:admin`, con lo
step-up; ogni download scrive un evento; c'è un pacchetto per tenant in ciascun piano, sostituito
dal successivo, e una pulizia per età che il progetto accende (F89, T-17.11). In rag il corpus per
tenant è T-7.2, `describe` e `restore` del corpus sono T-7.12 (`volcanic-rag/TASKS.md`).

### Registri e telemetria

In produzione i log sono JSON, con un solo logger e la redazione delle credenziali; OpenTelemetry
si accende con gli `OTEL_*` standard e parte da `preload()` senza `--import`, con span di
richiesta, di query (Postgres e PGlite) e di `fetch`, la durata delle richieste e `trace_id` nei
log; nessuna query string finisce in log e span (T-14.5). Ogni riga di log e ogni span del lavoro
di un tenant portano solo l'id del tenant, `tenant_id` e `tenant.id` (F75, T-15.1). Il registro di
governo `governance_log` (F76, T-15.2) ha 21 azioni, scrive modifica ed evento nella stessa
transazione e l'intento prima di export e distruzione, e si legge con la capability
`governance-log` dell'auditor; è immutabile in ogni database, che lo difende da sé, e gli atti sui
token del tenant stanno nel registro del tenant (F100, F102, T-18.2); ogni riga ha il suo autore
per tabella, un token compreso (F104). La tabella delle modifiche è `change_log` (F95); accessi e
governance sono due tabelle distinte e l'impersonificazione resta com'è (F96, T-20.1).

### AI, tool e MCP

`volcanic-tools` usa l'AI SDK 7: `createAgent()` restituisce il `ToolLoopAgent` dell'SDK,
costruito una volta, che riceve il chiamante a ogni chiamata con `options: { caller }` (F74); una
fabbrica unica tiene la `apiKey` configurata di un provider. Con `@ai-sdk/otel` installato le
chiamate AI finiscono negli span, senza il contenuto salvo
`OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true` (F72). `defineTool` è servito dall'AI SDK
e da un server MCP (`./mcp`) con lo stesso risultato e lo stesso errore, senza cambiare il backend
(F73). Il sample espone `POST /mcp`, tre tool chiamati con la credenziale di chi chiede, con
l'Origin controllato in tools; in `volcanic-rag-sample` i tool `rag_search` e `rag_document` del
subpath `/tools` di rag stanno su `/mcp`, e ogni ruolo trova dall'assistente esattamente ciò che
trova con `/rag/search` (rag T-7.6).

### Upload, versioni e consumer

La rotta degli upload (tus) risponde 401 `UNAUTHORIZED` salvo `isValid(req) === true`, e il
`TransferManager` di tools implementa `getPath` e `isValid` (`docs/MIGRATION_V4_V5.md` §35). Node
26 è nei sei repository (qui `53befa8`). Tutto il ramo `v5` è alla `5.0.0` (tabella «Fuori
piano»). Sample, admin e rag-sample girano sulla v5.

Un pacchetto con avvisi per gli amministratori li registra con `start({ noticeSources })`; il
backend li serve su `GET /notices` e `GET /system/notices`, filtrati per chi legge, e tiene in
`notice_seen` chi ha visto cosa, nel contenitore di chi legge (F105, F108, T-21.1,
`EVO_FASE_21.md`).

## Cosa resta aperto

- **Pubblicazione su npm** di backend, tools e admin, su richiesta esplicita: `5.0.0` su
  `latest`, senza alpha e senza `next`. Il sample prende backend e tools dai checkout accanto
  (`file:../volcanic-*`, `volcanic-backend-sample@051721a`); dopo la pubblicazione torna agli
  intervalli del registro e `npm install` riscrive il lock (tabella «Fuori piano»).
- **Sorte di `develop` e `main`**: se `v5` confluisce in `develop` o lo sostituisce, e quando
  `main` passa alla 5; serve una richiesta esplicita (tabella «Fuori piano»).
- **Misure su macchina dedicata**: quelle di T-9.4 vengono da un portatile condiviso
  (`docs/TUNING.md`, `EVO_PUNTI_APERTI.md`).
- **SAML** resta fuori finché `@node-saml/node-saml` non pubblica una versione nuova; il
  collegamento self-service degli account viene dopo la 5.0 (F48, `EVO_FASE_12.md`).
- **Versioni 4.x e 3.x pubblicate**: restano esposte al bypass della MFA per reiscrizione, chiuso
  sulla v5 da T-12.1 (`1b50994`); nessun hotfix è richiesto.
- **Audit**: Q10 resta aperto per `systemUserManager` (`docs/AUDIT_TASKS_TODO.md`).
- **CI**: restano fuori SAST su rag, CI del sample e prove del sample nella CI di rag (T-10.8 di
  rag); dettaglio nella tabella «Fuori piano».
- **Dipendenze**: le major di sviluppo (TypeScript 7, ESLint 10, `globals` 17, PGlite) non sono
  aggiornate; gli avvisi Dependabot su GitHub sono del branch di default `main`, che non si tocca.
- **Versionamento delle API**: tabella «Fuori piano».
- **Canale degli avvisi**: la prima fonte (il RAG, T-7.18 di `volcanic-rag/TASKS.md`) e la pagina
  della console (T-21.2, `EVO_FASE_21.md`).
- In rag, vettori, ricerca e ingestion sono T-11.3, T-11.6 e da T-8.2 a T-8.4 di
  `volcanic-rag/TASKS.md`.

## La rottura da guardare per prima

In qualunque consumer: il login risponde **401** dove v4
rispondeva 403, e un livello HTTP che tratta il 401 come «sessione scaduta, torna al login»
trasforma una password sbagliata in un redirect proprio sulla rotta di login.

**Come si verifica tutto, da una sessione nuova.** Serve un Postgres 18, sempre in Docker: `docker run -d --name
vm-pg -e POSTGRES_USER=volcanic -e POSTGRES_PASSWORD=volcanic -e POSTGRES_DB=volcanic -p
55432:5432 postgres:18-alpine`, poi con `DATABASE_URL=postgres://volcanic:volcanic@127.0.0.1:55432/volcanic`
si lanciano `npm run check-all`, `npm test` e `npm run test:e2e:mt:pg`. Senza `DATABASE_URL` le
suite che vogliono un database reale **saltano** invece di fallire, quindi un verde senza quella
variabile non dice quello che sembra.

**Prima di toccare qualsiasi cosa**, leggere la sezione 0 di `EVO_FRAMEWORK.md`: dice quali
documenti esistono e in che ordine si leggono.

---

## Fase 0: preparazione e prove

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-0.1 | Branch, versione, catena di verifica, rimozione di TypeORM | `[x]` | branch `v5`, versione `5.0.0` in `package.json`, Node 26 (`.nvmrc`, `engines`). Nessuna dipendenza TypeORM; `drizzle-orm` e `pg` sono peer opzionali (`peerDependenciesMeta`); `exports` espone solo `.` e `./db`. `tsconfig.test.json` porta i test nel type-check (D-25); `npm run check-all` è la catena di verifica. Commit `db20063` |
| T-0.2 | Banco di prova nero su Postgres reale | `[x]` | `test/e2e-mt-pg/isolation.e2e.spec.ts`: 8 test sulle proprietà di `docs/TESTING_V5.md` §2.4, con l'harness in `test/e2e-mt-pg/harness.ts`. Si esegue con `npm run test:e2e:mt:pg` (`DB_POOL_MAX=1`) e passa su Postgres 18 in Docker |
| T-0.3 | Le specifiche dei contratti | `[x]` | `docs/SCHEMA_V5.md`, `docs/MAGIC_QUERY_V5.md`, `docs/MANAGERS_V5.md`, `docs/AUTHORIZATION_V5.md`, `docs/API_V5.md`, `docs/CONFIGURATION_V5.md`, `docs/TESTING_V5.md` |
| T-0.4 | Verifica della matrice delle combinazioni | `[x]` | le quattro combinazioni supportate stanno in `docs/CONFIGURATION_V5.md` §2: Postgres senza tenant, per schema, per contenitore, e PGlite per sviluppo e test. All'avvio le impone la `MATRIX` di `lib/database/capabilities.ts` |

## Fase 1: la forma del sistema

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-1.1 | Configurazione `control` e `tenants` | `[x]` | i blocchi `control` e `tenants` stanno in `lib/config/general.ts`; `normalizeOptions` in `lib/loader/general.ts` applica i default e `lib/util/merge.ts` fa la fusione profonda (D-21, test in `test/lib/merge.spec.ts`). Tipi `ControlConfig` e `TenantsConfig` in `types/global.d.ts`; il core li legge da `lib/util/tenancy.ts` |
| T-1.2 | Due tipi distinti, `ControlHandle` e `TenantHandle` | `[x]` | brand fantasma in `types/global.d.ts` (`controlBrand`, `tenantBrand`), che non nominano l'ORM (invariante 10); `index.ts` esporta `ControlHandle`, `TenantHandle`, `DataHandle`. La richiesta porta `req.control`, `req.tenant`, `req.tenantInfo`; i manager prendono come primo argomento `dataContext(req)` (`lib/util/tenancy.ts`), secondo `docs/MANAGERS_V5.md` |
| T-1.3 | Porte del data layer e subpath `/db` | `[x]` | `lib/database/ports.ts` (`ConnectionProvider`, `MigrationRunner` e le altre porte); `db.ts` è l'entry `@volcanicminds/backend/db` negli `exports` di `package.json`, con il confine imposto da `.dependency-cruiser.cjs` (`npm run depcruise`). L'API pubblica non nomina l'ORM |
| T-1.4 | Matrice di capacità e rifiuto all'avvio | `[x]` | `lib/database/capabilities.ts`: due motori (`postgres`, `pglite`), tre strategie, `assertSupported` con `onFatal` iniettabile, chiamata in `db.ts` all'avvio, quando nessuna connessione è aperta. Test in `test/db/capabilities.spec.ts` (`npm run test:db`). Chiude D-04 |
| T-1.5 | Regola su cosa sta nel piano di controllo | `[x]` | fuori dal contenitore del cliente sta solo ciò che potresti pubblicare: `docs/SCHEMA_V5.md:33` e `llms.txt:1205` |

## Fase 2: il data layer su Drizzle

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-2.1 | Schema base v5 | `[x]` | `lib/database/schema/pg.ts`: fabbriche per schema `appTables` e `registryTables`, colonne `timestamptz`, registro fuori dai contenitori. UUID v7 generato nel processo da `lib/database/uuid.ts` (chiude D-28). Test in `test/db/schema.spec.ts` e `test/db/uuid.spec.ts` |
| T-2.2 | Adattatore Postgres | `[x]` | `lib/database/adapters/postgres/index.ts` (`PostgresProvider`): handle di controllo e di tenant sulle tabelle qualificate, cache dei contenitori, creazione e rimozione dello schema con identificatori validati. Test contro Postgres reale in `test/db/postgres.spec.ts` |
| T-2.3 | Adattatore SQLite e libSQL | `[-]` | il framework è solo Postgres, con PGlite per sviluppo e test (T-14.3 in `docs/evo/EVO_FASE_14.md`) |
| T-2.4 | Magic Query v5 | `[x]` | `lib/database/query/`: catalogo operatori (`operators.ts`), parser di `_logic` con limiti (`logic.ts`), assemblatore con validazione e codici di errore stabili (`QueryErrorCode` in `errors.ts`), campi sensibili non filtrabili (`DEFAULT_SENSITIVE_FIELDS`). Contratto in `docs/MAGIC_QUERY_V5.md`, test in `test/db/query.spec.ts` |
| T-2.5 | Manager riscritti | `[x]` | `lib/database/managers/`: manager su Drizzle con il contesto come primo argomento (`runtime.ts` lancia se manca), bcrypt a costo minimo 12 (`BCRYPT_COST` in `user.ts`), segreto MFA cifrato. Test in `test/db/managers.spec.ts` e, per i null-object, `test/lib/defaultManagers.spec.ts` |
| T-2.6 | Derivazione di chiave non bloccante | `[x]` | `lib/database/crypto.ts`: `crypto.scrypt` asincrono, fuori dall'event loop. Test in `test/db/crypto.spec.ts` |

## Fase 3: isolamento del tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-3.1 | Contesto tenant senza stato di sessione | `[x]` | nessun `search_path` di sessione: `scripts/check-session-state.mjs` (in `check-all`) lo vieta nel sorgente, `lib/database/adapters/postgres/guard.ts` lo vieta sul driver (`set local` solo dentro transazione). Rilascio unico con `release()` in `lib/loader/tenant.ts`, lease in `lib/database/leases.ts`. Test in `test/db/session-state.spec.ts` e `test/lib/dataContext.spec.ts` |
| T-3.2 | Il tenant si lega al token | `[x]` | `lib/loader/tenant.ts` risolve il tenant dal `tid` del token firmato: token e tenant dichiarato diversi danno 403 `TENANT_MISMATCH`, nessun tenant 400 `TENANT_REQUIRED`, token del piano sbagliato 403 `SCOPE_MISMATCH`. Header o sottodominio, una sola fonte per volta e mai la query string (`lib/util/tenantResolution.ts`, D-11). Test in `test/lib/tenantResolution.spec.ts` |
| T-3.3 | Sparisce la connessione globale | `[x]` | `types/global.d.ts` non dichiara `global.connection`, `global.entity` né `global.repository`. `dataContext(req)` in `lib/util/tenancy.ts` ha tre casi e negli altri lancia `NoDataContextError` (`NO_DATA_CONTEXT`, D-06). `lib/loader/router.ts` rifiuta all'avvio `tenantContext` e indica lo `scope` da scrivere (invariante 9). Test in `test/lib/dataContext.spec.ts`, `router.spec.ts`, `genesis.spec.ts` |
| T-3.4 | I job dichiarano il contesto | `[x]` | `lib/loader/schedules.ts`: il job dichiara `scope` (`'control'` di default, `'tenant'`, `'every-tenant'`) e riceve l'handle. Il fan-out ha concorrenza limitata (default 1, `MAX_CONCURRENCY` 16), si ferma alla chiusura del server e non lascia che il fallimento di un tenant annulli gli altri. Test in `test/lib/schedules.spec.ts` |
| T-3.5 | Il tracciamento riceve il contesto | `[x]` | `lib/util/tracker.ts` scrive il `Change` nel contenitore di `dataContext(req)`. Strict di default: un errore di tracciamento dà 500 `TRACKING_FAILED`; `tracking: { strict: false }` sulla rotta lo declassa a log. Contratto in `docs/MANAGERS_V5.md` §7 (`TrackingManagement`), test in `test/lib/tracker.spec.ts` |
| T-3.6 | La cache non attraversa i contenitori | `[x]` | `lib/util/cache.ts`: chiave `keyGroup :: container :: subject\|roles :: method url`, invalidazione limitata al contenitore della richiesta, cache in memoria per processo con TTL di default 3600 s senza tenant e 60 s con i tenant. Chiude D-15 e D-26; `docs/CACHE.md` §3, §4, §6; test in `test/lib/cache.spec.ts` |

## Fase 4: identità e ruoli di sistema

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-4.1 | Utenti e ruoli di sistema nel piano di controllo | `[x]` | ruoli di sistema in `lib/config/systemRoles.ts` e catalogo chiuso `SYSTEM_CAPABILITIES` in `lib/loader/roles.ts`, separati dai ruoli dei tenant; `lib/loader/router.ts` rifiuta all'avvio un ruolo del piano sbagliato. `lib/database/managers/systemUser.ts` lavora solo su `ControlHandle`; rotte `/system/*` in `lib/api/system/routes.ts`. Test in `test/lib/systemScope.spec.ts` |
| T-4.2 | Impersonificazione tracciata | `[x]` | `lib/database/managers/impersonation.ts` nel piano di controllo: il record si scrive, poi si emette il token; `reason` obbligatorio (400 `REASON_REQUIRED`); TTL 30 minuti (`impersonation_ttl`) con tetto `HARD_MAX_TTL` di 4 ore in `lib/api/tenants/controller/tenants.ts`. Ogni richiesta verifica il record: a sessione chiusa `lib/hooks/onRequest.ts` risponde 403 `IMPERSONATION_ENDED`. Colonna `impersonation_id` in `change`; test in `test/lib/impersonation.spec.ts` |
| T-4.3 | «Fondatore» risolto nel contenitore | `[x]` | `isFounder(user)` in `lib/util/authz.ts` legge la colonna `is_founder` della riga, quindi ogni contenitore ha il proprio fondatore (D-27); le guardie stanno in `lib/api/users/controller/user.ts`. La genesi (`lib/loader/genesis.ts`, `founderExists`) conia un fondatore solo dove il contenitore non ne ha. Test in `test/lib/authz.spec.ts` e `test/lib/genesis.spec.ts` |

## Fase 5: migrazioni e flotta

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-5.1 | Motore, formato, collocazione della versione | `[x]` | SQL generato da `drizzle-kit` (`npm run db:generate`, `db:generate:tenant`; `drizzle.config.ts` legge `MIGRATION_SET`) e applicato da `lib/database/migrations/runner.ts`: una transazione per migrazione con `set local search_path`, record nella stessa transazione, hash confrontato. Versione nella tabella `migration` di ogni contenitore, forward-only; expand/contract in `llms.txt` §2.6. Test in `test/migrations/runner.spec.ts` |
| T-5.2 | Due insiemi di migrazioni | `[x]` | `lib/database/migrations/control/pg` e `lib/database/migrations/tenant/pg`; `npm run db:migrate` (`scripts/migrate-control.ts`) porta avanti il piano di controllo, `--dry` elenca senza toccare. `scripts/check-migration-sets.mjs` (in `check-all`) verifica la separazione; il runner tratta come «nessuna migrazione» solo `42P01`. Test in `test/migrations/sets.spec.ts` |
| T-5.3 | Migratore di flotta, comando e API | `[x]` | `npx volcanic migrate --tenants --snapshot <ref>` (`bin/volcanic.mjs`) e `migrateTenants` di `db.ts`, entrambi su `migrateFleet` (`lib/database/migrations/fleet.ts`): `--snapshot` obbligatorio, `--dry-run`, `--only`, `--target`, concorrenza default 2 e massimo 16, lock per contenitore con `pg_try_advisory_lock`. `scripts/copy-assets.mjs` copia le migrazioni in `dist`. Test in `test/migrations/fleet.spec.ts` |
| T-5.4 | Controllo di allineamento all'avvio | `[x]` | `lib/loader/schemaVersion.ts`: un piano di controllo indietro rifiuta l'avvio, un tenant indietro risponde 503 `SCHEMA_BEHIND` solo per sé (`lib/loader/tenant.ts`). Interruttori `checkOnResolve` e `refuseStartIfControlBehind` in `lib/loader/general.ts`, default rifiuto (invariante 2). Test in `test/lib/schemaVersion.spec.ts` |

## Fase 6: ciclo di vita del tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-6.1 | Creazione | `[x]` | `lib/api/tenants/controller/tenants.ts`: contenitore creato e migrato, admin seminato, riga di registro scritta per ultima; un fallimento rimuove il contenitore appena creato. `adminConfirmed` vale true di default (D-08). Il banco nero `test/e2e-mt-pg/isolation.e2e.spec.ts` passa 8 test su 8; il provisioning ha test anche in `test/lib/tenantProvisioning.spec.ts` |
| T-6.2 | Export del contenitore | `[x]` | `lib/database/containers/export.ts`: `pg_dump --schema` del solo contenitore, e senza il binario nessun export parziale. Rotte `POST /tenants/:id/exports` e `GET /tenants/:id/exports/:package` in `lib/api/tenants/routes.ts`; la directory viene da `export_directory` (`EXPORT_DIRECTORY`) in `lib/config/general.ts`, non dalla richiesta. Test in `test/migrations/export.spec.ts` |
| T-6.3 | Distruzione a due fasi | `[x]` | `POST /tenants/:id/destruction-request` conta righe e byte e restituisce un token monouso, di cui `lib/database/managers/destruction.ts` tiene solo lo SHA-256; `DELETE /tenants/:id/data` vuole token, slug e secondo fattore nel corpo, esporta il contenitore e solo dopo lo rimuove (`docs/API_V5.md` §6.2, D-09). MFA di sistema su `/system/auth/mfa/*`; i backup in `llms.txt:1529`. Test in `test/lib/destruction.spec.ts` e `test/db/destruction.spec.ts` |

## Fase 7: contenitore per tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-7.1 | Contenitore su Postgres e cache LRU | `[x]` | `PostgresProvider` (`lib/database/adapters/postgres/index.ts`) con strategie `schema` e `container`; sotto `container` ogni tenant ha database e pool propri, in LRU con limite (`maxOpenContainers`, default 20) e `closeIdleContainers()` per l'inattività. L'avvio è rifiutato se i pool superano `max_connections` meno la riserva. Chiude D-10; PgBouncer in `docs/TUNING.md`. Test in `test/db/containers.spec.ts`, `test/db/containerLimits.spec.ts` |
| T-7.2 | Contenitore su file, SQLite e libSQL | `[-]` | il framework è solo Postgres (T-14.3); la chiusura per inattività è `closeIdleContainers()` dell'adattatore Postgres (T-7.1) |
| T-7.3 | Replica continua dietro una porta | `[-]` | il framework è solo Postgres (T-14.3): non ha contenitori su file da replicare |

## Fase 8: igiene del core e chiusura

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-8.1 | Sicurezza del core (CORS, enumerazione, dipendenze) | `[x]` | D-16: `lib/util/cors.ts`, allowlist da `CORS_ORIGINS`; `assertCorsOptions` in `index.ts:362` controlla le opzioni effettive e in produzione rifiuta l'avvio sulle combinazioni insicure (`test/lib/cors.spec.ts`). D-17: un solo rifiuto di login, 401 `AUTH_INVALID_CREDENTIALS` (`lib/auth/engine.ts`, `test/lib/authMessages.spec.ts`). D-22: le dipendenze di produzione si controllano con `npm audit --omit=dev` |
| T-8.2 | Raccolta dei difetti minori | `[x]` | D-23: `lib/hooks/onError.ts` legge `HIDE_ERROR_DETAILS` come `index.ts` (`test/lib/onError.spec.ts`). D-24: lo scheduler passa `schedule.cron.timezone` (`lib/loader/schedules.ts:334`, `test/lib/schedules.spec.ts`). D-29: `req.data()` fonde query e corpo con il corpo che vince, più `req.queryData()` e `req.bodyData()` (`lib/util/common.ts`, `test/lib/common.spec.ts`) |
| T-8.3 | Guida di migrazione v4 → v5 | `[x]` | `docs/MIGRATION_V4_V5.md`, 36 sezioni numerate. I codici che promette esistono nel sorgente: `NO_DATA_CONTEXT`, `TENANT_MISMATCH`, `TENANT_REQUIRED`, `SCOPE_MISMATCH`, `SCHEMA_BEHIND`, `TRACKING_FAILED`, `PASSWORD_TO_BE_CHANGED`, `AUTH_INVALID_CREDENTIALS`. Corrispondenza della Magic Query in `docs/MAGIC_QUERY_V5.md` §9 |
| T-8.4 | Allineamento di `volcanic-backend-sample` e `volcanic-admin` | `[x]` | `volcanic-backend-sample` dipende da `file:../volcanic-backend` e tiene le proprie migrazioni in `migrations/control` e `migrations/tenant`; `volcanic-admin` usa la Magic Query v5 (`_logic`, vedi il suo `README.md`). Ciò che il porting chiede al framework sta in `docs/MIGRATION_V4_V5.md` §21-23: ordine di avvio, `access(handle)` in `lib/database/access.ts`, `QueryOptions.extraWhere`, i tipi di handle esportati da `index.ts` |

## Fase 9: ciò che il piano prometteva senza dirlo

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-9.1 | Migrazioni per dialetto (SQLite e libSQL) | `[-]` | il framework è solo Postgres (T-14.3): un solo dialetto, in `lib/database/migrations/control/pg` e `lib/database/migrations/tenant/pg` |
| T-9.2 | libSQL aperto davvero in un test | `[-]` | il framework è solo Postgres (T-14.3) |
| T-9.3 | Il README è la v5 | `[x]` | `README.md` descrive la v5: un server minimo con `preload()` e `DATABASE_URL` o PGlite, la sezione «Breaking changes in 5.0» e i rimandi della sezione «Documentation» |
| T-9.4 | Banco di taratura | `[x]` | `scripts/tune.ts` (`npm run tune`) misura bcrypt, scrypt, `max_connections` e il costo di una pagina, scrive `tuning.json` con la provenienza di ogni cifra e con `--write-config` aggiorna `.env` dopo un backup. Metodo e risultati in `docs/TUNING.md`. `BCRYPT_COST` ha un pavimento a 12 via `envInt` (`lib/util/env.ts`, `lib/database/env.ts`); test in `test/lib/env.spec.ts` |
| T-9.5 | Inventario dei rifiuti e soglia di copertura | `[x]` | `scripts/check-refusals.mjs` (in `check-all`) confronta ogni codice d'errore del sorgente con quelli che i test nominano, fra cui `test/lib/authRefusals.spec.ts`, `systemUserRefusals.spec.ts`, `userAdminApex.spec.ts`, `tokenApex.spec.ts`. `npm run coverage` misura con `c8` (`.c8rc.json`) e applica i pavimenti con `scripts/check-coverage.mjs`; metodo ed esclusioni in `COVERAGE.md` |
| T-9.6 | `llms.txt` è la v5 | `[x]` | `llms.txt` descrive la v5 per gli agenti: modello mentale in Part 0, tabelle del consumer in Part 2 (migrazioni in §2.6), Magic Query v5 in Part 3, `BaseService` legato al contenitore in Part 5, manager con il contenitore come primo argomento in Part 10, rotte native in Part 11 |

---

## Fuori piano, da non perdere

| | Stato | Nota |
|---|---|---|
| Sorte di `develop` e `main` | `[-]` | **Il push di `develop` e `main` non si fa**: su GitHub restano come sono, e su origin va solo `v5`. In locale `develop` e `main` sono in fast-forward su `v5` in backend, sample, tools e admin (dove `develop` esiste anche solo in locale), senza push; `volcanic-rag` ne è fuori. In ogni repository `develop` e `main` sono **antenati stretti** di `v5` (verificato il 18 settembre 2026 con `git rev-list --left-right --count` sui remoti), quindi nessun commit andrebbe perso e ogni allineamento è un fast-forward. `volcanic-tools`, `volcanic-admin` e `volcanic-rag` non hanno `develop`. Da decidere se `v5` confluisce in `develop` o lo sostituisce, e quando `main` passa alla 5 (sezione 7 di `EVO_FRAMEWORK.md`: a fase 7 chiusa e T-8.3 scritta, condizioni vere); serve una richiesta esplicita |
| Pubblicazione su npm | `[~]` | Resta la pubblicazione, su richiesta esplicita: `5.0.0` su `latest`, senza alpha e senza `next`. Tutto il ramo `v5` è alla 5: backend, sample, tools, admin, rag e rag-sample a `5.0.0`, il peer di rag sul backend e su tools a `^5.0.0`; il job `release` sceglie `latest` per una versione senza suffisso. Il registro ha `latest` 4.0.3 (verificato il 15 settembre 2026). Mappa dei pacchetti: `@volcanicminds/backend`, `@volcanicminds/tools` e `@volcanicminds/admin` restano a sé, il RAG è un pacchetto unico con subpath (`volcanic-rag/TASKS.md`, D7), `@volcanicminds/typeorm` è deprecato sul registro. La catena è provata il 25 settembre 2026 su un registro Verdaccio locale, nulla su npmjs: il backend passa per `prepublishOnly` (909 prove con `DATABASE_URL`, banco multi-tenant 22) e senza `--tag` npm 11 rifiuta un prerelease; tools ha un `prepublishOnly` che compila prima di pubblicare (`volcanic-tools@5979a43`); il sample installato dal registro passa check-all, 13 prove su 13, build e avvio da `dist` con `/health` e `/auth/flow/options` a 200 (`volcanic-backend-sample@1c0c862`). Il sample prende backend e tools da `file:../volcanic-*` (`volcanic-backend-sample@051721a`): dopo la pubblicazione torna agli intervalli del registro e `npm install` riscrive il lock |
| Cartelli sui documenti v4 | `[x]` | `DATA_LAYER_MAGIC.md` e `CONFIGURATION.md` marcati come sostituiti, `AUTH_COMPOSABLE_EVOLUTION.md` come rinviato fuori dalla v5; `ADVANCED_ARCHITECTURE.md` e `TYPESCRIPT_GUIDE.md` sono riscritti sulla v5 (riga sotto) |
| Riscrittura di `ADVANCED_ARCHITECTURE.md` e `TYPESCRIPT_GUIDE.md` sulla v5 | `[x]` | riscritti entrambi, senza cartello. **Architettura**: il service layer legato a un **contenitore** e non a un `EntityManager`, `service.on(dataContext(req))`, `applyPermissions` che **restituisce** una condizione `SQL` portata da `extraWhere` e messa in AND per ultima (filtrare dopo la query taglia la pagina prima e filtra dopo: pagine corte e totale sbagliato), il default deny scritto e non assunto, niente hook `addRelations` perché un join non è una proprietà del servizio, controller sottile, transazioni prese dall'handle, e la tabella «v4 → v5» che spiega perché non è un rinomino: in v4 la strada vietata andava recintata perché era raggiungibile, in v5 non esiste un contenitore ambientale da raggiungere. **TypeScript**: i tre handle (`ControlHandle`, `TenantHandle`, `DataHandle`) e perché tiparli `any` non è una scorciatoia, `dataContext(req)` invece di `req.tenant ?? req.control`, `access(handle)` come unica porta d'ingresso, i globali che il framework dichiara già (quindi nessuna ridichiarazione, e niente `entity`/`connection`/`repository`), i due subpath, il `tsconfig` senza le opzioni dei decoratori TypeORM, e l'elenco delle grafie che non compilano più |
| `docs/AUTHORIZATION_MODEL.md` | `[-]` | resta valido: `AUTHORIZATION_V5.md` lo estende, non lo sostituisce |
| Dipendenze Drizzle | `[x]` | `drizzle-orm` e `drizzle-kit` generano e applicano, `pg` e `bcrypt` girano contro Postgres reale; `better-sqlite3` e `@libsql/client` sono usciti con SQLite e libSQL (T-14.3) |
| `npm audit fix` sulla baseline | `[x]` | assorbito in T-8.1; lo stato delle vulnerabilità è nella riga «Vulnerabilità delle dipendenze su `v5`» |
| Finestra senza rete di test | `[x]` | chiusa con **470 test** (306 core, 130 data layer, 34 migrazioni) più gli **8 del banco nero** su Postgres reale, al 10 settembre 2026. Le suite end-to-end della v4 non si recuperano: il banco di T-0.2 copre le proprietà che contano, e gli spec v4 restano in `main` (`git show main:test/e2e/auth-lifecycle.e2e.spec.ts`) per chi volesse rileggerli |
| Insieme di migrazioni per SQLite e libSQL | `[-]` | non applicabile: SQLite e libSQL sono fuori dal framework (T-14.3) |
| Misure di tempo su macchina dedicata | `[-]` | è T-9.4: il banco (`npm run tune`) rifà le misure dove serve, con la provenienza accanto a ogni numero. Le misure prese su un portatile condiviso non vanno usate per dimensionare, e quella su macchina dedicata resta da fare (`EVO_PUNTI_APERTI.md`) |
| `ERR_HTTP_HEADERS_SENT` a ogni richiesta del sample | `[x]` | `lib/loader/router.ts` avvolge ogni handler in una funzione `async`, quindi un controller sincrono che risponde con `reply.send()` (`health.check`, gli esempi del README) diventerebbe una promise risolta a `undefined`, che Fastify legge come «manda adesso», e il secondo invio supererebbe il primo mentre gli hook `preSerialization` asincroni sono ancora in corso. Per questo `controllerHandler` restituisce la `reply` quando il controller sincrono restituisce `undefined`, che è il contratto nativo di Fastify. Prova che fallisce senza il rimedio: `test/lib/routeHandler.spec.ts` (5 prove, legge il log). Sample sul build con l'hook `src/hooks/preSerialization.ts`: `/health`, `/auth/flow/options` e `/hello` a 200, zero `ERR_HTTP_HEADERS_SENT`; `npm test` 913 con `DATABASE_URL` (3 saltate), banco multi-tenant 22 |
| `volcanic-rag-sample` entra dal flusso | `[x]` | `test/helpers.ts` entra da `POST /auth/flow/start` con `method: 'password'`; 62 prove su 62 contro Postgres 16 |
| Vulnerabilità di produzione in `volcanic-tools` e `volcanic-admin` | `[x]` | Chiuse per quanto si può chiudere. Tools: la critica e le 10 alte sono andate con `volcanic-tools@0dbdf38` (nodemailer 10: dalla 9 un allegato scaricato da un URL con certificato autofirmato viene rifiutato); `npm audit --omit=dev` ne riporta 4 moderate, tutte nella catena di `minio` (`decode-uri-component`, `stream-json`), dove l'unico rimedio proposto è scendere a `minio` 7.1.3 da `^8.0.6`, un downgrade di major che non si applica. Admin: 0, con `volcanic-admin@3074fa1` (le 2 alte, `fast-uri` e `linkify-it`) e con Tiptap 3 (riga sotto) per le 26 moderate. `volcanic-rag` 0. Il commit di tools e i due precedenti (`f8bb5f7`, `5979a43`) sono su `origin/v5`. Dettaglio in `docs/AUDIT_TASKS_TODO.md`, Q12 |
| Editor rich text dell'admin su Tiptap 3 | `[x]` | `volcanic-admin@255e9c3`, unico file `src/ui/widgets/richtext/RichTextEditor.tsx`. StarterKit 3 contiene Link e Underline (due pacchetti in meno); `setContent(v, { emitUpdate: false })`; la toolbar legge lo stato dei pulsanti con `useEditorState`, perché in v3 l'editor non ridisegna più il componente a ogni transazione; `trailingNode: false`, perché StarterKit 3 aggiunge un paragrafo vuoto dopo un titolo, una lista o una citazione finali e l'HTML salvato cambierebbe rispetto alla v2. Prova nel browser sul mock: caricamento di un record, grassetto, titolo, link, undo e redo con lo stato dei pulsanti giusto, salvataggio e riapertura con il testo intatto, salvataggio senza modifiche che non cancella niente, console senza errori. Difetto piantato (toolbar senza sottoscrizione allo stato): il grassetto resta spento e la prova lo vede. `tsc`, `build` verdi, `npm audit` 0. Undo subito dopo il caricamento: quando il record arriva dopo il montaggio dell'editor, il caricamento resta fuori dalla cronologia perché passa con `setMeta('addToHistory', false)` (`volcanic-admin@7eed80b`). Il mock risponde prima che l'editor nasca e non esercita il caso: la prova ha usato un ritardo temporaneo di 600 ms sul `getOne` del mock, poi tolto. Senza il rimedio Undo è attivo e Ctrl+Z lascia `<p></p>`; con il rimedio Undo è spento, Ctrl+Z non cambia niente, modifica, Undo e Redo funzionano. `tsc`, `eslint`, `build` verdi |
| Form dell'admin con modifiche non salvate appena aperto | `[x]` | `volcanic-admin@7909165`. Un record aperto in modifica e non toccato, e un form di creazione vuoto, non chiedono "Scartare le modifiche non salvate?" (brand e veicoli, con o senza rich text). Refine copia il record nel form con `setValue`, che lascia vuoti i default, quindi il record caricato diventa la base (`reset(getValues())` dopo l'effetto di refine) e default e widget usano lo stesso seme (`fieldSeed` in `src/ui/widgets/inputs.tsx`). Prova nel browser sul mock, anche con il record in ritardo di 600 ms (ritardo temporaneo poi tolto): nessuna guardia su modifica e creazione intatte, guardia su testo e rich text modificati, salvataggio e riapertura corretti, console pulita. Difetto piantato (reset tolto): la guardia torna su entrambi i form. `tsc`, `eslint`, `build` verdi |
| CI di tools, admin e rag, SAST (Q11, T-9.3 di rag) | `[x]` | Verde su GitHub. Tools `700576a`: lint, type-check, audit di produzione, test, build, publint. Admin `acb6303`: lint, audit, build della libreria e della demo, publint. Rag `83f4a4f`, `7970d32`: `check`, audit, test con Qdrant 1.19.1 di servizio, con il backend `v5` scaricato e compilato accanto (`file:../volcanic-backend`). CodeQL `security-extended` su backend, tools e admin (push, pull request, settimanale): 0 avvisi aperti. La CI del backend esegue `check:refusals` (`7d6fc0b`). La prova di rag su Qdrant reale gira su un server (`volcanic-rag@65c6df5`), con difetto piantato visto. **Resta fuori**: SAST su rag (repo privato, CodeQL vuole GitHub Advanced Security), CI del sample, prove del sample nella CI di rag (serve un token per il repo privato, in T-10.8 di rag). `validate:manifest` dell'admin è in CI (`volcanic-admin@1951e7a`) e l'esempio `manifest.v2.example.json` porta gli endpoint del flusso che emette il generatore. Dettaglio in `docs/AUDIT_TASKS_TODO.md`, Q11 |
| Codice via email per la distruzione senza MFA (`docs/API_V5.md` §6.2) | `[x]` | Il fattore si fissa alla fase 1: TOTP se l'operatore ha l'MFA, altrimenti un codice di 6 cifre consegnato da `challengeDeliveryManager` con `purpose: 'destruction'`, conservato come HMAC legato al token, 5 tentativi riservati in modo atomico. Senza consegna, senza email o con la consegna fallita: 503 `DESTRUCTION_FACTOR_NOT_AVAILABLE` e nessun token. Migrazioni `0005_destruction_code_control` (pg e sqlite). Prove: `check-all` verde, `npm test` 953 più 3 saltati, banco multi-tenant Postgres 25; due difetti piantati (tetto dei tentativi, codice qualsiasi) presi da 4 test. Sample: oggetto e testo della mail per scopo. Admin: etichetta «The code we sent to o***@e***.test», provata con Playwright sul piano di controllo: 403, 403, poi 200 con l'export scritto. Il rifiuto porta `remaining` (come il flusso di login) e l'admin mostra «The code is not valid. 4 attempts left.», provato con Playwright. |
| Tenant `destroyed`, stato finale | `[x]` | La distruzione marca la riga `destroyed` (`markTenantDestroyed`), non un soft delete, perché un ripristino non riporti in `active` un tenant senza contenitore. Le scritture del manager (`updateTenant`, `suspendTenant`, `restoreTenant`, `softDeleteTenant`) escludono le righe distrutte nel `where`; le rotte rispondono 409 `TENANT_DESTROYED`, e una seconda `DELETE /tenants/:id/data` risponde 200 con `alreadyDestroyed: true`, come dice la doc. Prove: `check-all` verde (97 rifiuti), `npm test` 957 più 3 saltati, banco multi-tenant Postgres 25; tre difetti piantati presi; a runtime seconda distruzione 200 `alreadyDestroyed`, restore, suspend, update e fase 1 tutti 409. `docs/API_V5.md` §6.2 dice che un token scaduto, speso, sconosciuto o di un altro operatore risponde `DESTRUCTION_TOKEN_INVALID` (il rimedio è lo stesso, una nuova fase 1). |
| Step-up sugli upload dell'admin | `[x]` | `src/ui/widgets/upload/rest.ts` passa da `dataProvider.custom()` (corpo `FormData` senza `Content-Type` JSON). Provato a runtime: dopo `STEP_UP_MAX_AGE` la richiesta chiede la conferma d'identità (una volta) e il rifiuto resta. Il mock risponde `{}` agli endpoint immagine. |
| Etichette «Plural» senza dizionario | `[x]` | Senza dizionario, il fallback dell'admin per `singular`/`plural` usa `<name>`: «System Access Log» a runtime sul piano di controllo. |
| Solo Postgres: SQLite e libSQL fuori dal framework | `[x]` | T-14.3 (`volcanic-backend-sample@ead18cd`, `volcanic-admin@6407c80`, `volcanic-rag@8dffaba`). Fuori dal framework l'adattatore `lib/database/adapters/sqlite`, `lib/database/schema/sqlite.ts`, gli insiemi `control/sqlite` e `tenant/sqlite` in `lib/database/migrations`, i peer `better-sqlite3` e `@libsql/client`. SQLite e libSQL compaiono in 0 file di `lib/`, 2 di `test/` (le guardie che rifiutano i motori a file per nome) e 1 tra `docs/`, `README.md` e `llms.txt` (`docs/PGLITE.md`, v4 col cartello). `check-all` verde; `npm test` 830 verdi e 30 saltate senza `DATABASE_URL`, 933 e 1 su Postgres; banco multi-tenant 25; quattro difetti piantati presi. Dettaglio in `EVO_FASE_14.md`, T-14.3. |
| `executeFind` restituisce le colonne sensibili | `[x]` | La select di `executeFind` (`lib/database/query/index.ts`, `projectionOf`) prende le colonne nominate da `_fields`, oppure tutte, e in entrambi i casi lascia fuori `sensitiveFields`; il conteggio non cambia. Due prove in `test/db/query.spec.ts` (nessun campo sensibile in uscita, anche con una lista propria della rotta; `_fields` applicato a ogni record, anche quando filtro e ordinamento usano altri campi), e due difetti piantati (select di tutte le colonne, `_fields` ignorato) le fanno fallire. Documentati in `docs/MAGIC_QUERY_V5.md` e `llms.txt` §3.7. In HTTP le rotte del framework tolgono quei campi anche con lo schema di risposta (`userSchema` in `lib/api/users/routes.ts`) o con `present()` (`lib/api/system/controller/systemUser.ts`). |
| Vulnerabilità delle dipendenze su `v5` | `[x]` | `npm audit` 0, anche di sviluppo. `expect` 30.5.2 sostituisce `micromatch` e `braces` (nessuna versione corretta di `braces` esiste) con `picomatch`; `mocha` 12.0.3 e `serialize-javascript` 7.1.2. Le due per cui npm propone solo un downgrade si chiudono con `overrides` in `package.json`: `esbuild` ^0.25.12 sotto `@esbuild-kit/core-utils` (`drizzle-kit`), `uuid` ^11.1.1 sotto `hyperid` (`autocannon`), che su Node 26 usa `crypto.randomUUID` e tiene `uuid` come ripiego. `db:generate` e `db:generate:tenant` rispondono «No schema changes»; check-all, build, 1088 prove con `DATABASE_URL`, banco multi-tenant 61. Gli avvisi Dependabot su GitHub sono del branch di default `main`, che non si tocca |
| Aggiornamenti delle dipendenze prima della 5.0.0 | `[x]` | `npm update` dentro gli intervalli dichiarati (tra gli altri `fastify` 5.12.7, `@fastify/jwt` 10.2.4, `drizzle-orm` 0.45.4, `pg` 8.23.1) e `@types/node` 26. `@fastify/jwt` 10.2 scarta un `expiresIn: undefined` e rimette la durata di sessione sopra l'`exp` della riga: il bearer di un token macchina si firma con `jwt.sign` e opzioni proprie, e `test/lib/tokenApex.spec.ts` lo prova con un firmatario vero. Poi le major di runtime, una per commit e dopo il changelog: `@fastify/compress` 9, `@fastify/multipart` 10, `@fastify/rate-limit` 11, `@fastify/schedule` 7, `fastify-raw-body` 6, `dotenv` 18 (la riga «injected» va su stderr), `nanoid` 6, `toad-scheduler` 4. L'ultima porta croner 10: `0/10` è rifiutato e `?` vale `*`, scritto in `docs/MIGRATION_V4_V5.md` §20 e provato in `test/lib/schedules.spec.ts`. Nessuna suite esercitava compress, multipart, raw body e rate limit: provati a runtime con un banco fuori dal repo e sul server vero (health 200, 429 alla terza chiamata di una rotta di auth). Fuori: le major di sviluppo (TypeScript 7, ESLint 10, `globals` 17, PGlite). Un'espressione cron o un fuso che croner rifiuta si leggono al caricamento (`croner` diretto, stessa major di `toad-scheduler`): il job non si carica, il log lo nomina e il server parte, come dice `llms.txt`. Lo stesso per un job attivo con `scheduler` spento: non si carica e il log dice di accendere `scheduler: true` |
| Versionamento delle API | `[ ]` | idea che nessun piano ha ancora preso |
| Canale degli avvisi per gli amministratori | `[~]` | preso dalla fase 21 (`EVO_FASE_21.md`): il canale del backend è fatto (T-21.1); restano la prima fonte, il RAG (T-7.18 di `volcanic-rag/TASKS.md`), e la pagina della console (T-21.2) |
