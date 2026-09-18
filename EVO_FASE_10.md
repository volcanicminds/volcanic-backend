# EVO fase 10: igiene e allineamento dei consumer

> **Questo file è una lista di interventi, non un piano di architettura.** Nasce dal rilievo
> del 10 settembre 2026 su `volcanic-backend`, `volcanic-backend-sample` e `volcanic-admin`,
> fatto dopo la chiusura delle fasi da 0 a 9. Nessuna voce qui è lavoro nuovo di prodotto:
> sono difetti accertati, promesse non mantenute e residui.
>
> **Regola unica**, la stessa delle fasi precedenti: una casella si chiude solo con
> un'**evidenza citata**, cioè un `file:riga`, un identificativo di commit o l'output di un
> comando. Senza evidenza resta aperta.
>
> Perimetro: tre repository, branch `develop` per il framework, lavoro non committato per il
> sample. Le righe citate sono quelle del rilievo e vanno riverificate prima di toccare il
> file, perché un'altra modifica può averle spostate.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## Ordine di esecuzione

L'ordine non è per gravità ma per **dipendenza**: A sblocca D, B è indipendente, C è il blocco
più grosso e va affrontato quando A e B sono chiusi, perché due delle sue voci si appoggiano a
decisioni prese lì. Le stime sono stime, ricavate dalla dimensione della modifica letta nel
rilievo e non da un lavoro cronometrato.

| Blocco | Cosa sblocca | Stima |
|---|---|---|
| ~~A. Il contesto dati~~ | **chiuso l'11 settembre 2026**, T-10.1, T-10.2, T-10.3 | fatto |
| ~~B. Configurazione che mente~~ | **chiuso l'11 settembre 2026**, T-10.4 → T-10.10 | fatto |
| ~~C. Allineamento di `volcanic-admin` alla v5~~ | **chiuso il 15 settembre 2026**, T-10.11 → T-10.18; la sessione in cookie httpOnly di default era chiusa l'11 settembre 2026 (T-10.37 → T-10.39) | fatto |
| D. Sample committabile | **chiuso l'11 settembre 2026** tranne il commit (T-10.28, su richiesta) | fatto |
| ~~E. Igiene del framework~~ | **chiuso l'11 settembre 2026** | fatto |
| F. Coda del blocco C | difetti e disegni emersi chiudendo C | 3 correzioni fatte, 3 voci aperte |

---

## A. Il contesto dati

La voce più costosa del rilievo, perché non è un difetto in un file: è una documentazione che
insegna il fallback che l'invariante 3 esiste per vietare, e un sample che l'ha seguita alla
lettera. Si chiude a monte, non nel sample.

- [x] **T-10.1** Esportare `dataContext` (e `NoDataContextError`) dall'API pubblica.
  **Dove**: `lib/util/tenancy.ts:49-67`, oggi raggiungibile solo dall'interno; il blocco di
  esportazione di `index.ts:448-486` non la nomina, e nemmeno `db.ts`.
  **Perché**: un consumer che deve scegliere il contenitore di una richiesta non ha modo di usare
  la funzione corretta, quindi la riscrive, e la riscrive con il fallback.
  **Chiuso quando**: `import { dataContext } from '@volcanicminds/backend'` compila in un
  progetto consumatore e il tipo di ritorno è `DataHandle`.
  **Evidenza**: `index.ts:487-493` esporta entrambi; `lib/util/tenancy.ts:56` prende ora un
  `FastifyRequest` invece di `any`, con il cast del solo campo che Fastify non tipizza;
  `test/lib/dataContext.spec.ts:234-245` verifica il rifiuto attraverso l'entry pubblica.
  `npm run check-all` verde, `npm test` 444 passanti e 30 saltati, banco nero
  `test:e2e:mt:pg` 8 su 8 contro `postgres:16-alpine`.

- [x] **T-10.2** Correggere la documentazione dei manager, che descrive un comportamento che il
  codice non ha.
  **Dove**: `docs/MANAGERS_V5.md:37` («`dataContext(req)` returns `req.tenant ?? req.control`»)
  e `:323` («oppure `req.tenant ?? req.control` scritto per esteso»).
  **Cosa**: `dataContext` **rifiuta** quando la tenancy è attiva e nessun tenant è stato risolto.
  Il `??` non è una semplificazione della stessa regola, è la regola opposta.
  **Chiuso quando**: nessuna riga di `docs/**` suggerisce `req.tenant ?? req.control` come modo
  di ottenere il contenitore, e la tabella di migrazione rimanda a `dataContext`.
  **Evidenza**: `docs/MANAGERS_V5.md:36-52` ora spiega i tre casi in tabella e dice
  esplicitamente che `req.tenant ?? req.control` non è equivalente; `:338` corretta.
  **Il perimetro era più largo del previsto**: la stessa formula era in `llms.txt` in 14 punti,
  compreso `llms.txt:1305-1312`, che è il file `src/utils/context.ts` del sample parola per
  parola, e in `README.md:801` e `:1021`. Tutte convertite a `dataContext(req)`; restano tre
  occorrenze, e sono i tre avvisi che dicono di non scriverla (`llms.txt:96`, `:1310`, `:1823`).
  Corretto anche il messaggio di rifiuto del framework, `lib/database/managers/runtime.ts:27`,
  che suggeriva la formula sbagliata a chiunque la leggesse in produzione.

- [x] **T-10.3** Sostituire l'helper del sample con quello del framework.
  **Dove**: `volcanic-backend-sample/src/utils/context.ts:13-19`, dove `container(req)` fa
  `req.tenant ?? req.control` sotto un commento che dichiara «There is no third answer and no
  fallback».
  **Chiuso quando**: `container` è cancellata o è un alias di `dataContext`, e un test mostra
  che una rotta tenant senza tenant risolto solleva invece di leggere il control plane.
  **Evidenza**: `volcanic-backend-sample/src/utils/context.ts:16` è ora
  `export { dataContext as container } from '@volcanicminds/backend'`, quindi non è una copia
  che può divergere ma la funzione stessa; i 24 punti che chiamano `container(req)` non sono
  stati toccati. `npm run type-check` verde, `npm test` 4 passanti con Postgres reale.
  **Nota**: il comportamento oggi non cambia, perché il sample non dichiara `tenants` e in
  quel caso entrambe le versioni restituiscono `req.control`. Cambia il giorno in cui qualcuno
  decommenta il blocco a `src/config/general.ts:36-41`, che è esattamente quando serviva.

---

## B. Configurazione che mente

Sette voci in cui un valore dichiarato, loggato o pubblicato non corrisponde a quello che il
codice usa. Nessuna rompe una richiesta: tutte fanno credere a chi legge una cosa falsa, che è
la forma di difetto che le fasi precedenti hanno inseguito con il nome D-11.

- [x] **T-10.4** Il banner di avvio deve leggere la configurazione effettiva.
  **Dove**: `index.ts:428-431` legge `general.options.mfa_policy`, cioè i default del framework
  importati a `index.ts:45` da `lib/config/general.ts:12`; l'enforcement legge
  `global.config.options.mfa_policy` (`lib/api/auth/controller/auth.ts:318`, `:542`, `:589`,
  `:653`, `lib/api/users/controller/user.ts:144`).
  **Effetto oggi**: un consumer che imposta `mfa_policy: 'MANDATORY'` nel proprio
  `config/general.ts` vede il log dire `OPTIONAL`.
  **Chiuso quando**: l'import di `index.ts:45` è rimosso e il banner legge `global.config`.
  **Evidenza**: `index.ts:438` legge `global.config.options.mfa_policy` con lo stesso default di
  `lib/api/auth/controller/auth.ts:318`; l'import di `lib/config/general.js` è sostituito da
  quello di `MfaPolicy` (`index.ts:49`), con un commento sul perché. Due scoperte facendolo:
  quell'import statico veniva sollevato sopra `dotenv.config()`, quindi le letture di
  `process.env` del file dei default giravano **prima** che `.env` fosse caricato (innocuo solo
  per chi avvia con `--env-file`); e la riga sopra il banner divideva i millisecondi per 100
  stampando secondi, per cui un avvio di 1,5 s diceva «15s». Corretta anche quella, `:431`.

- [x] **T-10.5** La tenancy del manifest deve usare la stessa domanda del resto del framework.
  **Dove**: `lib/manifest/generator.ts:341-343` deriva `mode: 'multi'` dalla sola presenza del
  blocco `tenants`; tutto il resto passa da `isTenancyEnabled()`
  (`lib/util/tenancy.ts:18-20`), che richiede `strategy`. `resolveTenancy`
  (`lib/database/capabilities.ts:48`) ricade su `'none'`, quindi un blocco senza `strategy`
  fa partire il server.
  **Effetto oggi**: `tenants: { resolver: 'header' }` senza `strategy` produce un manifest che
  dice `multi`, un admin che accende lo switcher e inietta `x-tenant-id`, e un backend che si
  comporta da single tenant.
  **Chiuso quando**: `generateManifest` chiama `isTenancyEnabled()`, e un test copre il caso
  «blocco dichiarato, strategia assente».
  **Evidenza**: `lib/manifest/generator.ts:360` `tenancyOf()` chiama `isTenancyEnabled()`;
  quattro test in `test/lib/manifest.spec.ts:222`, compreso «blocco dichiarato, strategia
  assente». Allargato di un caso trovato sulle stesse righe: con `resolver: 'subdomain'` il
  manifest pubblicava comunque `header` e `switchable: true`, ma `declaredTenant`
  (`lib/util/tenantResolution.ts:25-27`) sotto quel resolver non legge l'header. Ora in quel caso
  il manifest dice `multi` senza switcher e senza header.

- [x] **T-10.6** Una sola fonte per il reset MFA forzato dell'admin.
  **Dove**: le chiavi `mfa_admin_forced_reset_email` e `mfa_admin_forced_reset_until` sono
  dichiarate in `lib/config/general.ts:16-17` e ridichiarate in `lib/loader/general.ts:46-47`,
  e non le legge nessuno; la funzione legge `process.env.MFA_ADMIN_FORCED_RESET_EMAIL` e
  `_UNTIL` a `index.ts:353-354`.
  **Decisione da prendere**: o le chiavi leggono le env come fa `mfa_policy` e `index.ts` legge
  la configurazione, oppure le chiavi si cancellano e restano solo le env.
  **Chiuso quando**: `grep -rn mfa_admin_forced_reset lib index.ts` mostra una sola catena.
  **Decisione presa**: solo ambiente. È un'azione di emergenza con una finestra di dieci minuti,
  e un valore con scadenza non va in un file committato; la documentazione (`README.md`,
  `docs/SECURITY_MFA.md`, `llms.txt`) descriveva già solo le variabili.
  **Evidenza**: chiavi tolte da `lib/config/general.ts:16-19` (resta un commento che rimanda
  alle variabili), dal loader e dal tipo (`types/global.d.ts:314-316`). Test
  `test/lib/merge.spec.ts:88` che verifica l'assenza delle due chiavi.

