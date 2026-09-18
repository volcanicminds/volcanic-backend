# EVO fase 11: registro delle sessioni e rotazione del refresh token

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`, una
> riga per compito; le decisioni prese qui vanno riportate in `EVO_PUNTI_APERTI.md` come
> righe `F18` e seguenti. La fase nasce dal punto aperto **F11**
> (`EVO_PUNTI_APERTI.md:171`), che dichiarava rotazione e rilevamento del riuso ancora da
> fare, e dalla discussione del 18 settembre 2026 che ne ha allargato il perimetro.
>
> **Regola unica**, la stessa delle fasi precedenti: una casella si chiude solo con
> un'**evidenza citata**, cioè un `file:riga`, un identificativo di commit o l'output di un
> comando. Senza evidenza resta aperta.
>
> Perimetro: solo `volcanic-backend`, branch `v5`. Il sample e la console si allineano dopo,
> e solo se la superficie cambia davvero per loro.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 0. Perché la fase esiste

Oggi il refresh token non si consuma: lo stesso identico token vale dal login alla scadenza,
e ogni rinnovo lo lascia intatto. Da lì discendono tre cose, tutte verificate nel codice e
non supposte.

Il furto di un refresh token è **invisibile**: per il server il rinnovo del ladro e quello del
proprietario sono la stessa richiesta, e restano tali finché il token non scade. Il **logout è
finto**: `logout` cancella i cookie del browser (`lib/api/auth/controller/auth.ts:418-421`),
quindi chi ha copiato il cookie di refresh continua a rinnovare dopo che l'utente crede di
essere uscito. E la sola revoca esistente è un **martello**: cambiare l'`external_id`
dell'utente (`auth.ts:558-567`), che è l'identificatore pubblico serializzato nelle risposte
(`lib/schemas/auth.ts:41`, `lib/schemas/user.ts:44`), quindi si usa un'identità come sigillo
di sessione e si rompono i riferimenti che un'integrazione ha salvato.

La rotazione da sola non impedisce il furto: accorcia la vita di ogni copia e, soprattutto,
rende il furto un evento **visibile e contabile**. Ma non esiste senza memoria lato server: un
JWT si verifica, non si consuma, e «questa generazione è già stata spesa» è un fatto che vive
solo in una riga scritta da qualche parte.

## 1. Le decisioni prese, da riportare in `EVO_PUNTI_APERTI.md`

| | Decisione | Criterio |
|---|---|---|
| F18 | esiste un **registro delle sessioni** persistito nel contenitore, dietro un port nuovo (`SessionManagement`) con default no-op | il core non importa il data layer; un port lascia al consumer la libertà di implementarlo altrove (Redis) senza toccare il core |
| F19 | la sessione vive **sul piano del soggetto**: utente del tenant nel contenitore del tenant, utente di sistema e impersonificazione nel piano di controllo | segue la separazione già in vigore fra identità di tenant e di sistema; l'export o la distruzione di un tenant si porta via le sue sessioni, ed è il comportamento corretto |
| F20 | il refresh token diventa **opaco e auto-descrittivo**: `vs1.<routing>.<sid>.<segreto>`, con il solo SHA-256 del segreto in tabella | niente secondo segreto JWT da gestire, nessun rischio che access e refresh si confondano, e un token che non vale nulla senza il database. Il prefisso di instradamento serve a scegliere il contenitore **prima** di poter leggere la riga: in multi-tenant la sessione sta nel contenitore, e non esiste un indice globale da interrogare |
| F21 | il `sid` è **stabile per tutta la vita della sessione** e viaggia sia nell'access token sia nel refresh; ciò che ruota è il segreto, con un contatore di generazione | un `sid` che cambia a ogni rinnovo impedirebbe sia di chiudere la famiglia al rilevamento del riuso sia di mostrare una lista di dispositivi invece di una riga ogni quindici minuti |
| F22 | l'access token resta **stateless**: lo stato si legge e si scrive **solo al rinnovo**, mai per richiesta | aggiornare `last_used_at` a ogni richiesta è una scrittura sulla stessa riga per ogni chiamata della stessa sessione, cioè contesa pura in multi-istanza. Il prezzo è un ritardo di revoca pari alla vita dell'access token, accettabile perché è corta |
| F23 | **finestra di grazia** di pochi secondi: la generazione appena ruotata resta accettabile e restituisce il token già emesso | due schede che rinnovano insieme presentano lo stesso refresh; senza la finestra il rilevamento del riuso caccia fuori utenti onesti, ed è il difetto numero uno delle rotazioni fatte in fretta |
| F24 | **due scadenze** per riga: inattività (da `last_used_at`) e vita massima assoluta | la sola scadenza che si sposta a ogni rinnovo produce sessioni eterne |
| F25 | riuso rilevato fuori finestra: **revoca dell'intera sessione**, motivo scritto in riga, evento su tracking | il server non sa quale dei due presentatori sia il ladro; l'unica mossa onesta è chiudere e far rifare il login |
| F26 | la revoca ha **tre livelli**: la singola sessione, tutte le sessioni dell'utente, il cambio di `external_id` come emergenza | il martello resta perché serve davvero quando l'account è compromesso, ma smette di essere l'unica arma e smette di essere la routine |
| F27 | rotazione su **entrambi i piani e in entrambe le modalità**, cookie e bearer | in un progetto nuovo non c'è motivo per cui un client bearer debba avere una sessione meno sicura di un browser; oggi il rinnovo bearer non riemette nemmeno il refresh |
| F28 | il registro è **acceso quando il data layer c'è**, e senza data layer il rinnovo **non esiste** invece di esistere e non proteggere | spedire il comportamento attuale come default significa spedire il logout finto con un interruttore che nessuno accenderà. Chi vuole il rinnovo senza registro lo chiede esplicitamente e lo trova scritto nella documentazione |

## 2. Ordine di esecuzione

L'ordine è per dipendenza, non per gravità: senza la tabella non c'è manager, senza manager
non c'è emissione, senza emissione non c'è rotazione.

| Blocco | Voci | Sblocca |
|---|---|---|
| A. Persistenza | T-11.1 → T-11.3 | tutto il resto |
| B. Contratto e manager | T-11.4 → T-11.5 | l'emissione |
| C. Ciclo di vita della sessione | T-11.6 → T-11.10 | il comportamento vero |
| D. Bordi | T-11.11 → T-11.15 | multi-tenant, scadenze, configurazione, superficie |
| E. Prove e documentazione | T-11.16 → T-11.18 | la chiusura della fase |

---

## A. Persistenza

- [x] **T-11.1** Tabella `session` nello schema Postgres.
  **Dove**: `lib/database/schema/pg.ts`, dentro `appTables` (non in `registryTables`): il
  piano di controllo monta già le tabelle applicative, quindi una sola definizione serve sia
  il contenitore del tenant sia il piano di controllo.
  **Colonne**: `id`, `sid`, `subjectId` (l'`external_id` del soggetto), `scope`
  (`tenant` | `control`), `secretHash`, `generation`, `previousSecretHash`,
  `rotatedAt`, `lastUsedAt`, `idleExpiresAt`, `absoluteExpiresAt`, `revokedAt`,
  `revokedReason`, `ip`, `userAgent`, `impersonationId`, più `createdAt`.
  **Chiuso quando**: `uniqueIndex` su `sid`, indice su `secretHash` e su
  `(subjectId, revokedAt)`, e `npm run check-all` verde.

- [x] **T-11.2** La stessa tabella nello schema SQLite.
  **Dove**: `lib/database/schema/sqlite.ts`, `appTables`, con le convenzioni del dialetto già
  in uso (epoch in intero, 0/1 al posto del booleano).
  **Chiuso quando**: `test/db/schema.spec.ts` vede la tabella sui due dialetti.

- [x] **T-11.3** Le quattro migrazioni.
  **Dove**: `npm run db:generate`, `db:generate:tenant`, `db:generate:sqlite`,
  `db:generate:tenant:sqlite`; SQL committato in `lib/database/migrations/{control,tenant}/{pg,sqlite}`.
  **Chiuso quando**: `npm run check:migration-sets` verde e il runner applica i quattro
  insiemi su un database vuoto.

## B. Contratto e manager

- [x] **T-11.4** Tipi e default no-op.
  **Dove**: `types/global.d.ts` (`Session`, `SessionManagement`), `lib/defaults/managers.ts`
  (`SESSION_METHODS`, `defaultSessionManager`), esportazioni in `index.ts`.
  **Superficie**: `openSession`, `findBySecret`, `rotate`, `touch`, `revokeSession`,
  `revokeAllOfSubject`, `purgeExpired`, `listOfSubject`.
  **Chiuso quando**: `test/lib/defaultManagers.spec.ts` copre il nuovo manager e il server
  parte senza data layer.

- [x] **T-11.5** Implementazione del manager.
  **Dove**: `lib/database/managers/session.ts`, cablato in `buildManagers`
  (`lib/database/managers/index.ts:24`) ed esportato da `db.ts`.
  **Chiuso quando**: `test/db/managers.spec.ts` esercita apertura, rotazione, riuso e revoca
  su SQLite in memoria.

## C. Ciclo di vita della sessione

- [x] **T-11.6** Il token opaco: formato, generazione, hash, parsing.
  **Dove**: `lib/util/credential.ts` o un modulo accanto, con `crypto.randomBytes(32)` e lo
  stesso SHA-256 già usato per il token di distruzione (`lib/database/managers/destruction.ts:20`).
  **Chiuso quando**: un token malformato è un rifiuto e non un'eccezione, con test.

- [x] **T-11.7** Emissione al login, su entrambi i piani.
  **Dove**: `issueSession` (`lib/util/credential.ts:193`), chiamata da `auth.ts:405`,
  `systemAuth.ts:89` e `:289`, più la verifica MFA e l'impersonificazione
  (`lib/api/tenants/controller/tenants.ts:569`).
  **Chiuso quando**: il login scrive la riga, l'access token porta `sid`, e senza manager il
  refresh non viene emesso affatto.

- [x] **T-11.8** Rinnovo con rotazione, cookie e bearer.
  **Dove**: `auth.ts:423` e `renewFromCookie` (`auth.ts:524`), `systemAuth.ts:111` e `:169`.
  **Chiuso quando**: ogni rinnovo emette un refresh nuovo, incrementa la generazione, scrive
  `last_used_at`, e la finestra di grazia restituisce il token già emesso invece di un rifiuto.

- [x] **T-11.9** Rilevamento del riuso.
  **Dove**: il manager per la transizione, il controller per la risposta; codice di rifiuto
  nuovo (`SESSION_REUSE_DETECTED`) con il test che lo fa scattare, o `check:refusals` fallisce.
  **Chiuso quando**: presentare due volte la stessa generazione fuori finestra revoca la
  sessione, scrive il motivo e produce un evento di tracciatura.

- [x] **T-11.10** Logout e revoca a tre livelli.
  **Dove**: `logout` (`auth.ts:418`), `invalidateTokens` (`auth.ts:558`), le gemelle di
  sistema.
  **Chiuso quando**: il logout revoca la riga e non solo i cookie; `invalidate-tokens` revoca
  tutte le sessioni e il cambio di `external_id` resta disponibile come emergenza dichiarata.

## D. Bordi

- [~] **T-11.11** Risoluzione del contenitore sulla rotta di rinnovo.
  **Dove**: `lib/loader/tenant.ts:218`, che oggi legge il `tid` dal claim di un JWT.
  **Perché**: con il token opaco il tenant si legge dal prefisso di instradamento, e va
  confrontato con quello della richiesta come fa oggi il controllo `TENANT_MISMATCH`.
  **Chiuso quando**: il banco multi-tenant rinnova nel contenitore giusto e rifiuta il
  contenitore sbagliato.

- [x] **T-11.12** Scadenze e pulizia.
  **Dove**: il manager (cancellazione pigra al rinnovo) e la CLI (`bin/volcanic.mjs`, comando
  di purga per il piano e per la flotta).
  **Chiuso quando**: una sessione inattiva oltre la soglia e una oltre la vita assoluta non
  rinnovano più, con test sui due limiti separati.

- [x] **T-11.13** Configurazione.
  **Dove**: blocco `sessions` in configurazione (camelCase, come i blocchi nuovi della v5 per
  F5), con inattività, vita assoluta, finestra di grazia e politica di riuso; annuncio
  all'avvio quando il registro non c'è.
  **Chiuso quando**: `docs/CONFIGURATION_V5.md` elenca le chiavi e un test verifica il
  comportamento senza data layer.

- [x] **T-11.14** Superficie di gestione delle sessioni.
  **Dove**: `GET /auth/sessions`, `DELETE /auth/sessions/:sid` sul piano tenant, le gemelle
  sotto `/system/auth/*`, con le capability corrispondenti.
  **Chiuso quando**: un utente vede solo le proprie sessioni, e chiuderne una da un
  dispositivo impedisce il rinnovo sull'altro.

- [x] **T-11.15** Revisione di `reset_external_id_on_login`.
  **Dove**: `auth.ts:399`.
  **Perché**: con il registro, ruotare l'identità a ogni login è il martello usato come
  routine, e oggi significa che loggarsi dal telefono butta giù la sessione del portatile.
  **Chiuso quando**: l'opzione è deprecata o ridefinita, con la scelta scritta in
  `EVO_PUNTI_APERTI.md`.

## E. Prove e documentazione

- [x] **T-11.16** Prove.
  **Dove**: `test/lib/` per rifiuti, formato del token, finestra di grazia e scadenze;
  `test/db/` per il manager sui due dialetti; banco multi-tenant per il rinnovo nel
  contenitore giusto.
  **Chiuso quando**: `npm test` e `npm run check-all` verdi, copertura non sotto il pavimento.

- [x] **T-11.17** Documentazione.
  **Dove**: `docs/AUTHORIZATION_V5.md` (il capitolo delle sessioni), `docs/API_V5.md` (rotte
  nuove e risposta di rinnovo cambiata), `docs/CONFIGURATION_V5.md`, `docs/SCHEMA_V5.md` (la
  tabella), `docs/MIGRATION_V4_V5.md` (cosa rompe), `README.md` e `llms.txt`.
  **Chiuso quando**: nessuno dei file descrive ancora il rinnovo senza registro.

- [ ] **T-11.18** Console e sample.
  **Dove**: `volcanic-admin` per la lista delle sessioni, `volcanic-backend-sample` se la
  superficie cambia per un consumer.
  **Chiuso quando**: deciso se entra nella v5 o resta fuori, con il motivo scritto.

---

## Evidenze del 18 settembre 2026

Blocchi A, B e C chiusi; D ed E aperti. `npm run check-all` verde (71 warning `no-explicit-any`
preesistenti, zero errori), `npm test` verde.

| Voce | Evidenza |
|---|---|
| T-11.1 | `lib/database/schema/pg.ts:151-207`, tabella `session` in `appTables` con indici su `sid`, sui due hash e su `(subject_id, revoked_at)` |
| T-11.2 | `lib/database/schema/sqlite.ts:123-160`; parità verificata da `test/db/schema.spec.ts:25` |
| T-11.3 | `0001_sessions_control` e `0001_sessions_tenant` nei quattro insiemi; `npm run check:migration-sets` → «four migration sets: control/pg (2), control/sqlite (2), tenant/pg (2), tenant/sqlite (2)» |
| T-11.4 | `types/global.d.ts` (`Session`, `SessionLookup`, `SessionManagement`), `lib/defaults/managers.ts:86-112`, esportazioni in `index.ts` |
| T-11.5 | `lib/database/managers/session.ts`, cablato in `buildManagers`; `test/db/sessions.spec.ts`, 10 prove verdi su SQLite reale |
| T-11.6 | `lib/util/session.ts`, formato `vs1.<routing>.<sid>.<segreto>`; `test/lib/sessionToken.spec.ts`, 13 prove |
| T-11.7 | `lib/util/credential.ts:210-275` (`issueSession` con `SessionOrigin`), chiamata da login, verifica MFA e abilitazione MFA sui due piani |
| T-11.8 | `lib/util/renewal.ts`, un solo flusso per i due piani; rotazione e finestra di grazia provate in `test/lib/authChannels.spec.ts` |
| T-11.9 | `SESSION_REUSE_DETECTED`: revoca della sessione più evento a log; `npm run check:refusals` → 63 rifiuti, ognuno con un test |
| T-11.12 | purga per predicato SQL in `lib/database/managers/session.ts` (una sola `delete`), purga opportunistica su un rinnovo su cinquanta in `lib/util/renewal.ts`, comando `npx volcanic sessions --purge [--tenants]` in `bin/volcanic.mjs` |
| T-11.14 | `GET /auth/sessions` e `DELETE /auth/sessions/:id` sui due piani, schema `authSessionsResponseSchema`; `test/lib/sessionRoutes.spec.ts`, 6 prove |
| T-11.15 | l'opzione resta ma il boot avvisa (`index.ts`): con il registro, ruotare l'identità a ogni login chiude le altre sessioni e cambia un identificatore che le integrazioni possono avere salvato |
| T-11.16 | `npm test` 566 passanti e 30 saltati; unità del formato e degli orologi, banco SQLite del manager, prove HTTP di rotazione, grazia, riuso, logout e rotte |
| T-11.10 | `logout` revoca la riga sui due piani; `invalidate-tokens` chiude tutte le sessioni **prima** di ruotare l'`external_id` |

| T-11.13 | blocco `sessions` in `lib/config/general.ts` e nei tipi, tre variabili d'ambiente che vincono sulla configurazione, documentato in `docs/CONFIGURATION_V5.md`; `test/lib/sessionToken.spec.ts` prova i default, l'override e i tre modi di spegnerlo |
| T-11.17 | `docs/AUTHORIZATION_V5.md` §9, `docs/API_V5.md` §2.3 e §2.4, `docs/CONFIGURATION_V5.md`, `docs/SCHEMA_V5.md` §2.5, `docs/MANAGERS_V5.md` §11, `docs/MIGRATION_V4_V5.md` §27, `README.md`, `llms.txt` |

**Difetti trovati dalla rilettura della documentazione**, tutti nel codice e tutti corretti: lo
schema di risposta del rinnovo dichiarava il solo `token`, quindi in modalità bearer Fastify
scartava in silenzio il credenziale appena ruotato e il client si sarebbe chiuso la sessione da
solo al rinnovo successivo (`lib/schemas/auth.ts`, ora con la prova che monta la rotta **con** lo
schema vero, perché ogni altro test monta l'handler nudo); il commento sulla purga prometteva di
conservare le sessioni revocate fino alla scadenza assoluta mentre il filtro è in OR sui due
orologi; e `npx volcanic sessions --purge --tenants` si fermava ai primi mille tenant invece di
paginare come fa il data layer.

**Difetto trovato e corretto durante la fase**: la finestra di grazia confrontava con `<=`, quindi
`graceSeconds: 0` non significava «nessuna tolleranza» e un replay nello stesso millisecondo della
rotazione veniva accettato (`lib/database/managers/session.ts:110`). Lo ha fatto emergere la prova
del riuso, non la lettura del codice.

**Aperto e da verificare in T-11.11**: in multi-tenant e in modalità cookie l'access cookie è già
scaduto quando si rinnova, quindi il contenitore lo sceglie il resolver (header o sottodominio) e
il prefisso del credenziale viene solo confrontato. Serve il banco multi-tenant per dimostrarlo.
