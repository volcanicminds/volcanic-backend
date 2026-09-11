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
| C. Allineamento di `volcanic-admin` alla v5 | l'admin contro un backend v5 reale, e la sessione in cookie httpOnly di default | 3-4 giornate, più il progetto di T-10.16 e la decisione di T-10.37 |
| D. Sample committabile | **chiuso l'11 settembre 2026** tranne il commit (T-10.28, su richiesta) | fatto |
| ~~E. Igiene del framework~~ | **chiuso l'11 settembre 2026** | fatto |

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

- [ ] **T-10.11** Il `basePath` di default non corrisponde a nessun deployment v5.
  **Dove**: `src/engine/providers/data.ts:35` usa `/admin`; la v5 monta sotto `/admin`
  soltanto `/admin/manifest` (`lib/api/admin/routes.ts:16`, confermato da `docs/API_V5.md:18`),
  mentre le rotte reali stanno su `/<path della risorsa>` e il manifest le pubblica così
  (`lib/manifest/generator.ts:247`).
  **Effetto oggi**: con il default ogni chiamata CRUD va in 404, serve sempre `apiBasePath: ''`.
  **Chiuso quando**: il default è `''`, oppure il data provider costruisce l'URL dal `path`
  che la capability già porta con sé (`generator.ts:209`, `:220`), e `docs/CONSUMING.md` lo dice.

- [ ] **T-10.12** Le due fetch fuori dal data provider non si autenticano.
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

- [ ] **T-10.13** `manifest.auth.endpoints` è emesso dal backend e non lo legge nessuno.
  **Dove**: il backend lo produce (`lib/manifest/generator.ts:265`), l'admin lo tipizza
  (`src/engine/types/manifest.ts`), ma `src/VolcanicAdmin.tsx:199` costruisce il client senza
  passarlo e `VolcanicAdminProps` non espone un modo per farlo: valgono i default hardcoded di
  `src/engine/auth/client.ts:59-68`. Del blocco `auth` si usa solo `mode` (`:196`).
  **Chiuso quando**: `createVolcanicAuthClient` riceve `manifest.auth.endpoints`, con le props
  dirette che vincono sulle chiavi in collisione, come già fa il resto della composizione.

- [ ] **T-10.14** Non esiste login sul piano di sistema, quindi la gestione della piattaforma è
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

- [ ] **T-10.15** Il login non invia l'header di contesto.
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

- [ ] **T-10.16** Le azioni non-CRUD arrivano al client senza descrizione dell'input.
  **Dove**: `lib/manifest/generator.ts:215-224` emette `name`, `kind`, `method`, `path`,
  `roles`, `label`, `target` e nient'altro; `ActionInput` e `ActionInputField` esistono nei tipi
  dell'admin e non vengono mai popolati.
  **Effetto oggi**: distruzione in due fasi (token monouso, slug ridigitato, secondo fattore),
  export e impersonificazione non hanno modo di raccogliere un payload, quindi restano pulsanti
  che sparano una richiesta vuota.
  **Nota**: questa non è una correzione, è un pezzo di grammatica del manifest da progettare.
  Va aperta come voce a sé e non chiusa insieme alle altre.
  **Chiuso quando**: esiste la specifica in `docs/` e almeno un'azione del registro tenant la usa.

- [ ] **T-10.17** Due copie della stessa unione di tipi che divergono.
  **Dove**: `src/engine/types/manifest.ts` dichiara `FieldType` con `textarea`, che
  `lib/manifest/generator.ts:16-18` non emette mai; `image` e `file` sono nell'unione di
  entrambi ma il generatore non ha logica che li inferisca, e `image.endpoints` (usato da
  `src/ui/generators/AutoForm.tsx:135`, `:161`, `:200`) nasce solo negli override.
  **Chiuso quando**: le due unioni coincidono, oppure è scritto quali membri esistono solo per
  gli override e perché il generatore non può dedurli.

- [ ] **T-10.18** La documentazione dell'admin è ferma alla v4.
  **Dove**: `docs/CONSUMING.md:23` cita «backend ≥ 3.2»; `docs/ARCHITECTURE.md:434` descrive
  l'isolamento via `search_path` e `runInTenantContext`, vocabolario rimosso nella v5.
  **Chiuso quando**: nessun file di `docs/**` nomina `runInTenantContext`, e la versione minima
  del backend è quella vera.

Le tre voci che seguono sono state aggiunte l'11 settembre 2026, su decisione: **di default la
sessione del browser sta in un cookie httpOnly, mai in `localStorage`**, e l'access token torna
breve. Vanno fatte in quest'ordine, perché ciascuna regge la successiva.

- [ ] **T-10.37** Il default di autenticazione è il cookie httpOnly, non `localStorage`.
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

- [ ] **T-10.38** In modalità cookie la sessione ha due durate che non si parlano.
  **Dove**: il cookie ha `maxAge: 86400` scritto a mano (`lib/api/auth/controller/auth.ts:407`,
  uguale in `lib/api/system/controller/systemAuth.ts:71-77`), mentre il JWT che contiene scade
  dopo `JWT_EXPIRES_IN`, oggi 15 giorni. Il browser butta il cookie dopo un giorno, ma chi ne
  copia il valore lo può rigiocare per quindici.
  **Chiuso quando**: la durata del cookie e quella del JWT derivano da un'unica impostazione, e
  un test lo verifica.

- [ ] **T-10.39** Rinnovo automatico, poi access token breve.
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