- [x] **T-10.7** Il manifest non è filtrato per chiamante: allineare la documentazione o il codice.
  **Dove**: `docs/API_V5.md:195` dichiara «describes only what the caller's roles can reach»;
  `lib/api/admin/controller/manifest.ts:7-9` restituisce il manifest completo, e il commento
  della rotta lo dice esplicitamente (`lib/api/admin/routes.ts:24`).
  **Cosa c'è in gioco**: così com'è, un utente autenticato con la sola capability `manifest`
  ottiene l'elenco di ogni rotta e di ogni codice di ruolo del deployment. Il client filtra,
  il server no.
  **Chiuso quando**: o `docs/API_V5.md:195` descrive il comportamento reale, o il controller
  filtra le capability contro i ruoli del chiamante e un test lo prova.
  **Evidenza**: `docs/API_V5.md:195-203` descrive il comportamento reale e dice cosa comporta
  concedere la capability `manifest`. Il filtro lato server **non** è stato fatto: resta una
  decisione, perché renderebbe dipendente da chi lo scarica il manifest pinnato che
  `volcanic-admin` indica come modalità di default.

- [x] **T-10.8** Un solo posto dichiara i default della configurazione generale.
  **Dove**: `lib/loader/general.ts:41-57` dichiara default inline, poi carica per glob
  `lib/config/general.ts` (che `lib/util/path.ts:7-12` risolve come primo pattern) e infine il
  `src/config/general.ts` del consumer.
  **Effetto oggi**: le due liste già divergono. Al loader mancano `mfa_policy`,
  `reset_password_token_ttl`, `impersonation_ttl`, `export_directory`,
  `allow_admin_create_confirmed_users`, `control.url`, `control.schema`, `control.pool`.
  **Chiuso quando**: i default vivono in un solo file e l'altro lo importa, oppure è scritto
  in un commento perché la duplicazione è voluta e cosa la tiene allineata.
  **Evidenza**: `lib/loader/general.ts:40-85` parte da una base vuota e **pretende** di trovare
  `lib/config/general.ts` (`:75`, errore se manca, perché senza quel file ogni default è
  `undefined`). Test `test/lib/merge.spec.ts:88` sulle chiavi che la vecchia lista non aveva.

