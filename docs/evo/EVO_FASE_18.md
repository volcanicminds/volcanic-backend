# EVO fase 18: un token di integrazione sul piano di controllo

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce da T-7.3 di `volcanic-rag`, il corpus condiviso: un dato della piattaforma, sul piano di
> controllo, concesso ai tenant fino a un livello per contesto. Il 20 ottobre 2026 è deciso che per
> ora lo carica il server; perché lo carichi il sentinel, come fa con il corpus di un tenant, serve
> una credenziale macchina sul piano di controllo, che il backend non ha.
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5`; T-7.3 resta scritto in `volcanic-rag/TASKS.md`,
> e il sentinel che userà il token è lavoro di `volcanic-rag`.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 1. Da dove si parte, verificato il 20 ottobre 2026

- I token di integrazione esistono solo nel piano del tenant. Le rotte di
  `lib/api/token/routes.ts` non dichiarano `scope` e prendono quello di default, `tenant`
  (`lib/loader/router.ts:216-226`); la capability `tokens` non è tra quelle di sistema
  (`lib/loader/roles.ts:17-26`).
- Su una rotta di controllo l'hook riconosce solo un utente di sistema: con `controlIdentity`
  (`lib/hooks/onRequest.ts:67`) cerca il soggetto con `retrieveSystemUserByExternalId` e si ferma
  lì, senza mai interrogare i token. Una credenziale del piano di controllo nasce solo dal login di
  una persona, `/system/auth/flow/*`.
- Un token del tenant su una rotta di controllo è 403 `SCOPE_MISMATCH`
  (`lib/hooks/onRequest.ts:114`), e un token di controllo dentro un tenant pure
  (`lib/loader/tenant.ts:112`).
- In modalità cookie il piano di controllo rifiuta l'header `Authorization` con
  `CREDENTIAL_CHANNEL` (`lib/hooks/onRequest.ts:102`), ed è lì che una macchina manda il token.
- Il catalogo di sistema è chiuso: le capability sono un elenco del framework
  (`lib/loader/roles.ts:17-26`), e un ruolo di controllo del progetto che ne nomina un'altra non
  viene caricato (`lib/loader/roles.ts:93-97`). Nessun ruolo di sistema apre un caricamento e
  basta: `system:operator` porta anche `tenants` e `tenants:impersonate`
  (`lib/config/systemRoles.ts:31`).

## 2. Decisioni

Le quattro aperte il 20 ottobre 2026 il proprietario le ha prese il 23 ottobre 2026 (F97, F98,
F99, F103); discutendole sono nate F100, F101 e F102.

- **F97** (proprietario, 23 ottobre 2026): dietro il token di controllo c'è una riga della tabella
  `token` del piano di controllo, che lo schema porta già (`lib/database/schema/entry/control.pg.ts:19`)
  e che oggi serve solo ai deployment senza tenant, dove l'unico database è il piano di controllo.
  Scartato un utente di sistema di tipo macchina: login, MFA, step-up, console ed elenco degli
  utenti di sistema dovrebbero sapere di un utente che non entra mai. Come nel tenant, dove
  `admin` non si assegna a un token (`lib/api/token/controller/token.ts:60`), un token di
  controllo non porta mai `system:admin`.
- **F98** (proprietario, 23 ottobre 2026): il catalogo di sistema diventa estendibile, come quello
  del tenant. Oltre ai permessi del framework (`lib/loader/roles.ts:17-26`) valgono quelli
  dichiarati dal progetto o da un pacchetto; un ruolo che nomina un permesso non dichiarato resta
  scartato all'avvio, come oggi (`lib/loader/roles.ts:93-97`). Le rotte di piattaforma di rag,
  oggi del solo superuser (`volcanic-rag/src/backend/routes.ts:42`), chiederanno i loro, per
  esempio `rag:shared-ingest` per il caricamento e `rag:shared-manage` per le condivisioni: il
  token del sentinel carica e riceve 403 sul resto, e chi cura il corpus condiviso non deve essere
  superuser. Scartato un permesso generico per le macchine: al secondo pacchetto con una macchina
  sul piano di controllo aprirebbe le rotte di entrambi. Riapre il catalogo chiuso di
  `docs/AUTHORIZATION_V5.md` §4, che si riscrive insieme al codice.
- **F99** (proprietario, 23 ottobre 2026): il token di controllo lo emette solo una persona
  `system:admin`, con lo step-up (F101). La scadenza si dichiara sempre, anche quando è «nessuna», come
  per i token del tenant (`lib/database/schema/pg.ts`, colonna `expires_at`). Emissione, rinnovo
  e revoca scrivono ciascuna una riga di `governance_log` del piano di controllo.
- **F100** (proprietario, 23 ottobre 2026): un `governance_log` immutabile in ogni database. Il
  piano di controllo lo ha già (`lib/database/migrations/control/pg/0006_governance_log_control.sql`),
  e lo ha già l'unico database di un deployment senza tenant, perché lì l'insieme di controllo
  porta anche le tabelle dell'applicazione; il contenitore di un tenant non lo ha ancora. Ogni
  amministratore legge solo il suo: l'admin del tenant quello del suo tenant, `system:admin` e chi
  ha `governance-log` quello del piano di controllo. Ci vanno gli atti sui token di ogni piano.
  Scartati `change_log`, che registra le modifiche ai dati fatte da operatori e utenti per
  tracciarle e ricostruirle, e `access_log`, che si cancella dopo 90 giorni (F96) mentre un token
  può non scadere mai. Nessuna migrazione nuova: la tabella entra nell'insieme tenant come ogni
  modifica di schema della v5 prima della produzione. Compito T-18.2.
- **F101** (proprietario, 23 ottobre 2026): lo step-up vale sulla creazione, sulla modifica dei
  ruoli, sulla rigenerazione e sullo sblocco di un token, su ogni piano e anche senza tenant: lo
  sblocco ridà un accesso come la creazione. Non vale sul blocco né sull'eliminazione, perché in un
  incidente togliere un accesso deve essere immediato. Lo step-up
  rifiuta sempre un token e un'impersonificazione (`lib/util/stepUp.ts:58`): un token non ne crea
  un altro, e chi impersona un tenant non vi lascia una credenziale.
- **F102** (proprietario, 23 ottobre 2026): il database rifiuta `UPDATE`, `DELETE` e `TRUNCATE` su
  `governance_log`, in ogni database. Oggi l'immutabilità la garantisce solo il codice, perché il
  manager sa scrivere e leggere (`lib/database/managers/governanceLog.ts`), mentre il database
  accetta tutte e tre. Restano possibili la distruzione di un tenant, che elimina il contenitore,
  e il ripristino, che scrive righe nuove.

- **F103** (proprietario, 23 ottobre 2026): una regola unica distingue un token di integrazione
  da una sessione, su ogni piano, con o senza tenant. Il token porta un'etichetta firmata che lo
  dice di integrazione, e una sessione non la porta mai. Con l'etichetta il soggetto si cerca solo
  fra i token; senza, solo fra le persone: gli utenti nel tenant, gli utenti di sistema sul piano
  di controllo. In modalità cookie l'header accetta solo una credenziale con l'etichetta, ed è
  questa l'eccezione a `CREDENTIAL_CHANNEL` sul piano di controllo; una sessione nell'header resta
  rifiutata. Scartata l'assenza del numero di sessione come segnale: una sessione non lo porta
  quando il registro delle sessioni è spento (`lib/util/credential.ts:270`,
  `lib/util/session.ts:146`), e quelle persone verrebbero cercate fra i token. Oggi, in modalità
  bearer, un token si cerca prima fra gli utenti e poi fra i token
  (`lib/hooks/onRequest.ts:178-197`); con la regola basta una lettura.
- **F104** (proprietario, 23 ottobre 2026): l'autore di una riga di `governance_log` si dice con
  `actor_kind`, che prende il posto di `actor_plane` e nomina la tabella da cui viene: `user`,
  `system_user` o `token`. Con un token, `actor_id` è l'id della sua riga, nel contenitore del
  registro. Nata chiudendo T-18.2: un token con il permesso `tokens` che blocca o elimina un
  token lasciava l'autore vuoto, come un job, e chi legge il registro non sapeva quale macchina
  fosse stata. Scartato l'id del token nel dettaglio con l'autore vuoto, come per
  l'impersonificazione: la riga continuerebbe a sembrare di nessuno. Vale anche per i token di
  controllo, quindi entra in T-18.1. Nessuna migrazione nuova: la colonna si riscrive nelle due
  migrazioni che creano la tabella.

## 3. Compiti

- [x] **T-18.1** Un token di integrazione sul piano di controllo. Firmato con `sub` e
  `scp: 'control'`, senza `tid`; emesso, rinnovato e revocato da rotte `scope: 'control'`;
  riconosciuto dall'hook sulle rotte di controllo accanto all'utente di sistema; con i ruoli del
  catalogo di sistema, esteso dai permessi dichiarati (F97, F98, F99, F101); la regola unica fra
  token e sessione vale su ogni piano (F103); l'autore di ogni riga del registro dice da quale
  tabella viene, un token compreso (F104).
  **Fatto quando**: una macchina con un token di controllo chiama una rotta `scope: 'control'` che
  la sua capability apre e riceve 200, e una che non apre riceve 403; lo stesso token dentro un
  tenant è 403 `SCOPE_MISMATCH`; un token del tenant sulla stessa rotta di controllo è 403; un
  token revocato è rifiutato dalla richiesta successiva; in modalità cookie il token passa
  dall'header e una sessione no; su ogni piano una credenziale con l'etichetta si cerca solo fra i
  token e una senza solo fra le persone, anche con il registro delle sessioni spento, e in
  modalità bearer un token costa una lettura; un token con `system:admin` non si emette; un permesso
  dichiarato dal progetto apre la sua rotta, e un ruolo che ne nomina uno non dichiarato è
  scartato all'avvio; emettere, modificare, rigenerare o sbloccare senza step-up è 403
  `STEP_UP_REQUIRED`,
  e con un token è 403 `STEP_UP_NOT_AVAILABLE`, mentre il blocco passa; emissione, rinnovo e
  revoca scrivono ciascuna una riga di `governance_log`; un atto fatto da un token, di controllo o
  del tenant, ha per autore quel token (`actor_kind: 'token'`). Prove via HTTP su Postgres reale, con
  entrambe le strategie. Difetti da piantare: un token senza `scp` accettato sul piano di
  controllo; la revoca letta da una cache; l'eccezione del canale estesa alle sessioni; una
  credenziale senza etichetta cercata fra i token.
  **Chiuso il 23 ottobre 2026.** Un solo controller dei token serve entrambi i piani: le rotte
  `/system/tokens` (solo con i tenant, solo `system:admin`) riusano quello di `/token`, che sul
  piano di controllo prende i ruoli da `global.systemRoles`, non aggiunge `public` e rifiuta
  `system:admin` con `TOKEN_ROLE_FORBIDDEN`, lo stesso codice che ora riceve chi chiede `admin`
  in un tenant senza averlo. L'etichetta è `typ: 'integration'` (`INTEGRATION_TYP`,
  `lib/util/credential.ts`); l'hook sceglie la tabella dall'etichetta e legge solo quella. Il
  catalogo di sistema cresce con l'export `capabilities` di un `config/systemRoles.ts`
  (`declaredCapabilities`, `lib/loader/roles.ts`), e `global.systemCapabilities` lo porta al
  router. La guardia `GOVERNANCE_ACTOR_MISPLACED` impedisce che l'atto di un token finisca nel
  registro di un altro contenitore. Prove: `controlToken.e2e` (12 per strategia, con un ruolo e
  un permesso dichiarati dalla fixture e un ruolo che ne nomina uno non dichiarato), i rifiuti
  di `tokenApex.spec`, `authChannels.spec`, `roles.spec` e `router.spec`; `npm test` 1009
  passate, `test:e2e:mt:pg` 103, `check-all` pulito. I quattro difetti piantati sono presi
  ciascuno da una prova dello spec, per strategia: il token senza `scp`, la revoca da una cache,
  l'eccezione del canale estesa alle sessioni, la credenziale senza etichetta cercata fra i
  token. Sul piano di controllo `STEP_UP_NOT_AVAILABLE` non si raggiunge con un token: le rotte
  sono del solo superutente e un token non lo è mai, quindi è 403 `FORBIDDEN` prima; con un
  token del tenant lo prova `tokenGovernance.e2e`. Il token piantato in un cookie è provato in
  `authChannels.spec`, perché l'app e2e parte in modalità bearer senza lettore di cookie.
  Lo stesso giorno, dopo il commit: la modifica di un token passava al manager il corpo intero,
  quindi i ruoli senza il filtro del catalogo e, con loro, `blocked`, `deletedAt`, `externalId` ed
  `expiresAt`. Ora scrive solo nome, descrizione e ruoli, questi con la regola della creazione, su
  entrambi i piani (`planeRoles`, `lib/api/token/controller/token.ts`). Prove: `tokenApex.spec`
  e un caso di `controlToken.e2e` per piano, tutti rossi sul controller di prima.
  Sempre il 23 ottobre 2026: chi aveva `system-users` poteva creare un utente di sistema con
  `system:admin` o modificarne uno, e da T-18.1 anche un token di piattaforma con un ruolo che
  porta quella capacità. Ora il piano di controllo ha l'apice del tenant: solo un superutente
  concede `system:admin` o agisce su chi lo ha, altrimenti 403 `SUPERUSER_ONLY`; creazione,
  modifica, sblocco e azzeramento del secondo fattore di un utente di sistema chiedono lo step-up,
  quindi nessun token li raggiunge, mentre blocco ed eliminazione restano liberi come per i token.
  Prove: `systemUserRefusals.spec` e un caso di `controlToken.e2e` con un ruolo `system:steward`
  della fixture; tolti a turno lo step-up della creazione, il controllo dello sblocco e quello
  della concessione, le prove diventano rosse. L'ultimo superutente che può entrare (i bloccati
  non contano) non può togliersi `system:admin`: 409 `LAST_SUPERUSER`. Il conteggio filtra con
  `arrayContains`; con `roles:in`, piantato apposta, Postgres risponde 500 e `controlToken.e2e`
  diventa rosso.
- [x] **T-18.2** Il registro di governo in ogni contenitore (F100). `governance_log` entra
  nell'insieme tenant; il manager scrive e legge sul contenitore della richiesta; gli atti sui
  token (creazione, modifica, rigenerazione, blocco, sblocco, eliminazione) si scrivono nella
  stessa transazione della modifica, su ogni piano; una lettura riservata all'admin del tenant;
  le rotte dei token del tenant chiedono lo step-up (F101); ogni database rifiuta modifica,
  cancellazione e svuotamento del registro (F102). Export, ripristino e trasloco del tenant
  portano il registro con sé; la distruzione lo elimina con il contenitore, mentre la distruzione
  stessa resta scritta sul piano di controllo (`tenant.destroyed`).
  **Fatto quando**: ogni atto su un token del tenant scrive una riga nel registro di quel tenant e
  in nessun altro; l'admin di un tenant legge il suo e non quello di un altro; senza tenant gli
  atti finiscono nell'unico database; creare, modificare, rigenerare o sbloccare un token del tenant senza
  step-up è 403 `STEP_UP_REQUIRED`, e con un token o un'impersonificazione è 403
  `STEP_UP_NOT_AVAILABLE`, mentre bloccare ed eliminare passano; `UPDATE`, `DELETE` e `TRUNCATE`
  su `governance_log` falliscono da SQL nel piano di controllo, in un tenant e senza tenant; un
  pacchetto esportato e ripristinato porta le righe, e distruzione e trasloco riescono. Prove via
  HTTP su Postgres reale, con entrambe le strategie. Difetti da piantare: la riga scritta fuori
  dalla transazione dell'atto; il registro di un tenant letto da un altro; il blocco del database
  tolto da uno dei due insiemi.
  **Chiuso il 23 ottobre 2026.** La tabella è nella prima migrazione dell'insieme tenant, con la
  funzione e il trigger scritti a mano in coda a entrambi gli insiemi; `check-migration-sets`
  rifiuta un insieme che crea la tabella senza. Ogni azione ha un ambito (`platform` o
  `container`): una della piattaforma scritta nel contenitore di un tenant è rifiutata con
  `GOVERNANCE_ACTION_MISPLACED`, e `GET /governance-log` legge solo gli atti sui token. Il
  ripristino scrive nella copia un `token.reissued` senza autore per ogni token, con
  `cause: 'tenant.imported'`. Prove: `tokenGovernance.e2e` (5 per strategia, compresi token e
  impersonificazione, e il registro reso illeggibile che annulla l'atto), il registro della copia
  in `tenantLifecycle.e2e`, `governanceLog.spec` su PGlite e su Postgres; `npm test` 1004 passate,
  `test:e2e:mt:pg` 79. I tre difetti piantati sono presi: la riga fuori dalla transazione (il
  token nasce lo stesso), il registro letto dal piano di controllo (lettura vuota), il blocco tolto
  dall'insieme di controllo (`check-migration-sets` e le due prove del piano). Il caso senza
  tenant è provato sul manager, con le due specie di righe nello stesso database, e sul
  controller con un registro finto, non via HTTP: il banco su Postgres reale gira solo con i
  tenant.