- [x] **T-10.9** Una sola famiglia di variabili per la connessione al control plane.
  **Dove**: `lib/config/general.ts:27-35` legge `CONTROL_ENGINE`, `DATABASE_URL`, `DB_SCHEMA`,
  `DB_POOL_MAX`, `DB_POOL_IDLE_MS`; `lib/database/adapters/postgres/index.ts` legge
  `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, che non passano dal file di
  configurazione pur essendo documentate in `docs/CONFIGURATION_V5.md`.
  **Da decidere anche**: esiste `CONTROL_ENGINE` e non esiste il corrispettivo per
  `tenants.engine`, che si può scegliere solo da file.
  **Chiuso quando**: la tabella dell'ambiente in `docs/CONFIGURATION_V5.md` e i punti di lettura
  nel codice coincidono, e per ogni variabile è scritto quale blocco di configurazione alimenta.
  **Evidenza e scoperta**: inventario delle letture contro le due tabelle dell'ambiente. Sette
  variabili lette e documentate da nessuna parte (`CONTROL_ENGINE`, `DB_SCHEMA`,
  `DB_POOL_IDLE_MS`, `RESET_PASSWORD_TOKEN_TTL`, `PASSWORD_EXPIRATION_DAYS`, `MANIFEST_DUMP`,
  `MANIFEST_DUMP_EXIT`), ora in `docs/CONFIGURATION_V5.md` §4 (con la colonna «dove finisce») e
  nella tabella del `README.md`. Cinque default del README erano diversi dal codice
  (`JWT_EXPIRES_IN` 5d contro 15d, `LOG_LEVEL` info contro debug, `SWAGGER` true contro false,
  `SWAGGER_TITLE`, `SWAGGER_VERSION`): allineata la documentazione, non il codice.
  **Il difetto vero**: `TENANT_CONTAINERS_MAX_OPEN` e `TENANT_CONTAINERS_DIR`, ricollegati da
  T-9.4, erano di nuovo ignorati a ogni avvio con `tenants` dichiarato, perché `normalizeOptions`
  riempiva `containers.maxOpen` e `.directory` e quindi il `configurato ?? ambiente` degli
  adapter non arrivava mai all'ambiente. Tolti quei due default dal loader
  (`lib/loader/general.ts:18-26`); `test/db/containerLimits.spec.ts` segue il valore dal loader
  all'adapter, e **fallisce sul codice di prima** (2 su 4, verificato rimettendo i default).
  **Non fatto, e scritto in §4**: l'unificazione delle due famiglie (`DATABASE_URL` contro
  `DB_*`), perché romperebbe chi usa la forma discreta; e una variabile per `tenants.engine`,
  che resta una decisione.
  **Seguito, deciso l'11 settembre 2026**: `LOG_LEVEL` non impostato vale `info` in produzione e
  `debug` altrove (`lib/util/logger.ts`, `getLogLevel`), e un valore esplicito vince sempre. Il
  livello è riletto in `index.ts` dopo `dotenv.config()`, perché il logger nasce durante gli
  import e prima non vedeva un `NODE_ENV` scritto in `.env`: verificato con un processo che ha
  `NODE_ENV=production` solo in `.env`, che ora parte a `info` e prima partiva a `debug`.
  Accettato anche `silent`, che lo script `test:e2e:mt:pg` imposta e che veniva ignorato.
  Test in `test/lib/logger.spec.ts`.

- [x] **T-10.10** `LOG_FASTIFY` esiste solo dentro una riga commentata.
  **Dove**: `index.ts:173`.
  **Chiuso quando**: la riga è rimossa, oppure il logger di Fastify è di nuovo configurabile e
  la variabile è documentata.
  **Evidenza**: `index.ts:180`, `fastify({ logger: yn(process.env.LOG_FASTIFY, false) })`.
  Ripristinata invece che rimossa, perché era documentata in `README.md` e `llms.txt` e il
  default `false` lascia invariato il comportamento di chi non la imposta.

---

## C. Allineamento di `volcanic-admin` alla v5

Il ponte Magic Query è già allineato e verificato: gli operatori emessi da
`src/engine/magic-query.ts:29-55` esistono tutti in `lib/database/query/operators.ts`, e le
intestazioni lette a `:206` sono quelle emesse da `lib/database/query/index.ts:259-263`. Quello
che segue è tutto il resto, che non è stato toccato dallo stesso commit.

- [x] **T-10.11** Il `basePath` di default non corrisponde a nessun deployment v5.
  **Dove**: `src/engine/providers/data.ts:35` usa `/admin`; la v5 monta sotto `/admin`
  soltanto `/admin/manifest` (`lib/api/admin/routes.ts:16`, confermato da `docs/API_V5.md:18`),
  mentre le rotte reali stanno su `/<path della risorsa>` e il manifest le pubblica così
  (`lib/manifest/generator.ts:247`).
  **Effetto oggi**: con il default ogni chiamata CRUD va in 404, serve sempre `apiBasePath: ''`.
  **Chiuso quando**: il default è `''`, oppure il data provider costruisce l'URL dal `path`
  che la capability già porta con sé (`generator.ts:209`, `:220`), e `docs/CONSUMING.md` lo dice.
  **Evidenza**: default `''` in `src/engine/providers/data.ts:42` di `volcanic-admin`; la prop
  `apiBasePath` resta per un'API pubblicata sotto un prefisso che `apiUrl` non include
  (`src/VolcanicAdmin.tsx`, `docs/CONSUMING.md` §4, `docs/CONFIGURATION.md` §10, `llms.txt`), e
  dall'esempio di §1.1 è sparito l'`apiBasePath=""` che serviva solo a correggere il default.
  Scelto il default vuoto invece dell'URL costruito dalla capability perché le due strade già
  coincidono: il CRUD usa `spec.path`, che il generatore emette relativo alla radice
  (`generator.ts:248`), e le azioni passano già dal `path` della capability senza prefisso
  (`useCapabilityRunner`, `custom` su `apiUrl` più il path). Verifica del 15 settembre 2026 con uno
  script usa e getta che guida client e data provider dell'admin contro `volcanic-backend-sample`
  reale (Postgres usa e getta, cookie), risolvendo la risorsa per nome come fa `<VolcanicAdmin>`:
  con il default `GET /partners -> 200`, con il vecchio `'/admin'` `GET /admin/partners -> 404`.

- [x] **T-10.12** Le due fetch fuori dal data provider non si autenticano.
  **Dove**: `src/VolcanicAdmin.tsx:491` (manifest) e `:236` (lista tenant) inviano solo
  `credentials`, mai `Authorization`; entrambe le rotte richiedono `isAuthenticated`
  (`lib/api/admin/routes.ts:21`, `lib/api/tenants/routes.ts:24`).
  **Effetto oggi**: in modalità bearer non passano mai. Il manifest per giunta viene caricato
  al mount, prima del cancello di autenticazione, quindi la prima visita mostra la schermata
  di errore invece di quella di login. Non morde nel flusso a manifest pinnato, che
  `docs/CONSUMING.md:17` indica come default, morde nel fetch a runtime di `:132`.
  **Chiuso quando**: entrambe passano dallo stesso costruttore di header del data provider, e
  il caricamento del manifest a runtime avviene dopo l'autenticazione o gestisce il 401
  rimandando al login invece che alla pagina d'errore.
  **Evidenza**: un solo costruttore delle richieste, `createApiRequest` in
  `src/engine/providers/http.ts` di `volcanic-admin` (header di contesto, token in bearer, cookie in
  cookie, un rinnovo sul 401), usato dal data provider e dal caricatore del manifest
  (`src/VolcanicAdmin.tsx`). La lista tenant non ha più un default: dopo T-10.15 è una rotta di
  controllo che nessun utente di tenant può chiamare, e resta solo come prop per chi porta la sua.
  Un caricamento fallito con 401, `TENANT_REQUIRED`, `TENANT_NOT_FOUND` o `SCOPE_MISMATCH` disegna
  il login (`needsLogin`, `BootstrapLogin`) invece della pagina d'errore, e a login completato il
  manifest si ricarica (`renderError(error, retry)` in `src/engine/manifest.tsx`). Verifica del 15
  settembre 2026 contro `volcanic-backend-sample` con `SAMPLE_TENANTS=header`, cookie su 2230 e
  bearer su 2231 (script usa e getta, 27 PASS su 27): in bearer la fetch di prima (solo cookie) dà
  `GET /admin/manifest -> 401`, il costruttore condiviso `200 +bearer`; una sessione di controllo sul
  manifest del cliente dà `403 SCOPE_MISMATCH`, che la console tratta come login. Nel browser
  (Playwright, admin in dev su `localhost:5173`): prima visita `GET /admin/manifest -> 400
  TENANT_REQUIRED` e schermata di login, non d'errore; visita successiva `401`, un tentativo di
  rinnovo, login, poi `POST /auth/login -> 200`, `GET /admin/manifest -> 200`, `GET /users -> 200`.
  **Trovato facendolo**: il login in bearer mandava il token salvato, e il backend rifiuta un login
  di controllo con un token di tenant (`403 SCOPE_MISMATCH`), cioè proprio la sessione che una
  console che cambia piano sta sostituendo. Login e rotte pubbliche delle password ora sono anonimi
  (`src/engine/auth/client.ts`).

- [x] **T-10.13** `manifest.auth.endpoints` è emesso dal backend e non lo legge nessuno.
  **Dove**: il backend lo produce (`lib/manifest/generator.ts:265`), l'admin lo tipizza
  (`src/engine/types/manifest.ts`), ma `src/VolcanicAdmin.tsx:199` costruisce il client senza
  passarlo e `VolcanicAdminProps` non espone un modo per farlo: valgono i default hardcoded di
  `src/engine/auth/client.ts:59-68`. Del blocco `auth` si usa solo `mode` (`:196`).
  **Chiuso quando**: `createVolcanicAuthClient` riceve `manifest.auth.endpoints`, con le props
  dirette che vincono sulle chiavi in collisione, come già fa il resto della composizione.
  **Evidenza**: `src/VolcanicAdmin.tsx:210-220` passa a `createVolcanicAuthClient` gli endpoint
  del manifest fusi con la prop nuova `authEndpoints`, che vince chiave per chiave (documentata in
  `docs/CONSUMING.md` §4, `docs/CONFIGURATION.md` §10, `llms.txt`). La dipendenza del `useMemo` è
  la stringa degli endpoint e non l'oggetto, così un `authEndpoints` scritto in linea non ricrea il
  client, e con lui il rinnovo condiviso di T-10.39, a ogni render. Verifica del 15 settembre 2026
  contro il sample reale: il manifest dichiara `/auth/login`, `/auth/refresh-token`,
  `/auth/logout`; con `login` sostituito il client chiama `POST /auth/login-renamed-by-prop`
  (404, cioè la chiamata va dove dice la prop) e per `logout`, non sostituito, `POST /auth/logout ->
  200` dal manifest.

- [x] **T-10.14** Non esiste login sul piano di sistema, quindi la gestione della piattaforma è
  irraggiungibile.
  **Dove**: le rotte del registro tenant sono `scope: 'control'`
  (`lib/api/tenants/routes.ts:11`) e i loro ruoli si risolvono contro il catalogo di sistema
  (`lib/loader/router.ts:188-204`), la cui autenticazione sta su `/system/auth/login`
  (`lib/api/system/routes.ts:35`). Il client dell'admin conosce solo `/auth/login`
  (`src/engine/auth/client.ts:59`).
  **Effetto oggi**: `rolesStore` non conterrà mai un `system:*`, quindi `canAccessResource`
  (`src/engine/providers/accessControl.ts:33-37`) nasconde le schermate dei tenant anche
  quando il manifest le descrive.
  **Chiuso quando**: l'admin può autenticarsi sul piano di controllo, e con un operatore di
  sistema la risorsa `tenant` compare in navigazione.
  **Decisione del 15 settembre 2026**: prop `plane` sull'admin, e un manifest per piano.
  **Evidenza**: backend: `GET /system/auth/me` (`systemAuth.me`, ruolo `public` più
  `isAuthenticated`, perché `roles: []` su una rotta di controllo vale il solo superuser) e
  `GET /system/manifest` (`systemManifest.get`, capability `manifest` del catalogo di controllo, solo
  con i tenant e il manifest attivi); `/admin/manifest` diventa di scope tenant. Il generatore
  descrive un piano solo quando i piani sono distinti (`splitPlanes`, filtro su `tenantContext`),
  dichiara `auth.plane` e gli endpoint di quel piano (`AUTH_ENDPOINTS`, `lib/manifest/generator.ts`),
  e `MANIFEST_DUMP_PLANE=control` scarica quello della piattaforma. `manifest` sta in entrambi i
  cataloghi e il router rifiutava l'avvio multi-tenant: `SHARED_CAPABILITIES` in
  `lib/loader/roles.ts`. Admin: `plane` sceglie endpoint (`PLANE_ENDPOINTS`,
  `src/engine/auth/endpoints.ts`), URL del manifest e assenza dell'header tenant; il login di
  piattaforma nasconde il reset password e l'Account nasconde cambio password e disattivazione MFA,
  che su quel piano non esistono; un manifest pinnato dell'altro piano dà un errore dichiarato.
  Test: 4 nuovi in `test/lib/systemScope.spec.ts` (`me` risponde a ogni identità di sistema con i
  suoi ruoli, senza colonne di credenziali, 401 anonimo, 403 `SCOPE_MISMATCH` a un token di tenant),
  3 in `test/lib/manifest.spec.ts` (un piano per console) più il control plane in `tenancyOf`, 1 in
  `test/lib/router.spec.ts`; `test:lib` 358 verdi, `check-all` verde. Verifica del 15 settembre 2026
  nel browser (admin in dev su `localhost:3000` con `VITE_ADMIN_PLANE=control`) con un
  `system:auditor`, cioè non il superuser: `POST /system/auth/login -> 200`,
  `GET /system/manifest -> 200`, `GET /system/auth/me -> 200`, `GET /tenants -> 200`, e in
  navigazione la sola risorsa `tenant` con i due tenant creati dallo script.

- [x] **T-10.15** Il login non invia l'header di contesto.
  **Dove**: `src/engine/auth/client.ts:78-87` costruisce gli header senza
  `tenantStore.headers()`, che è cablato solo nel data provider
  (`src/VolcanicAdmin.tsx:217`).
  **Effetto oggi**: in un deployment multi-tenant con resolver `header`, `/auth/login` è una
  rotta tenant e ha bisogno del contenitore per risolvere l'utente
  (`lib/util/tenantResolution.ts:22-32`, `lib/util/tenancy.ts:61-66`): il primo login non si
  chiude.
  **Da decidere insieme a T-10.14**: quale tenant vale prima che esista una sessione, visto
  che oggi la lista arriva da una rotta autenticata.
  **Chiuso quando**: esiste un percorso di login documentato per il caso `resolver: 'header'`,
  provato contro il sample con il blocco `tenants` attivo.
  **Decisione del 15 settembre 2026**: il tenant si chiede al login (campo ricordato nel browser) o
  lo fissa la prop `tenant`; sul piano tenant il selettore sparisce, perché dal login il token lega
  il tenant.
  **Evidenza**: il client manda l'header di contesto su ogni chiamata, non solo sul rinnovo
  (`src/engine/auth/client.ts`); `TenantProvider` riscritto con tenant fisso o scelto e con
  `asksTenant` (`src/engine/providers/tenant.tsx`), `LoginView` con il campo Organization e
  `TENANT_NOT_FOUND` nominato. Nel backend `tenancyOf` emette `switchable: false` e l'header solo
  sul piano tenant con resolver `header`; la lista `/tenants` sparisce dal manifest. Il sample ha
  il blocco `tenants` dietro `SAMPLE_TENANTS=header` (`src/config/general.ts`). Verifica del 15
  settembre 2026, script contro il sample: senza header `POST /auth/login -> 400 TENANT_REQUIRED`,
  con l'header `200 [x-tenant-id ...]`, e con l'header anche `/users/me`, `/admin/manifest`,
  `/partners` e il rinnovo; un'organizzazione sconosciuta è `TENANT_NOT_FOUND`.
  **Trovato nel browser, invisibile allo script**: il preflight CORS non ammetteva `x-tenant-id`, e
  il login di una console su un'altra origine non partiva nemmeno (`Request header field
  x-tenant-id is not allowed by Access-Control-Allow-Headers`). Ora `withTenantHeader`
  (`lib/util/cors.ts`, applicata alle opzioni effettive in `index.ts`, quindi anche a un
  `config/plugins.ts` del consumer) aggiunge l'header dove il backend lo legge; 4 test in
  `test/lib/cors.spec.ts`, e il preflight risponde `access-control-allow-headers: ..., x-tenant-id`.
  Dopo il fix, nel browser: login con Organization, `POST /auth/login -> 200`,
  `GET /admin/manifest -> 200`, navigazione con i partner e senza il registro dei tenant.

- [x] **T-10.16** Le azioni non-CRUD arrivano al client senza descrizione dell'input.
  **Dove**: `lib/manifest/generator.ts:215-224` emette `name`, `kind`, `method`, `path`,
  `roles`, `label`, `target` e nient'altro; `ActionInput` e `ActionInputField` esistono nei tipi
  dell'admin e non vengono mai popolati.
  **Effetto oggi**: distruzione in due fasi (token monouso, slug ridigitato, secondo fattore),
  export e impersonificazione non hanno modo di raccogliere un payload, quindi restano pulsanti
  che sparano una richiesta vuota.
  **Nota**: questa non è una correzione, è un pezzo di grammatica del manifest da progettare.
  Va aperta come voce a sé e non chiusa insieme alle altre.
  **Chiuso quando**: esiste la specifica in `docs/` e almeno un'azione del registro tenant la usa.
  **Decisione del 15 settembre 2026**: l'input si deriva dal body schema della rotta, e un hint
  `config.manifest.input` aggiunge widget, etichette, esclusioni e `required` (F17 in
  `EVO_PUNTI_APERTI.md`).
  **Evidenza**: specifica in `docs/API_V5.md` §7.1. Il generatore la applica con `inputOf`
  (`lib/manifest/generator.ts`), il router porta l'hint per rotta (`input` in `ConfiguredRoute`,
  `ActionInputHints` in `types/global.d.ts`). Nel registro dei tenant la usano `suspend` e
  `impersonate`, con `tenantSuspendBodySchema` e `tenantImpersonateBodySchema` (`lib/schemas/tenant.ts`)
  senza `required`, perché `USER_REQUIRED` e `REASON_REQUIRED` restano codici del controller, e con
  l'hint che li marca obbligatori. Lato admin `ActionInput` e `ActionInputField` entrano in
  `manifest.v2.schema.json`: con `additionalProperties: false` e nessuna definizione, prima
  `volcanic-admin-pull` avrebbe rifiutato ogni manifest con un input. Il dialogo disegna
  `widget: 'textarea'` come area di testo (`src/ui/actions/ActionButtons.tsx`). Test: 4 in
  `test/lib/manifest.spec.ts` (campi e tipi dal body schema, hint con esclusione e `required`, token
  della distruzione non filtrato, nessun input senza body né sul CRUD); `test:lib` 362 verdi,
  `check-all` verde. Verifica del 15 settembre 2026 contro il sample multi-tenant, script usa e getta
  (7 PASS su 7): i manifest veri dei due piani passano lo schema v2 in strict come in
  `volcanic-admin-pull`, `impersonate` porta `userId` e `reason` obbligatori con `reason` in textarea,
  `suspend` una `reason` facoltativa, e senza `reason`, con o senza body, la risposta è ancora
  `400 REASON_REQUIRED`. Nel browser, console di piattaforma come `system:admin`: il dialogo
  «Impersonate» chiede User Id e Reason con l'asterisco, il pulsante resta disabilitato finché non
  sono compilati, Reason è un `TEXTAREA` di tre righe, e l'invio dà
  `POST /tenants/<id>/impersonate -> 200`.
  **Non fatto**: `DELETE /tenants/:id/data` (token, slug, otp) ed `export` non hanno ancora un body
  schema, quindi nemmeno un dialogo. La grammatica li copre; gli schema restano da scrivere.

- [x] **T-10.17** Due copie della stessa unione di tipi che divergono.
  **Dove**: `src/engine/types/manifest.ts` dichiara `FieldType` con `textarea`, che
  `lib/manifest/generator.ts:16-18` non emette mai; `image` e `file` sono nell'unione di
  entrambi ma il generatore non ha logica che li inferisca, e `image.endpoints` (usato da
  `src/ui/generators/AutoForm.tsx:135`, `:161`, `:200`) nasce solo negli override.
  **Chiuso quando**: le due unioni coincidono, oppure è scritto quali membri esistono solo per
  gli override e perché il generatore non può dedurli.
  **Evidenza**: entrambe le cose. Le copie erano tre, non due: anche `manifest.v2.schema.json`, che
  `volcanic-admin-pull` usa per validare, non aveva `textarea`. Aggiunto al `FieldType` del
  generatore (`lib/manifest/generator.ts`) e allo schema JSON, e scritto accanto a ciascuna delle tre
  copie e in `docs/CONFIGURATION.md` di `volcanic-admin` quali membri inferisce `mapType` e quali
  arrivano solo dagli override, con il motivo: un JSON Schema non distingue testo lungo o ricco da
  una stringa, e non porta né la risorsa e la chiave di una relazione né gli endpoint di un upload.
  Verifica del 15 settembre 2026, script usa e getta che legge i tre file: `admin (17)`,
  `backend (17)`, `schema (17)`, `admin == backend: true, admin == schema: true`; inferiti da
  `mapType` 11 (`boolean date datetime email enum integer json number string url uuid`), solo da
  override 6 (`file image relation richtext text textarea`). I manifest veri del sample passano lo
  schema in modalità strict (verifica di T-10.16).

- [x] **T-10.18** La documentazione dell'admin è ferma alla v4.
  **Dove**: `docs/CONSUMING.md:23` cita «backend ≥ 3.2»; `docs/ARCHITECTURE.md:434` descrive
  l'isolamento via `search_path` e `runInTenantContext`, vocabolario rimosso nella v5.
  **Chiuso quando**: nessun file di `docs/**` nomina `runInTenantContext`, e la versione minima
  del backend è quella vera.
  **Evidenza**: `docs/ARCHITECTURE.md` §7 riscritto sul modello v5 (un piano per console, tenant
  chiesto al login o fissato, nessun selettore, contenitore aperto dal token e mai con uno switch
  sulla connessione); `docs/CONSUMING.md:23` dice `@volcanicminds/backend` 5.x invece di «≥ 3.2», e il
  nuovo §4.2 descrive piano e tenant. Corretti anche i residui fuori da `docs/` che dicevano la stessa
  cosa sbagliata: il README e `llms.txt` di `volcanic-admin` (CRUD sotto `/admin/<path>`, subpath
  `/typeorm` del backend) ed `examples/client-starter/.env.example`. Verifica del 15 settembre 2026:
  `grep -rn runInTenantContext docs` non trova niente; cercando `search_path`, «≥ 3.2», `/admin/<path>`,
  `/admin/<resource>`, `backend/typeorm` e «generic CRUD» in `docs`, README, `llms.txt`, `NPM.md` ed
  `examples` resta solo `docs/ARCHITECTURE.md:26`, che dice che il manifest **non** usa
  `/admin/<resource>`.

Le tre voci che seguono sono state aggiunte l'11 settembre 2026, su decisione: **di default la
sessione del browser sta in un cookie httpOnly, mai in `localStorage`**, e l'access token torna
breve. Vanno fatte in quest'ordine, perché ciascuna regge la successiva.

- [x] **T-10.37** Il default di autenticazione è il cookie httpOnly, non `localStorage`.
  **Oggi, nel codice**: il default del backend è `BEARER` (`lib/util/bearer.ts:21`,
  `lib/manifest/generator.ts:340`, `README.md` tabella dell'ambiente); l'admin prende la modalità
  dal manifest (`src/VolcanicAdmin.tsx:196`), quindi senza `AUTH_MODE=COOKIE` esplicito lavora
  in bearer e tiene token e refresh token in `localStorage` (`src/engine/auth/tokenStore.ts:12-17`),
  leggibili da qualunque script della pagina. La documentazione dell'admin dice il contrario:
  `docs/CONSUMING.md:434` indica `'cookie'` come default, e il sample non imposta `AUTH_MODE`.
  **Il nodo da sciogliere prima di cambiare il default**: `bearerTokenOf` legge **una sola**
  fonte per configurazione (`lib/util/bearer.ts:16-33`). In `COOKIE` l'header `Authorization`
  non viene letto affatto, quindi i token di integrazione (`/token`, «Integration token
  functions») e qualunque client che non sia un browser smettono di funzionare. Girare il default
  così com'è romperebbe ogni integrazione di ogni progetto che non imposta `AUTH_MODE`.
  **Assunzione di lavoro, da confermare**: due canali con un ruolo ciascuno e non a caso, cioè il
  cookie per le sessioni utente e l'header solo per i token di integrazione; la regola di
  `bearer.ts` («una fonte per configurazione») diventa «una fonte per tipo di credenziale».
  **Vincolo di deployment da scrivere**: il cookie è `sameSite: 'strict'`
  (`lib/api/auth/controller/auth.ts:405`), quindi admin e API devono stare sullo stesso sito
  (stesso dominio registrabile, per esempio `admin.x.com` e `api.x.com`). Su domini diversi
  servono `sameSite: 'none'`, `secure` e una protezione CSRF esplicita.
  **Chiuso quando**: un backend senza `AUTH_MODE` imposta la sessione in un cookie httpOnly,
  l'admin non scrive nulla in `localStorage`, un token di integrazione funziona ancora
  dall'header, e `docs/MIGRATION_V4_V5.md` spiega il cambio. Con il cookie come default, T-10.12
  resta vera solo per chi sceglie esplicitamente bearer.
  **Evidenza**: assunzione confermata nella forma dei due canali. `authMode()` vale `COOKIE` senza
  variabile e rifiuta ogni valore che non sia uno dei due modi (`lib/util/credential.ts:54-60`,
  chiamata al boot in `index.ts`); in modalità cookie l'header accetta solo token di integrazione e
  un token di sessione lì è `401 CREDENTIAL_CHANNEL` (`lib/hooks/onRequest.ts:104-108`). Ogni piano
  ha la sua coppia di cookie (`auth_token`/`refresh_token`, `control_token`/`control_refresh_token`),
  perché l'operatore che impersona tiene la sessione di controllo che può chiudere l'impersonificazione:
  il token di impersonificazione va nel cookie del tenant (`lib/api/tenants/controller/tenants.ts:549`)
  e la chiusura lo toglie solo se contiene quella sessione (`:592`). Anche il token pre-MFA passa dal
  cookie (`issuePreAuth`, `lib/util/credential.ts:218`): prima la verifica MFA leggeva l'header a mano
  e in modalità cookie un utente con MFA non entrava. Un progetto che disabilita il plugin cookie in
  modalità cookie è rifiutato al boot (`index.ts:213`). Lato admin nulla finisce in `localStorage` in
  modalità cookie, e gli avanzi di una configurazione bearer vengono rimossi
  (`src/engine/providers/auth.ts:27`, `:30` in `volcanic-admin`). Test: 26 casi in
  `test/lib/authChannels.spec.ts`, fra cui «still accepts an integration token from the header» e
  «refuses a session token taken out of its cookie»; `docs/MIGRATION_V4_V5.md` §24. `test:lib` e
  `test:e2e:mt:pg` fissano `AUTH_MODE=BEARER` nello script (`docs/TESTING_V5.md` §1 spiega perché).

- [x] **T-10.38** In modalità cookie la sessione ha due durate che non si parlano.
  **Dove**: il cookie ha `maxAge: 86400` scritto a mano (`lib/api/auth/controller/auth.ts:407`,
  uguale in `lib/api/system/controller/systemAuth.ts:71-77`), mentre il JWT che contiene scade
  dopo `JWT_EXPIRES_IN`, oggi 15 giorni. Il browser butta il cookie dopo un giorno, ma chi ne
  copia il valore lo può rigiocare per quindici.
  **Chiuso quando**: la durata del cookie e quella del JWT derivano da un'unica impostazione, e
  un test lo verifica.
  **Evidenza**: il `Max-Age` di ogni cookie di sessione è letto dall'`exp` del token che contiene
  (`secondsLeft`, `lib/util/credential.ts:142-146`), quindi l'unica impostazione è quella che firma il
  token, per l'access, per il refresh, per il pre-MFA (300 s) e per l'impersonificazione (il suo TTL).
  Test: «reads Max-Age from the token it carries, for the access and the refresh cookie»
  (`test/lib/authChannels.spec.ts:388`), che confronta `exp - iat` con il `Max-Age` ricevuto.

- [x] **T-10.39** Rinnovo automatico, poi access token breve.
  **Dove**: il rinnovo vuole `{ token, refreshToken }` nel corpo
  (`lib/api/auth/controller/auth.ts:440-456`), ma in modalità cookie il login restituisce
  `token: null` e `refreshToken: null` (`:410-418`): oggi in cookie non esiste rinnovo, e la
  sessione finisce quando scade il cookie. Lato admin il refresh token viene salvato e mai usato,
  e il primo 401 fa logout (`src/engine/providers/auth.ts:26`, `:142-145`).
  **Cosa**: un refresh token anche lui in cookie httpOnly, limitato al percorso di rinnovo; l'admin
  che su un 401 tenta il rinnovo una volta prima di rimandare al login; **solo dopo**
  `JWT_EXPIRES_IN` da `15d` a `1h`. Il rischio attuale è contenuto, perché ogni richiesta rilegge
  utente e ruoli dal database (`lib/hooks/onRequest.ts:176-203`) e il blocco di un utente vale
  subito, ma un token rubato resta buono quindici giorni e la sola revoca possibile è quella di
  tutte le sessioni dell'utente (`/auth/invalidate-tokens`).
  **Chiuso quando**: una sessione dell'admin sopravvive alla scadenza dell'access token senza
  login, il default è `1h`, e `docs/MIGRATION_V4_V5.md` lo annota come cambio di comportamento.
  **Evidenza**: il refresh token porta `typ: 'refresh'` ed è rifiutato come access token, e un access
  token è rifiutato come refresh (`lib/util/credential.ts:193`, `lib/hooks/onRequest.ts:95`,
  `lib/api/auth/controller/auth.ts:487`): senza il claim, con `JWT_REFRESH_SECRET` non impostato, un
  access token breve poteva rinnovare se stesso all'infinito. In modalità cookie il rinnovo legge solo
  il cookie di refresh, limitato alla rotta di rinnovo (`renewFromCookie`, `auth.ts:521`,
  `systemAuth.ts:145`); `COOKIE_PATH_PREFIX` per chi pubblica l'API sotto un prefisso tolto dal
  proxy. Lato admin un `401` tenta un solo rinnovo condiviso fra le richieste concorrenti e ripete la
  richiesta (`src/engine/auth/client.ts:162-170`, `src/engine/providers/data.ts:68`). Verifica end to
  end dell'11 settembre 2026: script usa e getta che guidava client e data provider dell'admin contro
  un server reale con access token da 2 s, in cookie e in bearer; dopo la scadenza cinque richieste
  parallele riuscite con un solo rinnovo, e senza refresh token il `401` arriva a Refine (14 PASS su
  14). Default `JWT_EXPIRES_IN = '1h'` a `index.ts:200`, abbassato dopo il rinnovo;
  `docs/MIGRATION_V4_V5.md` §24. I refresh token emessi prima non rinnovano più (manca il claim).

---

## D. Sample committabile

Oggi il porting è lavoro verificato e non committato, per scelta. Prima di committarlo vanno
chiuse queste voci, perché due di esse rendono il sample non funzionante su un database pulito.

- [x] **T-10.19** Le migrazioni del progetto non vengono mai applicate.
  **Dove**: `db.ts::migrationSets()` legge la cartella del consumer a
  `<cwd>/migrations/<set>/<dialect>`; `drizzle.config.ts:16-17` genera in
  `./migrations/control` e `./migrations/tenant`, senza dialetto, e gli script
  `db:generate` e `db:generate:tenant` di `package.json` non passano `MIGRATION_DIALECT` come
  fanno quelli del framework.
  **Effetto oggi**: `readMigrations` su cartella inesistente restituisce `[]`
  (`lib/database/migrations/files.ts:40`), quindi `npm run db:migrate` riporta «nothing
  applied» ed esce verde: la tabella `partner` non nasce e il demo va in errore.
  **Chiuso quando**: i due file SQL stanno sotto `migrations/<set>/pg`, gli script generano lì,
  e `npm run db:migrate` su un database vuoto crea `partner`.
  **Provato l'11 settembre 2026**, non più solo dedotto: avviato
  `postgres:16-alpine` vuoto sulla porta del sample e lanciato la sua suite, che al bootstrap
  applica le migrazioni. `psql \dt public.*` elenca otto tabelle, tutte del framework
  (`change`, `destruction_request`, `impersonation`, `migration`, `system_user`, `tenant`,
  `token`, `user`). `partner` e `user_profile` non esistono, e nessun comando ha segnalato niente.
  **Evidenza**: SQL e `meta/` spostati in `migrations/control/pg` e `migrations/tenant/pg`;
  `drizzle.config.ts:15-25` genera lì, con il perché. Su database svuotato `npm run db:migrate`
  riporta `control plane at version 0000_marvelous_ezekiel`, e `information_schema` elenca
  `partner` e `user_profile` accanto alle tabelle del framework; la tabella `migration` registra sia
  `0000_initial_control` sia `0000_marvelous_ezekiel`. `npm run db:generate` e
  `db:generate:tenant` rispondono «No schema changes», quindi il journal spostato è coerente.

- [x] **T-10.20** Lo schema del control plane si legge dalla configurazione, non dall'ambiente.
  **Dove**: `index.ts:30` e `scripts/migrate.ts:18` leggono `process.env.DB_SCHEMA || 'public'`;
  lo script omologo del framework legge `config.options.control.schema`
  (`scripts/migrate-control.ts:25`).
  **Chiuso quando**: entrambi i punti passano dalla configurazione già caricata.
  **Evidenza**: `index.ts:30-31`, `scripts/migrate.ts` e `test/common/bootstrap.ts:24` leggono
  `global.config.options.control.schema`; lo script di migrazione ora passa da `preload()` invece di
  importare direttamente `src/config/general.ts`, che da solo è il livello del progetto senza i
  default del framework.

- [x] **T-10.21** `enable: true` nel config generale non lo legge nessuno.
  **Dove**: `src/config/general.ts:19`; il loader controlla solo `config.name` e fonde
  `options` (`lib/loader/general.ts:71-77`).
  **Chiuso quando**: la chiave è rimossa.
  **Evidenza**: tolta da `src/config/general.ts`.

- [x] **T-10.22** Il sample non è consumabile da `volcanic-admin`.
  **Dove**: nessun `manifest: { enabled: true }` in `src/config/general.ts`, e nessuna
  `routes.ts` dichiara `config.manifest` (né `group`, né `resource`, né `globalSearch`, che il
  generatore leggerebbe a `lib/manifest/generator.ts:252-255`).
  **Chiuso quando**: `GET /admin/manifest` sul sample restituisce almeno la risorsa `partner`
  con etichette e campi, e l'admin la elenca.
  **Evidenza**: `manifest: { enabled: true }` nel config e hint `group`, `titleField`,
  `subtitleField`, `globalSearch` in `src/api/partners/routes.ts`. **Ha trovato un difetto del
  framework**: senza tenant `/admin/manifest` rispondeva 403 anche al fondatore, perché le rotte di
  controllo risolvevano i ruoli solo contro il catalogo di sistema, e in single tenant utenti di
  sistema non esistono (`/system/*` non è nemmeno montato). Endpoint montato e irraggiungibile da
  chiunque. Corretto in `lib/loader/router.ts` (`resolveRequiredRoles`): senza tenant il cancello di
  una rotta di controllo include il superuser applicativo e i ruoli applicativi che dichiarano la
  stessa capability; con i tenant non cambia nulla. Test in `test/lib/router.spec.ts`, e il test
  multi-tenant esistente ora dichiara i tenant invece di presumerli. **Secondo residuo trovato**:
  l'utente del framework aveva `titleField: ['firstName', 'lastName']` e gli schemi JSON accettavano
  quei due campi, ma la tabella `user` v5 non ha colonne di nome: tolti da `lib/schemas/user.ts`, dalla
  whitelist di `PUT /users/me` e dall'hint (ora `email`), annotato in `docs/MIGRATION_V4_V5.md` §1.
  Verificato con `curl`: login del fondatore, `GET /admin/manifest` restituisce `tenancy: single` e
  la risorsa `partner` con gruppo, titolo e ricerca.

- [x] **T-10.23** `profile.service.ts` è documentato e non cablato.
  **Dove**: descritto in `README.md:63` e `CLAUDE.md:49`, la tabella `user_profile` esiste
  (`src/schema/pg.ts:71-79`), ma nessun controller importa `readProfile` o `writeProfile`.
  **Chiuso quando**: esiste una rotta che lo usa, oppure il servizio è rimosso e la
  documentazione con lui.
  **Evidenza**: `src/api/profile/` con `GET` e `PUT /profile`, schemi in `src/schemas/profile.ts`
  (`additionalProperties: false`, quindi un `userId` nel corpo viene tolto e vale quello del token).
  Provato con `curl`: default, scrittura, rilettura, 401 anonimo, 400 su lingua fuori enum.

- [-] **T-10.24** I middleware del sample sono morti e hanno i nomi incrociati.
  **Dove**: nessuna rotta li referenzia (`middlewares: []` in ogni `src/api/*/routes.ts`);
  `src/middleware/postAuth.ts:3` esporta `preSerialization` e `src/middleware/preAuth.ts:3`
  esporta `preHandler`. `postAuth.ts:3` ha anche due parametri non usati senza prefisso `_`.
  **Chiuso quando**: o una rotta li usa, e allora i nomi combaciano con il file, o spariscono.
  **Non applicabile, rilievo sbagliato (11 settembre 2026)**: il nome del file dice *quando* gira
  il middleware, l'export dice *quale hook* di Fastify diventa, e il router li raggruppa per nome
  di export (`lib/loader/router.ts:57-66`), quindi `postAuth.ts` che esporta `preSerialization` è
  voluto. E non sono morti: le rotte `/auth` del framework dichiarano `global.preAuth` e
  `global.postAuth` (`lib/api/auth/routes.ts:26`, `:42`, `:136`), e il loader cerca prima in
  `src/middleware/` del progetto, quindi quelli del sample sostituiscono quelli del framework a
  ogni login. Resta vero solo il punto dei due parametri non usati, chiuso in T-10.30 per il
  framework e in D per il sample.

- [x] **T-10.25** Costanti e helper mai usati.
  **Dove**: `src/config/auth.ts:1-2` (`MINUTES_BETWEEN_FORGOT_PASSWORD_REQUESTS`,
  `MINUTES_BETWEEN_EXPIRED_PASSWORD_REQUESTS`), `src/config/constants.ts:1`
  (`PUSH_TEMPORAL_LIMIT_DAYS`), `src/utils/common.ts:1` (`capitalizeFirstLetter`), e in test
  `login`, `logout`, `del`, `get_with_headers`, `toQueryString` di `test/common/api.ts` più
  `COMPANY2_SUPERUSER_EMAIL` e `COMPANY2_SUPERUSER_PASSWORD` di `test/common/bootstrap.ts`.
  **Chiuso quando**: rimosse, o usate.
  **Evidenza**: cancellati `src/config/auth.ts`, `src/config/constants.ts`, `src/utils/common.ts`
  (il framework carica solo `general`, `plugins`, `roles`, `tracking` da `src/config/`). Gli helper
  HTTP di `test/common/api.ts` invece sono diventati **vivi**: `test/e2e/demo.ts` ora prova sul server
  vero profilo, partner via Magic Query con `v-total`, manifest e 401 dopo il logout, al posto di un
  test che verificava la lunghezza di un array letterale. Le credenziali del bootstrap vengono da
  `ADMIN_EMAIL`/`ADMIN_PASSWORD`: quelle scritte a mano divergevano da `.env`, quindi `login()` non
  poteva funzionare. Tolti anche `uploadData()` vuota e il `log.level = 'trace'` forzato. Suite
  del sample: 7 passanti, 4 dei quali e2e reali.

- [x] **T-10.26** `src/schema/` e `src/schemas/` differiscono per una lettera e sono due cose diverse.
  **Dove**: `src/schema/` contiene le tabelle Drizzle, `src/schemas/` gli schemi JSON di
  Fastify.
  **Chiuso quando**: uno dei due è rinominato in modo che il nome dica cosa contiene, e la
  scelta è riportata in `CLAUDE.md` perché è il sample a fissare la convenzione per i progetti
  che lo copiano.
  **Evidenza**: `src/schema/` rinominata `src/tables/`; aggiornati import, `drizzle.config.ts`,
  `README.md` e `CLAUDE.md` del sample, dove la convenzione è scritta, e gli esempi di `README.md` e
  `llms.txt` del framework, che insegnavano lo stesso nome ai consumer.

- [x] **T-10.27** `better-sqlite3` è in `dependencies` mentre la configurazione dichiara Postgres
  e solo Postgres (`src/config/general.ts:11-15`).
  **Chiuso quando**: la dipendenza è spostata dove serve davvero, o il commento spiega perché
  resta.
  **Evidenza**: `better-sqlite3` e `@types/better-sqlite3` tolti; l'adapter SQLite del framework li
  importa solo dinamicamente (`lib/database/adapters/sqlite/index.ts:146`). Dopo `npm uninstall`
  serve `node scripts/link-peers.mjs`, perché npm non rilancia il `postinstall` e restano due copie
  di `drizzle-orm` (errore di tipi, non di runtime): è il meccanismo che c'era già.

- [~] **T-10.28** Committare il porting.
  **Dipende da**: T-10.3, T-10.19, T-10.20.
  **Chiuso quando**: `git status` del sample è pulito e il commit cita le voci chiuse.
  **Pronto, non eseguito**: il commit si fa su richiesta esplicita. Tutto il lavoro del sample è nel
  working tree, verificato (type-check, lint senza errori, 7 test verdi contro Postgres reale).

---

## E. Igiene del framework

Nessuna di queste rompe niente. Sono residui, e vanno chiuse insieme in un commit solo.

- [x] **T-10.29** `lib/util/regexp.ts`: `username`, `emailAlt`, `zipCode`, `taxCodePersona`,
  `taxCodeCompany`, `iban`, `mobilePhone`, `landLinePhone`, `tollFreePhone` non sono usate da
  nessuno e non sono raggiungibili da un consumer, perché la mappa `exports` di `package.json`
  espone solo `.` e `./db`. Sono anche regole di dominio italiano dentro un framework generico.
  Usate davvero: `email`, `isEmail`, `password` (`lib/api/auth/controller/auth.ts:3`,
  `lib/api/system/controller/systemAuth.ts:4`, `systemUser.ts:4`).
  **Chiuso quando**: il file contiene solo ciò che serve, o le altre sono esportate e
  documentate come superficie pubblica.
  **Evidenza**: `lib/util/regexp.ts` contiene solo `email`, `MAX_EMAIL_LENGTH`, `isEmail` e
  `password`, con un commento che dice perché le altre sono uscite. Nessun test le usava.

- [x] **T-10.30** Simboli e parametri non usati.
  **Dove**: `lib/database/adapters/postgres/index.ts:10` importa `envString` e non lo usa;
  `lib/middleware/postAuth.ts:3` ha `req` e `res` non usati senza prefisso `_`;
  `test/db/query.spec.ts:13` importa `sql` e non lo usa; `test/db/crypto.spec.ts:1` e
  `test/lib/cors.spec.ts:1` hanno direttive `eslint-disable` che non disabilitano niente.
  **Chiuso quando**: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` è vuoto e
  `npm run lint` non riporta warning diversi da `no-explicit-any`.
  **Evidenza**: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` restituisce 0 errori;
  `npx eslint .` riporta 65 avvisi, **tutti** `no-explicit-any`, zero di altro tipo. Tolta anche
  una direttiva inutile che il rilievo non aveva visto, `lib/database/containers/replica.ts:1`.
  `lib/middleware/postAuth.ts` ora ha un commento che spiega perché esporta `preSerialization`.

- [x] **T-10.31** Allineare la severità dei tipi a quella dell'admin.
  **Dove**: `tsconfig.json` del framework e del sample hanno `strict: true` ma
  `noImplicitAny: false` e `noUnusedLocals: false`; `volcanic-admin` ha
  `noUnusedLocals: true` e `noUnusedParameters: true`.
  **Perché ora**: dopo T-10.30 il costo è tre righe in tutto, misurato eseguendo il compilatore
  con quelle opzioni.
  **Chiuso quando**: le opzioni sono attive e `npm run check-all` è verde.
  **Evidenza, in parte**: `noUnusedLocals` e `noUnusedParameters` attivi in `tsconfig.json`
  (ereditati da `tsconfig.test.json`), `npm run type-check` verde. **`noImplicitAny` resta spento**:
  attivarlo dà 167 errori nel codice e 166 nei test, misurati con `tsc --noImplicitAny`. Decisione
  F7 in `EVO_PUNTI_APERTI.md`: si affronta per file.

- [-] **T-10.32** Il pacchetto pubblica i sorgenti TypeScript di `lib/`.
  **Dove**: `package.json` `files: ["dist", "lib", "bin"]`, mentre `exports` rende `lib`
  non importabile e `scripts/copy-assets.mjs` copia dentro `dist/` tutto ciò che serve a
  runtime (locales, `.d.ts`, SQL delle migrazioni).
  **Chiuso quando**: `npm pack --dry-run` non contiene `lib/**/*.ts`, e un consumer installato
  dal tarball supera `npm run check-all`.
  **Non applicabile, rilievo sbagliato**: `lib/` è pubblicato perché ci puntano i source map.
  `dist/lib/util/tenancy.d.ts.map` e `dist/lib/util/tenancy.js.map` hanno
  `"sources": ["../../../lib/util/tenancy.ts"]`: senza i sorgenti nel pacchetto, il «vai alla
  definizione» dell'IDE di un consumer atterra sul `.d.ts` e gli stack trace perdono il TypeScript.
  I 122 file di `lib/` sono il prezzo di quella navigazione, non peso morto.

- [x] **T-10.33** Il messaggio di rifiuto degli operatori è falso.
  **Dove**: `lib/database/query/operators.ts:190` dice «operator names are lowercase», mentre il
  catalogo contiene `arrayContains`, `arrayContainedBy`, `arrayOverlaps`, `jsonHasKey`,
  `jsonHasAllKeys`, `jsonHasAnyKey` (`:161-166`).
  **Chiuso quando**: il messaggio descrive la regola vera, o suggerisce gli operatori vicini.
  **Evidenza**: `lib/database/query/operators.ts:187-197` dice che i nomi sono confrontati
  esattamente e, se esiste un operatore che differisce solo per le maiuscole, lo propone
  (`did you mean 'arrayContains'?`). Due asserzioni nuove in `test/db/query.spec.ts:189-191`.

- [x] **T-10.34** Il nome interno è la grafia che il router rifiuta.
  **Dove**: `lib/loader/router.ts:248-253` rifiuta `tenantContext` come «grafia v4», poi lo
  salva con quel nome (`:263`, `:323`, `types/global.d.ts:393`) e `dataContext` lo rilegge
  (`lib/util/tenancy.ts:50`).
  **Chiuso quando**: il campo interno si chiama come la grafia pubblica, oppure un commento in
  `types/global.d.ts:393` dice che il nome è deliberato e che non è la stessa cosa del campo
  d'autore.
  **Evidenza**: scelta la seconda strada, il commento. `tenantContext` compare 46 volte in 19
  file, 13 dei quali test, e rinominarlo non cambierebbe alcun comportamento. Il commento a
  `types/global.d.ts:393-403` dice che è il booleano risolto dal router, mai scritto da un autore,
  e perché porta il nome che il router rifiuta.

- [x] **T-10.35** Decidere la convenzione delle chiavi di configurazione.
  **Dove**: dentro lo stesso oggetto `options` convivono snake_case storico
  (`allow_multiple_admin`, `mfa_policy`, `export_directory`, `reset_password_token_ttl`) e
  camelCase dei blocchi nuovi (`control.pool.idleTimeoutMs`, `tenants.containers.maxOpen`,
  `manifest.enabled`, `cache.maxEntries`).
  **Nota**: rinominare le chiavi storiche è una rottura per ogni consumer, quindi la voce è una
  **decisione**, non una modifica automatica. Se si sceglie di non toccarle, va scritto dove.
  **Chiuso quando**: la scelta è in `EVO_PUNTI_APERTI.md` con la motivazione.
  **Evidenza**: decisione F5 in `EVO_PUNTI_APERTI.md`: nessuna rinomina in 5.0, chiavi nuove in
  camelCase, convivenza dichiarata.

- [x] **T-10.36** `scripts/copy-assets.mjs` cita ancora `types/database/typeorm/global.ts` in un
  commento, percorso che non esiste più.
  **Chiuso quando**: il commento descrive i file che copia davvero.
  **Evidenza**: `scripts/copy-assets.mjs` descrive dove stanno davvero i tipi del data layer.

---

## F. Coda del blocco C

Aperta il 16 settembre 2026 chiudendo il blocco C: tre difetti corretti subito e tre pezzi che
chiedono un disegno, non una riga. Vale la stessa regola dell'evidenza citata.

- [x] **T-10.22** La regola di `depcruise` non guardava le peer del data layer.
  **Dove**: `.dependency-cruiser.cjs`, regola `core-no-datalayer-import`. Metà regola elencava i
  nomi dei pacchetti (`^(drizzle-orm|better-sqlite3|@libsql/client|bcrypt|pg)$`), ma lo strumento
  confronta il percorso **risolto** (`node_modules/drizzle-orm/index.cjs`): quella metà non poteva
  scattare mai, e il confine reggeva solo per `lib/database/` e `db.ts`. Un import di `pg` dal core
  sarebbe passato in CI.
  **Evidenza**: confronto sul percorso risolto; provato che morde con una sonda `lib/util/zz-probe.ts`
  che importa `pg`, che fa uscire `error core-no-datalayer-import: lib/util/zz-probe.ts →
  node_modules/pg/lib/index.js` e 1 violazione; tolta la sonda, `npm run check-all` è pulito
  (150 moduli, 245 dipendenze).

- [x] **T-10.23** `system:operator` non poteva aprire la console di piattaforma.
  **Dove**: `lib/config/systemRoles.ts`. Il ruolo del lavoro quotidiano non aveva `manifest`, quindi
  non caricava il manifest della console in cui quel lavoro si fa, e un progetto non poteva
  aggiungerglielo: le capability di un ruolo protetto non sono del consumer.
  **Evidenza**: capability aggiunta al catalogo; `docs/AUTHORIZATION_V5.md` §3 allineata, dove la
  riga del ruolo ometteva anche `tenants:read` che il codice aveva già. Prova in
  `test/lib/systemScope.spec.ts` che l'operatore ha `manifest` e continua a non avere
  `tenants:destroy`. `test:lib` 363 verdi.

- [x] **T-10.24** L'MFA di sistema si poteva attivare solo dal superuser.
  **Dove**: `lib/api/system/routes.ts`. `/system/auth/mfa/setup` ed `/enable` avevano `roles: []`,
  che su una rotta di controllo significa il solo `system:admin`: un operatore o un revisore non
  poteva accendere il proprio secondo fattore.
  **Evidenza**: `roles: ['public']` più `isAuthenticated`, cioè ogni identità di piattaforma
  autenticata, la stessa forma di `/system/auth/me`; `docs/API_V5.md` §5 elenca ora le due rotte con
  la loro autorizzazione. Il resto della lacuna (politica non applicata agli operatori, reset
  mancante) è T-10.19.

- [x] **T-10.25** Il data provider dell'admin mandava un corpo anche sulle GET.
  **Dove**: `src/engine/providers/data.ts` di `volcanic-admin`, `custom`. Il corpo veniva allegato a
  ogni chiamata, e `useCapabilityRunner` passa sempre un payload, anche vuoto: una GET con un corpo
  la rifiuta `fetch` prima che parta, quindi nessuna azione GET (un export, un elenco) arrivava mai
  al backend.
  **Evidenza**: niente corpo su GET e HEAD, e nessuno quando il payload è vuoto. Verifica del 16
  settembre 2026 contro il sample reale, 3 PASS su 3: una GET con un corpo alza `TypeError`;
  l'azione `GET /users/roles` passata dal data provider risponde 200; una POST porta ancora il suo
  corpo, perché `POST /auth/login` risponde 401, mentre senza corpo risponderebbe 400 «Email not
  valid».
  **Nota**: `volcanic-admin` non ha un runner di test, quindi la prova è uno script usa e getta. Se
  ne riparla quando si decide se dare un runner all'engine.

- [x] **T-10.26** Le combinazioni supportate, riprovate dopo le modifiche del blocco C.
  **Perché**: il backend deve girare single e multi tenant, con o senza console di amministrazione,
  con o senza RAG, con o senza `@volcanicminds/tools`. T-10.14 ha aggiunto rotte che esistono solo
  in alcune di quelle forme (`/system/*` con i tenant, i due manifest con la console accesa), quindi
  la matrice andava riprovata e non dedotta.
  **Evidenza del 16 settembre 2026**:
  - `npm test` con Postgres reale: **532 prove, 2 saltate**; `npm run test:e2e:mt:pg`: **8 su 8**. Il
    banco nero è multi-tenant e **non monta il manifest** (`manifest` non compare in
    `test/e2e-mt-pg/`), quindi è anche la prova del multi-tenant senza console e senza RAG.
  - sample con `SAMPLE_MANIFEST=off`, avviato nelle due forme. Single: `/health` 200, mentre
    `/admin/manifest`, `/system/manifest` e `/system/auth/me` rispondono 404 e `/partners` 401, cioè
    le rotte dell'applicazione ci sono e la superficie della console no. Multi: stessi 404 sui due
    manifest, `/system/auth/me` 401 (il gruppo di sistema c'è, manca la sessione) e `/partners` 400
    `TENANT_REQUIRED`.
  - con la console accesa le due forme erano già provate lo stesso giorno: single con
    `/admin/manifest` 200, multi con i due manifest per piano (T-10.14).
  - backend più RAG senza console: le 62 prove di integrazione di `volcanic-rag-sample`.
  - `@volcanicminds/tools` non è una dipendenza del backend: nessun import in `lib`, `index.ts` e
    `db.ts`, e niente in `package.json`. Lo usa il sample per la demo di ricerca semantica, e
    toglierlo non tocca il framework.
  **Interruttori**: `SAMPLE_TENANTS=header` e `SAMPLE_MANIFEST=off` nel sample, indipendenti fra
  loro e documentati nel suo README, così ognuna delle quattro forme riparte con un comando.

- [x] **T-10.27** La copertura misurava un numero falso, e nessuno la eseguiva. · **M**
  **Oggi**: `npm run coverage` falliva da sola (66,58% di righe contro un pavimento di 70) e in
  `.github/workflows/ci.yml` non esisteva un passo che la lanciasse, quindi il rosso non lo vedeva
  nessuno. Un cancello che nessuno esegue non è un cancello, e uno tarato su una misura sbagliata
  è peggio: chiede di scrivere test per un buco che non c'è.
  **Le tre cose che non andavano**, trovate il 16 settembre 2026:
  1. **Lo stesso modulo viene compilato due volte**, una come CommonJS e una come ESM, e i due
     script portano lo stesso url. istanbul, davanti a due coperture dello stesso file con
     struttura diversa, non le somma: tiene l'ultima. Prova: nel dump grezzo V8 `generator.ts`
     compare con due `scriptId`, uno con 32 funzioni e 170 range coperti e uno con 13 funzioni e 2,
     e una sonda a livello di modulo stampa due valutazioni, una da `Module._compile` e una da
     `ModuleJob.run`. Effetto: **94,98% da solo con il suo spec e 42,58% nella suite intera**,
     stesso codice e stessi test. `--merge-async` non cambia niente.
  2. **c8 conta ogni riga fisica del sorgente**: per quel file 479, cioè la sua lunghezza,
     commenti e dichiarazioni di tipo comprese. Monocart conta le righe **eseguibili**: 111.
  3. **`--check-coverage` di c8 sotto monocart applica un numero che non stampa**: nello stesso
     run il report dice 85,06% di righe e il cancello ne pretende 81,77%, che è 1435/1755, cioè
     righe coperte diviso *statement* coperti.
  **Cosa**: `.c8rc.json` passa al backend monocart (`experimental-monocart`, con
  `exclude-after-remap` perché il filtro dei sorgenti rimappati altrimenti non si applica), le
  soglie sono ritarate sui numeri veri, il pavimento lo applica `scripts/check-coverage.mjs`
  leggendo lo stesso `coverage/coverage-summary.json` che il report stampa, e il job `test` della
  CI esegue `npm run coverage` conservando `lcov.info` come artefatto.
  **Evidenza del 16 settembre 2026**: 518 prove verdi e 30 saltate senza `DATABASE_URL`;
  **85,15% statements, 85,06% lines, 91,49% branches, 83,23% functions** su 84 file, con la somma
  per file uguale al totale dichiarato. Soglie a **82/82/88/80**, appena sotto: il cancello passa
  con le soglie vere e fallisce nominando la metrica se le si alza a 99.
  **Trovato facendolo**: `lib/loader/router.ts` importava gli handler con un percorso nudo invece
  che con un URL `file://`, cioè due chiavi di modulo per lo stesso file (e la forma che Windows
  rifiuta). Corretto, 518 verdi. Non è la causa del doppio caricamento, che resta e che monocart
  assorbe.
  **Punto cieco dichiarato**: tre file non hanno righe eseguibili misurate perché nessuno spec
  arriva a caricarli (`lib/api/admin/controller/manifest.ts`, `lib/api/system/controller/systemManifest.ts`,
  `lib/api/health/controller/health.ts`): sono handler di rotta che solo una chiamata HTTP carica.
  Sotto c8 contavano come zero e abbassavano il totale, sotto monocart non contano affatto. La via
  d'uscita non è una soglia, sono prove che chiamano quelle rotte.
  **Punto cieco chiuso il 16 settembre 2026**: `test/lib/routeControllers.spec.ts`, 6 prove che
  montano i tre handler veri su un'istanza Fastify e li chiamano per HTTP. Non provano
  `buildManifest`, che T-9.5 copre già: provano il **cablaggio**, cioè che ogni handler chiede il
  piano della rotta su cui sta (`/admin/manifest` quello dei tenant, `/system/manifest` quello di
  controllo) e legge gli schemi dall'istanza che serve quella richiesta. Uno che servisse il
  manifest dell'altro piano non solleverebbe niente: consegnerebbe alla console di un cliente la
  mappa delle rotte della piattaforma. Coperti anche il manifest intero quando i tenant non ci
  sono, e il ripiego su `global.server` quando la richiesta non porta un'istanza.

- [x] **T-10.19** La politica MFA è una sola per deployment, e sul piano di controllo non vale. · **M**
  **Oggi**: `MFA_POLICY` (`OPTIONAL`, `MANDATORY`, `ONE_WAY`) vale per tutto il deployment e la
  leggono solo le rotte dei tenant (`lib/api/auth/controller/auth.ts`). Il login di sistema guarda
  solo se l'operatore ha il fattore acceso, quindi `MANDATORY` non obbliga nessun operatore. Non
  esiste una disattivazione di sistema e `POST /system/users/:id/mfa/reset` è scritta in
  `docs/API_V5.md` §5 ma **la rotta non esiste**: chi perde il telefono rientra solo dal database.
  **Decisione del 16 settembre 2026**: la politica si differenzia su tre livelli, deployment, piano
  di controllo e singolo tenant, e per il tenant vive nel `config` della sua riga di registro, che
  la risoluzione carica già a ogni richiesta, quindi senza letture in più. Valori dal più debole al
  più forte: `OFF`, `OPTIONAL`, `ONE_WAY`, `MANDATORY`.
  **Confermato il 16 settembre 2026**: il valore del deployment è un **pavimento** e un tenant può
  solo stringere, mai allentare; una scrittura che allenta viene rifiutata con un codice suo e non
  ignorata in silenzio. `OFF` impedisce le attivazioni nuove ma **continua a chiedere il fattore a
  chi ce l'ha già**, che se ne libera solo con un reset: girare un interruttore non deve abbassare
  di colpo la protezione di account che erano protetti.
  **Cosa**: politica effettiva risolta per piano e per tenant, applicata anche al login di sistema;
  `POST /system/users/:id/mfa/reset` a chi ha `system-users`; la politica effettiva restituita da
  `/users/me` e `/system/auth/me`, perché è da lì che la console decide cosa mostrare, e una console
  che offre una disattivazione che il server rifiuta è di nuovo configurazione che mente.
  **Chiuso quando**: un tenant più stretto del deployment funziona e uno più largo viene rifiutato;
  con `MANDATORY` sul piano di controllo un operatore senza secondo fattore non entra; un reset
  rimette in gioco chi ha perso il telefono; e un operatore che impersona dentro un tenant non si
  vede chiedere un secondo codice.
  **Evidenza**: la politica effettiva si risolve in `lib/util/mfaPolicy.ts`, che tiene il pavimento
  (`floorPolicy`), i due livelli sopra (`controlPolicy`, `tenantPolicy`, che prendono sempre il più
  stretto fra sé e il pavimento) e i due verdetti di scrittura. È cablata nel login dei tenant,
  nell'arruolamento, nella disattivazione, in `/users/me`, nel login di sistema, in
  `/system/auth/me`, nell'arruolamento di sistema e nella creazione e modifica di un tenant. Il
  valore del tenant vive nel `config` della sua riga, che la risoluzione carica già. Rotta nuova
  `POST /system/users/:id/mfa/reset` (capability `system-users`), che `docs/API_V5.md` prometteva e
  non esisteva. Codici nuovi: `MFA_POLICY_WEAKER`, `MFA_POLICY_INVALID`, `MFA_DISABLED`,
  `MFA_NOT_AVAILABLE`. Al boot il log dice i due piani («enforced to OPTIONAL, control plane
  MANDATORY») e un valore che non è una politica ferma l'avvio.
  **Trovato facendolo, e chiuso qui**: `MANDATORY` senza un gestore MFA iniettato è una porta
  chiusa senza chiave. Il login rispondeva «prima arruolati» e l'arruolamento rispondeva 500, quindi
  nessuno entrava più; sul piano dei tenant la trappola c'era già, e allargando la politica agli
  operatori l'avrei estesa a loro. Ora l'avvio rifiuta, un tenant che chiede `MANDATORY` su una
  build senza gestore riceve `MFA_NOT_AVAILABLE`, e un tentativo di arruolamento risponde 503 con lo
  stesso codice invece del 500 del Null Object.
  **Prove**: 14 in `test/lib/mfaPolicy.spec.ts` (i tre livelli, il pavimento che non si abbassa, i
  due rifiuti di scrittura, `OFF` che chiude solo gli arruolamenti, l'avvio che si ferma) e 2 in
  `test/lib/systemScope.spec.ts` (con `MANDATORY` il primo fattore non compra una sessione, e senza
  la politica il login torna 200 dicendo quale politica vale). `test:lib` 377 verdi, `check-all`
  pulito.
  **Verifica del 16 settembre 2026** contro il sample multi-tenant, due avvii. Politiche di default,
  7 PASS su 7: `/system/auth/me` dichiara `OPTIONAL`; un tenant con `OFF` è rifiutato
  `400 MFA_POLICY_WEAKER`; con un valore inventato `400 MFA_POLICY_INVALID`; con `MANDATORY`
  `503 MFA_NOT_AVAILABLE`, perché quel sample non inietta nessun gestore; con `ONE_WAY` il tenant si
  crea; il reset di un operatore risponde 200 e su un id inesistente 404. Secondo avvio con
  `SYSTEM_MFA_POLICY=MANDATORY`: il processo si ferma da solo con «SYSTEM_MFA_POLICY=MANDATORY
  demands a second factor and this build has no MFA manager».
  **Non provato end to end**: il ramo del login di un tenant con politica `MANDATORY`, perché in
  quel sample `MANDATORY` è rifiutato per mancanza del gestore. Lo copre la prova equivalente sul
  piano di controllo, che passa per lo stesso codice. L'impersonificazione non chiede un secondo
  codice perché non passa dal login, ed è una proprietà del disegno, non una prova che ho scritto.
  **Documentazione**: `docs/MIGRATION_V4_V5.md` §26, `docs/CONFIGURATION_V5.md` §4 e §5, la tabella
  dell'ambiente del README con `SYSTEM_MFA_POLICY`.

- [x] **T-10.20** `/system/users` non è una risorsa nel manifest, quindi la console non gestisce gli operatori. · **M**
  **Dove**: `lib/manifest/generator.ts` raggruppa le rotte sul primo segmento del percorso, e per
  `/system/users` quel segmento è `system`: il gruppo non prende la forma di un CRUD e finisce fra
  le capability sciolte.
  **Cosa**: dare a una rotta il modo di dichiarare il prefisso della propria risorsa, come già fa
  con `manifest.resource.name`, e raggruppare su quello. È grammatica del manifest, come T-10.16.
  **Chiuso quando**: la console di piattaforma elenca, crea, blocca e sblocca gli operatori, e il
  manifest di controllo descrive quella risorsa.
  **Fatto il 16 settembre 2026**: `ResourceHints.prefix`, onorato solo se il percorso comincia
  davvero per quel prefisso, perché è il router a servire l'URL e un suggerimento che lo
  contraddicesse archivierebbe la rotta sotto una risorsa che nessuno può chiamare. Il
  raggruppamento e **tutto ciò che legge un percorso** contano ora dalla fine del prefisso e non
  dal primo segmento: `depth` attraversa le capability e `collectFields`, che aveva lo stesso
  `slice(1)` in una seconda copia. Quel secondo punto non era cosmetico: senza, la risorsa
  esisteva con le sue cinque capability e **zero campi**, cioè una form vuota invece di un errore.
  Le rotte di `/system/users` dichiarano il prefisso una volta sola (una costante locale, perché
  lo stesso file serve anche il login e il manifest, che risorsa non sono) e portano finalmente
  uno schema: `lib/schemas/systemUser.ts`, diviso nelle due direzioni. La superficie di scrittura
  è **più stretta di prima**: il manager scrive sulla riga il corpo così come arriva, quindi
  `additionalProperties: false` con `email`, `password` e `roles` è il confine, e `blocked` non
  c'è perché il blocco passa da `/block` e `/unblock`, che registrano la ragione.
  **Prove**: 4 in `test/lib/manifest.spec.ts` sulla grammatica e 5 in
  `test/lib/manifestRealRoutes.spec.ts`, che passano i **file di rotta veri** dal loader e
  chiedono al manifest quello che una console riceverebbe: un suggerimento che non arriva fino in
  fondo è una dichiarazione che nessuno legge.
  **Verificato a runtime il 16 settembre 2026**, console di piattaforma guidata con Playwright
  (`VITE_ADMIN_PLANE=control`). Il manifest di quel banco non è scritto a mano: è **dumpato dalle
  rotte vere** passando dal loader e dal generatore, quindi a schermo finisce ciò che il framework
  emette e non l'idea che me ne ero fatto. L'atterraggio è su `/system/users`, cioè il percorso a
  due segmenti attraversa il routing; la sidebar mostra la risorsa; la lista rende i tre
  operatori; «New» apre la form con **email, roles e password modificabili e tutto il resto
  disabilitato**, che è la superficie di scrittura ristretta vista da fuori; il blocco apre il
  dialogo generico con il campo del motivo, scrive motivo e data, e lo sblocco li azzera. Nessun
  errore di console in nessun passaggio. Il banco sta in `volcanic-admin`:
  `src/mock/controlManifest.ts` (generato), le righe di seed per operatori e registro,
  `mockDataProvider.custom()` esteso alle azioni di controllo, un client di auth che porta ruoli
  `system:` (con quelli di un tenant la console sarebbe vuota, ed è l'access control che fa il suo
  mestiere) e `App.tsx` che monta il piano di controllo.
  **Trovato facendolo, e chiuso lo stesso giorno**: la tabella mostrava una colonna `password`
  piena di trattini. Era un buco della grammatica, non della console: `collectFields` sapeva dire
  `readOnly` e non il suo opposto, quindi un campo scritto e mai letto non aveva modo di
  dichiararsi. Ora il generatore emette **`writeOnly`** quando un campo compare in un corpo e in
  nessuna risposta, e i due flag non sono l'uno la negazione dell'altro: un campo che viaggia in
  entrambe le direzioni non ne porta nessuno. Il lato console **era già pronto e aspettava**:
  `buildColumns` filtrava già `!f.writeOnly` e `isBulkEditable` lo escludeva già da export e
  import, cioè il contratto esisteva da un lato solo e mancava chi lo dicesse. Allineato anche
  `manifest.v2.schema.json`, che di quel contratto è la copia canonica. Riprovato a schermo: la
  colonna sparisce dalla lista e il campo **resta** nella form di creazione, che è la controprova
  speculare, quella che distingue una correzione da una rimozione. 2 asserzioni nuove in
  `test/lib/manifest.spec.ts`.
  **Resta, ed è presentazione**: `roles` non compare come colonna perché arriva tipizzato `json`.
  Si sistema negli overrides della console, non qui.
  **Fatto il 18 settembre 2026, contro un backend vivo** (sample multi-tenant su Postgres reale,
  `SAMPLE_TENANTS=header`, `AUTH_MODE=BEARER`, console di controllo in sviluppo). La prova ha
  trovato due difetti che il mock non poteva mostrare, ed è la ragione per cui la voce era rimasta
  aperta.
  **Difetto 1, nel framework**: sul piano di controllo il contatore anti-replay del secondo fattore
  salvava il **delta** restituito dal verificatore invece del passo assoluto. Il delta di un codice
  digitato nella propria finestra è zero, quindi la prima verifica scriveva `0` e ogni codice
  successivo, anch'esso zero, cadeva in `counter <= last`: un operatore che abilitava MFA non
  riusciva più ad autenticarsi, mai. Il piano tenant convertiva il delta in casa propria ed era
  corretto, ed è il modo tipico in cui due copie della stessa regola divergono. La conversione ora
  vive in un solo posto (`lib/util/mfaCounter.ts`) e la usano entrambi i piani; prove in
  `test/lib/mfaCounter.spec.ts`. Evidenza del difetto sul database vivo: `mfa_last_used_counter = 0`
  per il fondatore dopo l'abilitazione.
  **Difetto 2, nella console** (`volcanic-admin`): il provider conservava i token solo se credeva
  di essere in modalità bearer, ma la modalità arriva dal manifest e sul piano di controllo
  `/system/manifest` richiede la sessione che si sta cercando di aprire. Al primo accesso la
  console resta quindi sul default `cookie`, buttava via il token appena emesso e rispediva
  l'operatore al login senza un errore da leggere. Ora la decisione si prende sulla **risposta**:
  un token nel corpo lo manda solo un deployment bearer, perché in modalità cookie il backend
  risponde `null`, e la console adotta quella modalità per le richieste successive.
  **Resta**: la lista operatori e il flusso di distruzione riprovati a schermo fino in fondo.

- [x] **T-10.21** La distruzione in due fasi non ha un flusso nella console. · **M**
  **Oggi**: `POST /tenants/:id/destruction-request` e `DELETE /tenants/:id/data` non hanno schema del
  corpo, quindi con la grammatica di T-10.16 restano pulsanti senza dialogo.
  **Perché non basta un dialogo**: sono due chiamate legate, il token si mostra una volta sola, il
  corpo della seconda vuole token, slug ribattuto a mano e secondo fattore, e la fase 1 restituisce
  il conteggio esatto di ciò che sparirebbe, che è la cosa da leggere prima di decidere.
  **Cosa**: un flusso guidato nell'admin, con lo schema del corpo della fase 2 e un componente
  registrato al posto del dialogo generico.
  **Chiuso quando**: si distrugge un contenitore dalla console avendo letto i conteggi, e il token
  non compare né in un URL né in un log.
  **Fatto il 16 settembre 2026, lato framework**: `tenantDestroyBodySchema` (token, slug, otp) su
  `DELETE /tenants/:id/data`, **senza `required`**, perché i tre campi li rifiuta il controller con
  codici che un client sa leggere (`DESTRUCTION_TOKEN_INVALID`, `DESTRUCTION_SLUG_MISMATCH`,
  `DESTRUCTION_OTP_INVALID`) e un `required` di schema risponderebbe prima con un
  `FST_ERR_VALIDATION` generico: l'unica risposta che una console non sa spiegare a chi ha in mano
  un permesso che scade. Che cosa chiedere lo dice `config.manifest.input`, la grammatica di
  T-10.16. Provato in `test/lib/manifestRealRoutes.spec.ts` sul file di rotta vero, insieme al
  fatto che fase 1 ed export restano **senza** input, perché leggono solo l'id dall'URL.
  **Fatto il 16 settembre 2026, lato console**: il dialogo generico non poteva bastare, e il
  motore ora ha dove metterlo. Un componente azione registrato di serie (`tenant-destroy` in
  `volcanic-admin`, `src/ui/actions/TenantDestroy.tsx`, seminato come i widget di default): il
  primo passo chiama la fase 1 **su richiesta esplicita** e mostra i conteggi, il secondo si apre
  solo con lo slug ribattuto uguale e un codice, e il permesso vive nello stato del componente,
  mai in un URL. Chiudere il dialogo lo cancella. Perché il componente potesse esistere sono
  cambiate due cose nel motore: le azioni custom ricevono anche il `model` della propria risorsa
  (senza, un'azione che chiama l'API da sé non sa che cosa invalidare né raggiungere le azioni
  sorelle) e il `run` iniettato porta anche il corpo. Il puntatore al componente sta negli
  overrides built-in del piano di controllo, non nel manifest: nominare un componente è
  presentazione, e il backend descrive solo le chiamate (`be-data-only`). Un progetto può
  ripuntarlo, perché i suoi overrides sono fusi sopra.
  **Verificato a runtime il 16 settembre 2026**, stessa console, contenitore `beta-trial`. Il
  pulsante apre il componente e non il dialogo generico: passo 1 senza campi, con l'avvertenza che
  l'export precede la distruzione; la verifica chiama la fase 1 e il passo 2 mostra i conteggi
  (`user` 42, `token` 7, `vehicle` 128, `tracking` 3910), l'avviso che il permesso si vede una
  volta sola, la scadenza e l'avvertenza del backend sui backup presi prima. Con lo slug ribattuto
  **sbagliato** il pulsante di conferma resta disabilitato; con quello giusto e un codice la
  seconda chiamata parte, la riga sparisce dall'elenco e il dialogo si chiude azzerando il
  permesso. Il token non è mai passato per un URL: entrambe le fasi lo portano nel corpo.
  **Fatto il 18 settembre 2026, contro un backend vivo**: contenitore `beta-trial` distrutto dalla
  console di controllo, su Postgres reale. Il passo 1 ha mostrato i conteggi veri del contenitore
  (`user` 1, `migration` 3, e fra le tabelle anche `session`, quella della fase 11), la scadenza
  del permesso e l'avvertenza sui backup; con lo slug ribattuto e il secondo fattore il passo 2 ha
  esportato **prima** (`data/exports/beta-trial-0001_sessions_tenant-...sql`) e poi distrutto.
  Verità dal database, non dallo schermo: lo schema `tenant_beta_trial` non esiste più, la riga del
  registro è `archived` e cancellata, e nella lista resta solo `acme-live`.
  **Difetto trovato qui, la terza copia della stessa regola**: `verifySecondFactor`
  (`lib/api/tenants/controller/tenants.ts`) confrontava il **delta** del verificatore con il passo
  assoluto ormai salvato correttamente, quindi rifiutava ogni codice valido con «That code has
  already been used»: un operatore con secondo fattore non avrebbe potuto distruggere nulla, e il
  messaggio diceva l'opposto di quel che accadeva. Corretta a usare `lib/util/mfaCounter.ts` come
  gli altri due piani, e solo dopo la distruzione è andata a buon fine.
  **Nota**: l'export **non** ha un input. Il suo controller legge solo l'id dall'URL, quindi per
  quell'azione non c'è niente da chiedere e uno schema del corpo sarebbe una promessa vuota.

---

## Non in questa fase

- [-] **Ripubblicare l'alpha su npm e fare il push di `develop`**: sono già segnate come lavoro
  che resta in `EVO_STATO.md` e richiedono una richiesta esplicita, non una checklist.
- [-] **I 67 warning `no-explicit-any` del framework**: sono rumore noto e non un difetto; vanno
  affrontati per file quando quel file si tocca, non in un passaggio unico che tocca tutto.
- [-] **Gli `export` inutili di `volcanic-admin`** (`countActiveFilters`, `buildRecordTitle`,
  `SINGLETON_ID`, `RICHTEXT_ACTIONS`, `ROW_REM`, `DEFAULT_MAX_ROWS`, `VIEWPORT_CAP`,
  `ListUiState`, `ListStateApi`): sono simboli usati solo nel proprio file, quindi superficie in
  più e non peso morto. L'unica funzione davvero mai chiamata è `hasIcon`
  (`src/ui/layout/icons.tsx:39`), che si chiude dentro T-10.11 se si tocca quel layer.
- [-] **Il warning `react-hooks/exhaustive-deps`** a `src/ui/generators/ListView.tsx:100`: la
  dipendenza mancante è `setPage`, stabile, quindi è una decisione di stile e non un difetto.
