# EVO framework v5: piano di riscrittura multi-tenant di `@volcanicminds/backend`

> **Versione del piano**: 6 settembre 2026 · repository `volcanic-backend` · branch di lavoro
> **`develop`**, allineato a `main` · bersaglio **`5.0.0`, breaking dichiarata** · data layer
> **Drizzle**.
>
> **Base di partenza**: il rilievo del 1 settembre 2026 su `v4.0.3`. Le sezioni 2, 4 e le
> appendici A e B sono quel rilievo e restano valide: descrivono il codice da cui si parte e
> le prove che lo dimostrano. Le decisioni che hanno trasformato il rilievo in questo piano
> sono in **`EVO_PUNTI_APERTI.md`**, che è il verbale e prevale in caso di divergenza.
>
> **A chi è rivolto**: sviluppatori senior e agenti di coding che **non conoscono il contesto**
> di questo progetto. Tutto ciò che serve per lavorare è in questo documento.
>
> **Come si usa**: si esegue nell'ordine scritto. Le fasi hanno dipendenze reali, non
> preferenze. Ogni compito dichiara scopo, file, dipendenze, quali difetti chiude, come si
> verifica e dove ci si sbaglia. Se un compito risulta impossibile o sbagliato **nella
> pratica**, lo si segnala e ci si ferma su quel compito: non lo si aggira, non lo si
> reinterpreta.
>
> **Cosa NON fare.** Non riaprire le decisioni della sezione 5. Non scrivere codice di
> compatibilità con la v4: la compatibilità è un **documento** (T-8.3), non un ramo `if`. Non
> tenere due ORM contemporaneamente. Non aggiungere dipendenze fuori da quelle indicate. Non
> correggere i difetti dentro il data layer TypeORM: quel codice viene sostituito, non curato.

---

## 0. I documenti: cosa leggere, in che ordine

Questo piano non è autosufficiente da solo, e non deve esserlo: dice **cosa fare, in che
ordine e come si verifica**, mentre i contratti (che forma ha una tabella, come si chiama un
operatore, che firma ha un manager) stanno nelle specifiche. Chi implementa legge in
quest'ordine e non ha bisogno di altro.

| # | Documento | Cos'è | Quando si legge |
|---|---|---|---|
| 1 | `EVO_FRAMEWORK.md` | questo file: difetti, invarianti, fasi, compiti | per primo, per intero |
| 2 | `EVO_PUNTI_APERTI.md` | il verbale delle decisioni prese, con il perché | subito dopo. Prevale su questo piano in caso di divergenza |
| 3 | `EVO_STATO.md` | lo stato di avanzamento, una riga per compito | a ogni ripresa del lavoro, per sapere dove si è |
| 4 | `docs/CONFIGURATION_V5.md` | forma della configurazione, combinazioni ammesse, variabili d'ambiente | prima della fase 1 |
| 5 | `docs/MANAGERS_V5.md` | i due handle tipizzati, le firme di ogni manager, le porte interne | prima della fase 1 |
| 6 | `docs/SCHEMA_V5.md` | le otto tabelle, colonna per colonna, sui due dialetti | prima della fase 2 |
| 7 | `docs/MAGIC_QUERY_V5.md` | la sintassi pubblica delle query, operatori, errori, corrispondenza v4 → v5 | prima della fase 2 |
| 8 | `docs/AUTHORIZATION_V5.md` | i due ambiti, ruoli di sistema, capability, token, impersonificazione | prima della fase 3 |
| 9 | `docs/API_V5.md` | l'inventario completo delle rotte, con ambito, permessi, corpi ed errori | prima della fase 3 |
| 10 | `docs/TESTING_V5.md` | suite, harness su Postgres reale, i sette test di isolamento, copertura, CI | **per primo fra i documenti tecnici**: il banco di prova si scrive prima del codice |

**Documenti della v4 che restano, e non vanno usati come guida.** Portano un cartello in testa:
`docs/DATA_LAYER_MAGIC.md` (sostituito da `MAGIC_QUERY_V5.md`), `docs/CONFIGURATION.md`
(sostituito da `CONFIGURATION_V5.md`), `docs/AUTH_COMPOSABLE_EVOLUTION.md` (progetto rinviato,
fuori dalla v5). `docs/AUTHORIZATION_MODEL.md` invece **resta valido**: `AUTHORIZATION_V5.md` lo
estende, non lo sostituisce.

**Regola di precedenza, per non avere due verità.** Sull'**ordine dei lavori** e sul **perché**
comanda questo piano. Sui **contratti** (nomi, tipi, firme, codici di errore) comandano le
specifiche. Se i due si contraddicono, è un difetto del documento: si segnala e si corregge
prima di scrivere codice.

---

## 1. Il framework in dieci righe

`@volcanicminds/backend` è un pacchetto npm che avvolge **Fastify 5** e fornisce, come
prodotto finito: autodiscovery di rotte, autenticazione JWT (bearer o cookie), MFA TOTP,
ruoli e capability, cache di risposta, rate limit, scheduler, Swagger e un **data layer**
esposto come subpath.

| | Oggi (v4.0.3) | In v5 |
|---|---|---|
| Sorgente | `lib/` (7.532 righe), `index.ts` (453), `typeorm.ts` (159) | stesso core, data layer riscritto |
| Data layer | `lib/database/typeorm/` (2.003 righe, 26,6% di `lib/`), TypeORM 0.3.30 | `lib/database/` su **Drizzle**, subpath `@volcanicminds/backend/db` |
| Motori | Postgres, PGlite, MongoDB (dichiarato) | **Postgres, SQLite, libSQL**. Mongo esce dal data layer |
| Tenancy | `none` e `schema` su Postgres | `none`, `schema`, **`container`** (database dedicato o file) |
| Runtime | Node >= 24, ESM puro, import con estensione `.js` anche nei `.ts` | invariato |
| Confine architetturale | il core **non** importa il data layer, garantito in CI da `dependency-cruiser` | invariato, ed è il vincolo che decide dove sta la risoluzione del tenant (T-3.2) |
| Integrazione | il consumer inietta i «manager» (`userManager`, `tokenManager`, `dataBaseManager`, `tenantManager`, `mfaManager`, `transferManager`) via `start(decorators)`; senza, partono i null-object di `lib/defaults/managers.ts` | invariato come meccanismo, firme riviste |
| Consumer | progetti clienti in single tenant su Postgres | i progetti su v4 restano su v4; il porting è volontario e guidato da T-8.3 |

**Le quattro combinazioni che la v5 costruisce e mantiene.** Non sono ipotesi: ognuna è un
asse di test che qualcuno mantiene per anni.

| Piano di controllo | Tenant | A cosa serve |
|---|---|---|
| Postgres | assente | ogni progetto single tenant |
| Postgres | Postgres per schema | il multi-tenant denso, molti tenant piccoli |
| Postgres | Postgres per contenitore | isolamento forte, backup e ripristino per tenant |
| Postgres | SQLite o libSQL per file | il contenitore consegnabile e replicabile |
| SQLite o libSQL | assente o per file | processi senza server: CLI, agenti, desktop, deploy a file singolo |

Le altre combinazioni non esistono: la matrice di T-1.4 le rifiuta all'avvio.

---

## 2. Stato accertato del codice di partenza (v4.0.3)

Tutti i numeri qui sotto sono **misurati il 1 settembre 2026**, non stimati. Il metodo per
rifarli è nell'appendice A.

| | |
|---|---|
| Test | **432 passano, 0 falliscono, 0 saltati**, su 11 suite, in ~65 s |
| Copertura reale | righe **79,7%** (6.492/8.144) · rami **72,1%** (1.557/2.160) · funzioni **77,5%** (631/814) |
| Motori nei test | **uno solo**: PGlite (Postgres in WASM, in-process). Zero Postgres reale, zero Mongo, zero SQLite |
| CI | esiste ed è completa: `.github/workflows/ci.yml` fa lint, type-check, depcruise, build, `publint`, `@arethetypeswrong/cli`, test, e pubblica su npm al tag `v*` |
| Vulnerabilità in produzione | `npm audit --omit=dev`: **6 (5 high, 1 moderate)**, tutte con fix disponibile |
| Migrazioni | **non esistono**: zero occorrenze della parola `migration` nel sorgente |
| Copertura del codice multi-tenant | `lib/api/tenants/controller/tenants.ts` **28,4%** di righe · `lib/loader/tenant.ts` 78,4% · `tenantManager.ts` 88,8% |

**Le tre cose che il codice promette e non fa.**

1. Il `README.md` dichiara «Subdomain / header / query resolver» e `types/global.d.ts:133`
   tipizza `resolver?: 'subdomain' | 'header' | 'query'`. Il default in
   `lib/config/general.ts:20` è `'subdomain'`. **Nessuna riga di codice legge quel campo**:
   la risoluzione è sempre e solo per header.
2. Il `README.md` dichiara supporto MongoDB. In multi-tenant `tenantManager.ts:98-101`
   registra un warning e **prosegue senza isolare**.
3. `tenantManager.ts:42` dichiara di bloccare lo spoofing del tenant confrontando il `tid`
   del JWT con l'header. Quel confronto **non può mai scattare** (vedi D-03).

---

## 3. Gli invarianti dell'evoluzione

Sono i vincoli con cui si giudica ogni modifica. **Se una proposta ne viola uno, non è una
variante: è un altro prodotto, e va segnalato con quelle parole.**

| # | Invariante | Conseguenza pratica |
|---|---|---|
| 1 | **O l'isolamento lo impone il framework, o non esiste** | niente strategia `row`: il framework non promette isolamento che poi dipende da una `WHERE` scritta dall'applicazione |
| 2 | **Fail-closed all'avvio** | una combinazione motore/strategia non supportata **impedisce l'avvio**, non produce un warning. Vale già per i secret deboli (`lib/util/secret.ts`), va esteso alla tenancy |
| 3 | **Nessun fallback implicito al contesto globale** | in multi-tenant, una query senza contesto esplicito è un errore, mai una lettura dello schema `public` |
| 4 | **Lo stato di sessione non sopravvive alla richiesta** | nessuna connessione torna nel pool con impostazioni della richiesta precedente |
| 5 | **Una prova che passa non dimostra che il sistema faccia ciò che gli hai chiesto** | ogni test di isolamento deve verificare una **proprietà** osservabile (un dato di un tenant non è leggibile da un altro), mai una configurazione dichiarata |
| 6 | **Il piano di controllo e i dati dei tenant hanno tipi diversi** | la separazione la impone il compilatore, non la disciplina di chi scrive la query |
| 7 | **Fuori dal contenitore del cliente sta solo ciò che potresti pubblicare** | regola per decidere cosa finisce nel piano di controllo |
| 8 | **Ogni difetto trovato si chiude con un test che fallisce prima e passa dopo** | nessuna correzione entra senza la prova che riproduce il difetto |
| 9 | **La compatibilità con la v4 è un documento, non un ramo `if`** | nessun alias deprecato, nessuna traduzione automatica della configurazione vecchia: la v5 è breaking e la conversione sta in `docs/MIGRATION_V4_V5.md` |
| 10 | **Il nome del motore non compare nell'API pubblica** | il subpath è `/db`, i tipi esposti sono del framework. Cambiare ORM una seconda volta non deve essere di nuovo una major |

---

## 4. I difetti accertati

> **Come si legge questa sezione in v5.** È la fotografia del codice v4.0.3, ed è ancora
> il riferimento: descrive con precisione cosa non deve ripresentarsi. I difetti dei
> percorsi riscritti non si «correggono», non esistono nel codice nuovo; la sezione 4.5 dice
> quale compito ha il dovere di dimostrarlo.

Ordinati per gravità. Ogni riga è verificata sul codice alla data del rilievo, con
riferimento `file:riga`. La colonna «Prova» dice come è stato dimostrato: *letto* significa
verificato leggendo il codice, *provato* significa riprodotto con un programma.

### 4.1 Critici: perdita di dati fra tenant

| ID | Difetto | Dove | Prova |
|---|---|---|---|
| **D-01** | **Il `search_path` del tenant sopravvive nel pool.** L'hook `onResponse` rilascia il `QueryRunner` **prima** che il listener su `finish` possa eseguire il `SET search_path TO public`, quindi quel reset non viene **mai** eseguito nel percorso normale | `lib/hooks/onResponse.ts:2-6` (rilascia) · `lib/loader/tenant.ts:78-87` (reset mai raggiunto) | **provato** (appendice A.1 e A.2) |
| **D-02** | **Secondo sito di avvelenamento, senza ambiguità**: `resolveTargetUser` imposta `search_path` sullo schema del tenant bersaglio e rilascia il runner **senza reset** | `lib/api/tenants/controller/tenants.ts:132` e `:155` | letto |
| **D-03** | **Il controllo anti-spoofing del tenant è codice morto.** `resolveTenant` legge `req.user?.tid`, ma (a) l'hook tenant gira **prima** dell'hook di autenticazione, quindi `req.user` non esiste ancora, e (b) l'entità `User` **non ha** un campo `tid`. Quindi `jwtTid` è sempre `undefined`, il confronto di riga 42 non scatta mai e il tenant viene deciso **solo dall'header** | `lib/database/typeorm/loader/tenantManager.ts:24,42,49` · `lib/database/typeorm/entities/user.ts` (nessun `tid`) · ordine hook: `index.ts:58` prima di `index.ts:59` | letto |
| **D-04** | **Multi-tenant su Mongo è fail-open**: `switchContext` registra un warning e ritorna; il chiamante prosegue e assegna comunque `req.db`, quindi la richiesta lavora sull'intero database senza alcun isolamento | `lib/database/typeorm/loader/tenantManager.ts:98-101` · `lib/loader/tenant.ts:70` | letto |

**Perché D-01 conta, in concreto.** Le rotte dichiarate `tenantContext: false` usano
`global.connection.manager`, cioè una connessione qualsiasi del pool. Sono in questa
condizione **tutte le rotte `/tenants/*`** (`lib/api/tenants/routes.ts:10`) e
**`/admin/manifest`** (`lib/api/admin/routes.ts:10`), più ogni job schedulato e ogni uso di
`global.connection` fatto dal consumer. Poiché `createTenant` sincronizza **tutte** le
entità dentro lo schema del tenant (`tenantManager.ts:145-146`), ogni schema di tenant
contiene anche una copia delle tabelle `tenant` e `user`. Di conseguenza, su una connessione
avvelenata:

- `GET /tenants` può elencare la tabella `tenant` **di uno schema di tenant** invece che quella del piano di controllo;
- la ricerca dell'utente autenticato per una rotta `tenantContext:false` può risolversi
  **nella tabella `user` di un tenant**, che è l'unica cosa che oggi separa il «super admin
  di sistema» (che vive in `public`) dall'«admin di un tenant». Questa è una via di
  **elevazione di privilegi**, non solo una lettura sbagliata.

**L'elenco è chiuso.** Fuori dal data layer, `global.connection` compare in sei punti soltanto:
`lib/loader/tenant.ts:12,33,64` (attesi, sono il provider di connessione) e
`lib/api/tenants/controller/tenants.ts:83,84,128` (i tre che leggono dal pool avvelenato).
Ogni altro accesso passa da `req.db` o `req.runner`, e `global.repository` è vietato a runtime
da un proxy che lancia (`typeorm.ts:113-127`).

**Perché i test non lo vedono.** Tutte le suite girano su PGlite, che espone **una sola
connessione**: `PGlitePool.connect()` restituisce sempre lo stesso oggetto
(`node_modules/typeorm-pglite/dist/pglite-pool.js`) e `PGliteInstance` è un singleton. Non
esiste un pool, quindi il difetto è **strutturalmente irraggiungibile** dai test attuali.
Il commento in `test/e2e-mt/harness.ts:127-137` documenta già il fenomeno, ma lo attribuisce
a PGlite e conclude che «production multi-tenant needs real Postgres». La prova in
appendice A.2 mostra che **su Postgres reale la perdita c'è comunque**, solo non
deterministica.

### 4.2 Alti: funzioni che non funzionano o si aggirano

| ID | Difetto | Dove | Prova |
|---|---|---|---|
| **D-05** | **Il tracciamento delle modifiche è silenziosamente rotto in multi-tenant.** `tracker` chiama `retrieveBy` e `addChange` **senza contesto**; in multi-tenant `dataBaseManager` lancia per progetto, e il tracker cattura l'eccezione e la scrive solo nel log. Risultato: nessun record di audit viene scritto, e nulla lo segnala | `lib/util/tracker.ts:14` e `:72` · guardia in `lib/database/typeorm/loader/dataBaseManager.ts:31-38,57-64` | letto |
| **D-06** | **Fallback implicito al contesto globale nelle query su vista**: `executeFindView` e `executeCountView` ripiegano su `global.connection.manager` quando manca il runner, **senza** la guardia multi-tenant applicata ovunque altrove | `lib/database/typeorm/query.ts:265` e `:291` | letto |
| **D-07** | **I lavori schedulati non hanno contesto tenant.** La funzione del job viene invocata senza argomenti; qualunque accesso al database passa da `global.connection`, cioè dal pool, cioè (con D-01) da uno schema arbitrario | `lib/loader/schedules.ts:99-105` | letto |
| **D-08** | **Un tenant appena creato è inutilizzabile.** `createTenant` semina l'admin con `createUser`, che imposta sempre `confirmed: false`; `login` rifiuta gli utenti non confermati. Non esiste alcuna API per confermarlo, e i test lo aggirano con una `UPDATE` grezza | `tenantManager.ts:171` · `userManager.ts:70` · `auth.ts:304-306` · aggiramento in `test/e2e-mt/harness.ts:95-96` | letto |
| **D-09** | **Non esiste alcun modo di distruggere i dati di un tenant.** `deleteTenant` è una `softDelete` sulla riga di registro; lo schema e i suoi dati restano | `tenantManager.ts:210` | letto |
| **D-10** | **Un `DataSource` per tenant non scala**: ogni `DataSource` inizializzato tiene almeno una connessione aperta. A 150 tenant su un Postgres con `max_connections = 100` il processo fallisce con `sorry, too many clients already`. Il costo in memoria è invece trascurabile (44 KiB per `DataSource`), quindi **il vincolo è la connessione, non l'ORM** | misura in appendice A.3 | **provato** |

### 4.3 Medi

| ID | Difetto | Dove |
|---|---|---|
| **D-11** | `resolver` è configurabile, tipizzato e documentato, ma **nessuno lo legge**: la risoluzione è solo per header | `lib/config/general.ts:20` · `types/global.d.ts:133` |
| **D-12** | L'operatore `:raw` interpola la stringa dell'utente dentro SQL. È dietro l'env `VOLCANIC_CUSTOM_QUERY_OPERATORS`, ma abilitato è **SQL injection**, e con `search_path` attivo consente di raggiungere altri schemi | `lib/database/typeorm/query/operators.ts:183` |
| **D-13** | Il parser di `_logic` non ha limiti di lunghezza né di profondità; l'eccezione da ricorsione viene **catturata** e la query **degrada in silenzio** a un AND di tutte le condizioni, cambiando semantica senza dirlo | `lib/database/typeorm/query/parser.ts` · fallback in `query.ts:199-202` |
| **D-14** | `scryptSync` con `N = 32768` è **sincrono e bloccante**: misurato **82 ms** per derivazione su questa macchina. Sta sul percorso di verifica MFA (una derivazione a `decrypt`), quindi blocca l'event loop a ogni login con MFA | `lib/database/typeorm/util/crypto.ts:33-40` · misura in appendice A.4 |
| **D-15** | La cache di TypeORM su `retrieveUserByExternalId` usa una chiave composta da SQL e parametri, che in multi-tenant per schema è **identica fra tenant** (lo schema sta nel `search_path`, non nell'SQL). È inerte finché il consumer non imposta `cache` nelle opzioni della `DataSource`: se lo fa, la cache diventa condivisa fra tenant | `lib/database/typeorm/loader/userManager.ts:213-216` · `node_modules/typeorm/data-source/DataSource.js:62` |
| **D-16** | CORS di default `origin: '*'` **con** `credentials: true`: combinazione che i browser rifiutano (quindi rompe la modalità `COOKIE`) e che in modalità `BEARER` lascia l'API richiamabile da qualunque origine | `lib/config/plugins.ts:6-9` |
| **D-17** | Enumerazione utenti: `register` risponde «Email already registered», `login` distingue «Wrong credentials» / «Invalid user» / «User email unconfirmed» / «User blocked» / «Password is expired». `forgot-password` è invece già corretto | `lib/api/auth/controller/auth.ts:76,295,301,305,310,314` |
| **D-18** | Impersonificazione: nessun record persistito (solo un claim `impersonator` nel token), durata 24 h, nessuna riautenticazione forte. Il ramo `req.user?.tenantId === 'system'` è **morto** (l'entità `User` non ha `tenantId`) e `'system'` è una stringa magica non definita altrove. Copertura del file: 28,4% | `lib/api/tenants/controller/tenants.ts:100,193-204` |
| **D-19** | Il rinnovo del token non verifica il `tid` del token contro il tenant risolto. Oggi non è sfruttabile perché l'utente viene cercato nello schema del tenant e non esiste; diventa sfruttabile appena esiste un archivio utenti condiviso | `lib/api/auth/controller/auth.ts:428,435` |
| **D-20** | `dbSchema` viene **salvato grezzo** e **usato sanificato**: la riga in tabella può nominare uno schema che non esiste | `tenantManager.ts:131` rispetto al `repo.save` di riga 121 |
| **D-21** | La fusione della configurazione è **superficiale**: un consumer che scrive `multi_tenant: { enabled: true }` cancella `resolver`, `header_key` e `query_key` | `lib/loader/general.ts:40-43` |
| **D-22** | 6 vulnerabilità nelle dipendenze di produzione (5 alte), fra cui `find-my-way` (il router di Fastify) e `@fastify/static` | `npm audit --omit=dev` |

### 4.4 Bassi

| ID | Difetto | Dove |
|---|---|---|
| **D-23** | L'hook `onError` restituisce il messaggio dell'eccezione su 500 **ignorando** `HIDE_ERROR_DETAILS`, che il gestore d'errore di `index.ts:216` invece rispetta | `lib/hooks/onError.ts:33-37` |
| **D-24** | Refuso `tomezone` invece di `timezone`: il fuso orario dei job cron è silenziosamente ignorato | `lib/loader/schedules.ts:111` |
| **D-25** | `tsconfig.json` esclude `test` dal type-check: i test non sono verificati da `npm run type-check` | `tsconfig.json`, campo `exclude` |
| **D-26** | La cache di risposta è in memoria per processo: l'invalidazione dichiarata da una rotta non raggiunge le altre istanze | `lib/util/cache.ts:37` |
| **D-27** | `isFounderEmail` confronta con una variabile d'ambiente di processo: in multi-tenant la stessa email è «fondatore» dentro **ogni** tenant | `lib/util/authz.ts:23-26` |
| **D-28** | Ricerca dell'unicità di un UUID con un ciclo `do/while` su query al database, sia per gli utenti sia per i token | `userManager.ts:61-65,117-120` · `tokenManager.ts:51-54,79-82` |
| **D-29** | `req.data()` restituisce **la query string oppure il corpo, mai i due insieme**: se la query ha un solo valore non nullo, il corpo viene ignorato del tutto. Una `POST /auth/login?x=1` con le credenziali nel corpo fallisce con «Email not valid» | `lib/util/common.ts:9` |

**Cose verificate e risultate corrette**, da non «sistemare»: la cache di risposta è
correttamente segmentata per tenant, soggetto e ruoli (`lib/util/cache.ts:182-200`); la
sanificazione dei nomi di schema impedisce l'injection; le password usano bcrypt costo 12 con
confronto a costo costante anche per utenti inesistenti; il segreto MFA è cifrato con
AES-256-GCM e derivazione per record; il confine core / data layer è reale ed è verificato in CI.

---

### 4.5 Dove si chiude ogni difetto

Nessun difetto resta senza casa. I difetti dei percorsi riscritti non si «correggono»: il
codice nuovo nasce senza di essi, e il compito indicato è quello che deve **dimostrarlo**.

| Difetto | Chiuso da | Come |
|---|---|---|
| D-01, D-02 | **T-3.1** | per costruzione: il contesto tenant non usa stato di sessione |
| D-03, D-11, D-19 | **T-3.2** | il tenant viene dal token; l'header solo dove il token non c'è |
| D-04 | **T-1.4** | Mongo esce dal data layer; la matrice rifiuta le combinazioni non supportate |
| D-05 | **T-3.5** | il tracciamento riceve il contesto e fallisce visibilmente |
| D-06 | **T-2.4** | nessun ripiego sul manager globale: il globale non esiste più (T-3.3) |
| D-07 | **T-3.4** | i job dichiarano il contesto in cui girano |
| D-08, D-20 | **T-6.1** | creazione del tenant con admin utilizzabile e nome di schema coerente |
| D-09 | **T-6.3** | distruzione a due fasi con export obbligatorio |
| D-10 | **T-7.1** | cache LRU con limite verificato contro `max_connections` |
| D-12, D-13 | **T-2.4** | operatori e `_logic` ridefiniti dalla specifica di T-0.3 |
| D-14, D-28 | **T-2.6**, **T-2.5** | derivazione asincrona; identificativi generati senza interrogare il database |
| D-15, D-26 | **T-3.6** | chiave di cache che include il contenitore; invalidazione fra istanze |
| D-16, D-17, D-22 | **T-8.1** | default sicuri del core e dipendenze aggiornate |
| D-18, D-27 | **T-4.2**, **T-4.3** | impersonificazione tracciata; «fondatore» risolto per contenitore |
| D-21 | **T-1.1** | fusione profonda della configurazione, nuova forma `control` / `tenants` |
| D-23, D-24, D-29 | **T-8.2** | compito unico di raccolta dei minori |
| D-25 | **T-0.1** | i test entrano nel type-check |

---

## 5. Decisioni già prese

Vengono dal verbale in `EVO_PUNTI_APERTI.md`. **Non si riaprono.** Se una sembra sbagliata
nella pratica, si segnala e ci si ferma.

| # | Decisione | Motivo |
|---|---|---|
| 1 | **v5 breaking, mentalità greenfield** | si evolve come se i progetti esistenti non ci fossero. Per loro si scrive una guida (T-8.3), non un ramo di compatibilità |
| 2 | **Il data layer si riscrive su Drizzle** | il carico della direzione presa è aprire e chiudere connessioni per tenant su motori diversi: Drizzle è un involucro sottile sopra un driver, TypeORM è una `DataSource` con metadati e ciclo di vita |
| 3 | **Mongo esce dal data layer** | dove servirà si userà Mongoose fuori dal framework, su database single tenant. Un adattatore che non regge l'isolamento non è un adattatore |
| 4 | **Le correzioni non si applicano al data layer TypeORM** | quel codice viene sostituito. Nessun consumer è in produzione in multi-tenant, quindi la falla non ha vittime durante il porting |
| 5 | **La strategia `row` (colonna `tenant_id`) non entra** | è la via di mezzo in cui il framework promette isolamento ma il confine è una `WHERE` scritta dall'applicazione. I progetti che oggi usano una colonna di appartenenza restano `single`: quella colonna è dominio, non tenancy |
| 6 | **Le strategie sono tre nomi e solo tre**: `none`, `schema`, `container` | vedi glossario |
| 7 | **libSQL è un driver dentro l'adattatore SQLite**, non un adattatore | espone un'API compatibile |
| 8 | **La replica non si riscrive**: porta con Litestream come primo adattatore | è un binario esistente e collaudato |
| 9 | **Resolver: `header` e `subdomain`, mai `query`** | l'identificativo del tenant nella query string finisce nei log di accesso, nel `Referer` e nella cronologia |
| 10 | **Migrazioni forward-only, con expand/contract e snapshot** | `drizzle-kit` non genera `down`, e un `down` su una migrazione distruttiva restituisce lo schema, non i dati: dà una falsa sicurezza |
| 11 | **La Magic Query cambia sintassi**, e la specifica precede il codice | la v5 è l'unica occasione per correggere le incoerenze degli operatori senza rompere due volte |
| 12 | **Il nome dell'ORM esce dall'API pubblica**: il subpath è `/db` | il motore è un dettaglio di implementazione, non un contratto |
| 13 | **PGlite resta per sviluppo e test unitari**, mai per i test di isolamento | non ha pool: rende invisibile l'intera classe di difetti D-01 |
| 14 | **Ogni difetto della sezione 4 si chiude con un test che fallisce prima** | invariante 8 |

---

## 6. Il piano

Nove fasi. **Le fasi non si sovrappongono**, salvo la 8, che tocca solo il core e può
procedere in parallelo dalla fase 2 in poi. Dentro una fase i compiti procedono in parallelo
salvo dipendenze dichiarate.

| Fase | Titolo | Perché in questo punto |
|---|---|---|
| **0** | Preparazione e prove | il banco di prova e la specifica precedono il codice che devono giudicare |
| **1** | La forma del sistema | configurazione, tipi e porte: è lo scheletro su cui si appende tutto il resto |
| **2** | Il data layer su Drizzle | il pezzo grosso: schema, adattatori, Magic Query, manager |
| **3** | Isolamento del tenant | qui muoiono D-01, D-02, D-03: non per correzione, per disegno |
| **4** | Identità e ruoli di sistema | separare chi amministra la piattaforma da chi amministra un tenant. Sblocca la fase 6 |
| **5** | Migrazioni e flotta | senza versioni dello schema non si gestisce più di un contenitore nel tempo |
| **6** | Ciclo di vita del tenant | creazione, export, distruzione: richiede i ruoli (4) e le migrazioni (5) |
| **7** | Contenitore per tenant | il valore nuovo: un database o un file per cliente |
| **8** | Igiene del core e chiusura | sicurezza, difetti minori, guida di migrazione, allineamento dei repo nostri |

---

## Fase 0: preparazione e prove

Obiettivo della fase: **esistono il giudice e la specifica, prima del codice da giudicare.**

### T-0.1 · Branch, versione, catena di verifica

| | |
|---|---|
| **Scopo** | mettere il repository nella forma in cui si lavora per tutta la v5 |
| **File** | `package.json`, `tsconfig.json`, `.github/workflows/ci.yml` |
| **Dipende da** | niente |
| **Chiude** | D-25 |

**Cosa fare.**

1. Si lavora su **`develop`**, già allineato a `main`. `main` resta la v4 e non riceve altro
   che eventuali correzioni di sicurezza per i consumer esistenti.
2. Versione `5.0.0-alpha.0` in `package.json`, e pubblicazione alpha sul tag `v5.0.0-alpha.*`
   con dist-tag `next`, mai `latest`, finché la fase 7 non è chiusa.
3. **Togliere `test` dall'`exclude` di `tsconfig.json`** (D-25): i test devono passare dal
   type-check, altrimenti la loro rottura si scopre a runtime.
4. Nel workflow di CI aggiungere `develop` ai rami che fanno partire la pipeline, e far uscire
   le versioni con suffisso su dist-tag `next`, mai su `latest`. **Il job Postgres reale entra
   insieme alla suite che esegue (T-0.2)**: un cancello che gira a vuoto non è un cancello.
5. **Rimuovere il data layer TypeORM**: `lib/database/typeorm/**`, `typeorm.ts`, le dipendenze
   `typeorm` e `reflect-metadata`, il subpath `/typeorm` da `package.json`, e le suite che
   esistono solo per provarlo (`test/typeorm`, `test/pglite`). Nessuna convivenza: il codice
   vecchio non si corregge, non si consulta come riferimento vivo e non resta «per sicurezza».

**Conseguenza dichiarata, da accettare prima di cominciare.** Con il punto 5 il repository
**non compila e non ha suite verdi** finché il data layer Drizzle non regge le prove: le suite
end-to-end iniettano i manager attraverso `typeorm.ts` e vanno riscritte man mano che la fase 2
avanza. È la scelta fatta il 6 settembre 2026 (punto 26 del verbale). Durante quella finestra:

- `npm run check-all` resta il cancello che deve tornare verde per primo;
- il banco nero di T-0.2 è scritto ma rosso, ed è **giusto** che lo sia: è il criterio di
  accettazione della fase 3, non un test di regressione;
- se serve rileggere il codice rimosso: `git checkout main -- lib/database/typeorm typeorm.ts`,
  oppure `git show main:typeorm.ts`. La storia su `main` non si tocca.

**Come si verifica.** `npm run check-all` e `npm test` passano su `develop`; il workflow
mostra il job Postgres come richiesto sul ramo protetto e sul tag.

### T-0.2 · Banco di prova nero su Postgres reale

| | |
|---|---|
| **Scopo** | rendere osservabile la classe di difetti D-01 e D-02, oggi irraggiungibile perché tutte le suite girano su PGlite, che ha **una sola connessione** |
| **Specifica** | `docs/TESTING_V5.md` §2: harness, ambiente, i sette test da scrivere |
| **File** | nuova suite `test/e2e-mt-pg/`, script npm dedicato, job di CI |
| **Dipende da** | niente: **si scrive per primo** |
| **Chiude** | il vuoto di verifica; è la condizione di accettazione della fase 3 |

**Perché è il primo compito.** È l'unico artefatto di questo piano che **sopravvive al cambio
di ORM**: parla HTTP, non conosce TypeORM né Drizzle. Scritto oggi fallisce sul codice v4;
scritto oggi, deve passare sul codice v5 senza essere modificato. Se per farlo passare
bisogna ritoccarlo, il codice nuovo non ha risolto il problema: lo ha spostato.

**Cosa fare.**

1. Portare un Postgres reale nel ciclo di test: in CI un servizio `postgres:16-alpine`, in
   locale un `docker run` documentato. **Non** aggiungere `testcontainers`: la suite deve
   girare contro un `DATABASE_URL` qualsiasi.
2. Configurare il pool con **`max: 1`**. Rende il riuso della connessione deterministico
   invece che probabilistico. Un secondo scenario con `max: 4` e richieste concorrenti va
   aggiunto, ma quello che sta in CI è `max: 1`, perché non è instabile.
3. Scrivere questi test, che verificano **proprietà osservabili**, non configurazioni:

   | Test | Proprietà |
   |---|---|
   | `lo stato di sessione non sopravvive` | dopo una richiesta autenticata al tenant A, una query eseguita su una connessione presa dal pool vede il piano di controllo, non lo schema di A |
   | `la rotta fuori contesto legge il piano di controllo` | dopo una richiesta al tenant A, l'elenco dei tenant viene dal registro, non da una tabella copiata dentro lo schema di A |
   | `il soggetto non attraversa` | un token di un utente che esiste **solo** dentro il tenant A viene rifiutato su una rotta che dichiara di lavorare sul piano di controllo |
   | `l'impersonificazione non sporca` | dopo un'impersonificazione verso il tenant B, la connessione successiva non è puntata su B |
   | `concorrenza` | N richieste alternate fra due tenant, in parallelo, con `max: 4`: nessuna risposta contiene dati dell'altro tenant |
   | `il tenant sbagliato non si spaccia` | un token firmato per il tenant A con l'header che dichiara il tenant B viene rifiutato, non servito su B |

4. Ogni test deve **fallire** oggi. Se un test passa sul codice v4, è scritto male: verifica
   una configurazione, non una proprietà.

**Attenzione.**

- Non riusare l'harness PGlite: il fenomeno esiste solo con un pool.
- Non usare la scorciatoia di `test/e2e-mt/harness.ts:135` (`resetSearchPath()`): quella
  funzione **è** l'aggiramento del difetto, e la sua presenza rende il test inutile.
- La suite PGlite esistente resta finché copre logica che il porting non ha ancora toccato;
  muore insieme al data layer TypeORM.

### T-0.3 · Le specifiche dei contratti (già scritte)

| | |
|---|---|
| **Scopo** | fissare i contratti **prima** del codice che li implementa: schema, query, manager, ruoli, rotte, configurazione, test |
| **Specifica** | i sei documenti della sezione 0 |
| **File** | `docs/SCHEMA_V5.md`, `docs/MAGIC_QUERY_V5.md`, `docs/MANAGERS_V5.md`, `docs/AUTHORIZATION_V5.md`, `docs/API_V5.md`, `docs/CONFIGURATION_V5.md`, `docs/TESTING_V5.md` |
| **Stato** | **scritte il 6 settembre 2026.** Questo compito è chiuso |
| **Chiude** | l'unica lacuna che impediva l'esecuzione autonoma: i contratti erano descritti a parole e non fissati |

**Cosa resta da fare, ed è una regola, non un compito.** Le specifiche sono vincolanti: si
implementa quello che c'è scritto, non un'interpretazione. Se durante l'implementazione una
specifica risulta sbagliata **nella pratica**, l'ordine è:

1. ci si ferma su quel compito;
2. si corregge il documento, spiegando perché;
3. si aggiorna la tabella di corrispondenza v4 → v5 se il cambiamento è osservabile dall'esterno;
4. poi si scrive il codice.

Mai il contrario, e mai «lo aggiusto nel codice e poi allineo il documento»: è il modo in cui una
promessa scritta smette di essere vera, che è esattamente il difetto D-11.

### T-0.4 · Nessuna decisione implicita: la matrice si scrive qui

| | |
|---|---|
| **Scopo** | avere per iscritto, prima del codice, quali combinazioni motore/strategia esistono |
| **File** | sezione 1 di questo documento (già scritta), poi codice in T-1.4 |
| **Dipende da** | niente |

**Cosa fare.** Nessun codice: verificare che la tabella delle quattro combinazioni della
sezione 1 sia ancora quella che si vuole costruire, e che nessun compito successivo ne
introduca una quinta di straforo. Una casella diventa `sì` **solo** quando esistono il codice
e il test che la reggono.

---

## Fase 1: la forma del sistema

Obiettivo della fase: **la configurazione dichiara due blocchi con motori indipendenti, e il
compilatore impedisce di confonderli.** Alla fine di questa fase non c'è ancora un data layer
funzionante: c'è la forma che il data layer deve riempire.

### T-1.1 · Forma della configurazione: `control` e `tenants`

| | |
|---|---|
| **Scopo** | sostituire la strategia globale con due blocchi dichiarati |
| **Specifica** | `docs/CONFIGURATION_V5.md` §1 e §3 |
| **File** | `lib/config/general.ts`, `lib/loader/general.ts`, `types/global.d.ts` |
| **Dipende da** | niente |
| **Chiude** | D-21 |

**Forma da adottare.**

```
control: { engine: 'postgres' | 'sqlite', ...opzioni }
tenants: {                                   // assente = single tenant
  strategy: 'schema' | 'container',
  engine: 'postgres' | 'sqlite',
  resolver: 'header' | 'subdomain',
  ...opzioni
}
```

- `tenants` assente significa `none`. È la configurazione della maggior parte dei progetti.
- `tenants.strategy: 'schema'` richiede `engine: 'postgres'` e lo stesso server del controllo.
- `tenants.strategy: 'container'` ammette `postgres` (un database per tenant) o `sqlite`
  (un file per tenant).

**Cosa fare.**

1. Sostituire `multi_tenant` con i due blocchi. Nessun alias, nessuna traduzione automatica
   dalla forma vecchia: è una v5 breaking, la conversione sta nella guida (T-8.3).
2. **Fusione profonda** della configurazione del consumer sopra i default (D-21): oggi
   `lib/loader/general.ts:40-43` fa un merge superficiale, quindi dichiarare una sola chiave
   dentro un oggetto cancella le sorelle. Serve una fusione ricorsiva, con gli array
   sostituiti e non concatenati, e un test che lo dimostri.
3. Il default dichiarato deve essere **quello che il codice esegue**. Nessun campo tipizzato,
   documentato e mai letto: è il difetto D-11, e in v5 non deve ripresentarsi in forma nuova.

**Come si verifica.** Un test che dichiara `tenants: { strategy: 'schema' }` e verifica che
`resolver` e le altre chiavi conservino i default; un test che verifica che una combinazione
incoerente non superi il controllo di T-1.4.

### T-1.2 · Due tipi distinti, non due valori dello stesso tipo

| | |
|---|---|
| **Scopo** | invariante 6: la separazione la impone il compilatore, non la disciplina |
| **Specifica** | `docs/MANAGERS_V5.md` §1 |
| **File** | `types/global.d.ts`, ogni chiamante del data layer |
| **Dipende da** | T-1.1 |

**Cosa succede oggi.** `req.db?: EntityManager` e `req.runner?: any` sono entrambi presenti su
ogni richiesta e nulla, a livello di tipo, distingue una connessione al piano di controllo da
una a un tenant. `req.runner` è `any`, quindi anche un valore sbagliato compila.

**Cosa fare.**

1. Introdurre due tipi nominali distinti, `ControlHandle` e `TenantHandle`, con un marcatore
   di tipo (*branded type*) che ne impedisce l'interscambio.
2. Su `FastifyRequest` esporre tre proprietà, distinte per ruolo: **`req.control: ControlHandle`**
   (la connessione al piano di controllo), **`req.tenant?: TenantHandle`** (la connessione al
   contenitore di questa richiesta) e **`req.tenantInfo?: Tenant`** (la riga di registro). Una
   funzione che accetta un `ControlHandle` non deve poter ricevere un `TenantHandle`, e viceversa.
   Connessione e record non stanno nella stessa proprietà: è così che la v4 è finita con un
   `@ts-ignore` su ogni accesso.
3. `req.db` e `req.runner` **spariscono**: niente alias deprecati, è una major.
4. Tipizzare davvero le informazioni del tenant sulla richiesta ed eliminare i `@ts-ignore`
   che oggi le coprono (`lib/api/tenants/controller/tenants.ts:99,106,109,164,199`).

**Attenzione.** È il compito che tocca più superficie pubblica. Va fatto **prima** del data
layer, non dopo: se i tipi arrivano dopo, il porting li insegue.

### T-1.3 · Le porte del data layer e il subpath `/db`

| | |
|---|---|
| **Scopo** | il core dipende da interfacce, non da un ORM |
| **Specifica** | `docs/MANAGERS_V5.md` §9 |
| **File** | nuovo `lib/database/ports/*`, `package.json` (campo `exports`) |
| **Dipende da** | T-1.2 |

**Cosa fare.**

1. Definire le porte, come tipi puri senza implementazione: `ConnectionProvider` (dato un
   tenant, restituisce un handle), `MigrationRunner`, `ContainerLifecycle` (crea, esporta,
   distrugge un contenitore), `CapabilityMatrix`.
2. Il subpath pubblico diventa **`@volcanicminds/backend/db`**. `@volcanicminds/backend/typeorm`
   non esiste più.
3. Il confine `dependency-cruiser` resta e va aggiornato ai nuovi percorsi: il core può
   importare **tipi** dal data layer, mai valori a runtime.

**Attenzione.** Le porte si scrivono guardando i due adattatori che verranno (Postgres e
SQLite), non uno solo: un'interfaccia disegnata su un solo motore diventa quel motore con un
altro nome.

### T-1.4 · Matrice di capacità e rifiuto all'avvio

| | |
|---|---|
| **Scopo** | impedire per costruzione ogni combinazione motore/strategia non supportata |
| **Specifica** | `docs/CONFIGURATION_V5.md` §2 |
| **File** | nuovo `lib/database/capabilities.ts`, aggancio all'avvio |
| **Dipende da** | T-1.1 |
| **Chiude** | D-04 |

**Cosa fare.**

1. Dichiarare in un solo posto quali strategie regge ciascun adattatore:

   | Adattatore | `none` | `schema` | `container` |
   |---|:---:|:---:|:---:|
   | `postgres` | sì | sì | sì (fase 7) |
   | `sqlite` / `libsql` | sì | mai: non esistono schemi | sì (fase 7) |
   | `pglite` | sì, solo sviluppo e test | no: una sola connessione | no |

2. All'avvio, confrontare la configurazione con la matrice. Se la combinazione non è
   supportata: **`log.fatal` con un messaggio che nomina la combinazione e le alternative,
   poi `process.exit(1)`**, nello stile già in uso in `lib/util/secret.ts:104-107`.
3. Rifiutare anche `pglite` con `tenants` dichiarato in `NODE_ENV === 'production'`.

**Come si verifica.** Un test per ogni casella `no`, che verifica l'uscita con codice 1 e il
messaggio atteso. `lib/util/secret.ts` ha già il pattern con `onFatal` iniettabile per non
uccidere il processo di test: replicarlo.

**Attenzione.** La matrice **non** è configurabile dal consumer. È una proprietà del codice.

### T-1.5 · La regola su cosa sta nel piano di controllo

| | |
|---|---|
| **Scopo** | impedire che il piano di controllo diventi il posto delle cose comode |
| **File** | `README.md`, `docs/` |
| **Dipende da** | T-1.1 |

**Regola, da scrivere e da applicare in revisione:**

> Fuori dal contenitore del cliente sta solo ciò che potresti pubblicare.

Nel piano di controllo stanno identificativi, conteggi, stati e configurazione. **Non** stanno
contenuti scritti o caricati dal cliente, nemmeno un titolo. Se una funzione ha bisogno di
leggere dati di più tenant insieme, si progetta come aggregazione esplicita, non risolta
mettendo i dati nel controllo.

---

## Fase 2: il data layer su Drizzle

Obiettivo della fase: **`lib/database/` non contiene più TypeORM, e le quattro combinazioni
della sezione 1 hanno un'implementazione.**

Dipendenze nuove ammesse in questa fase, e solo queste: `drizzle-orm`, `drizzle-kit` (di
sviluppo), `pg` per Postgres, `better-sqlite3` e `@libsql/client` per SQLite e libSQL. Ogni
altra dipendenza va discussa prima.

### T-2.1 · Schema base v5

| | |
|---|---|
| **Scopo** | le entità che il framework possiede: `User`, `Token`, `Tenant`, `Change` |
| **Specifica** | `docs/SCHEMA_V5.md`, per intero |
| **File** | nuovo `lib/database/schema/*` |
| **Dipende da** | T-1.3 |

**Cosa fare.**

1. Definire le quattro tabelle in Drizzle, in due dialetti (Postgres e SQLite), con un unico
   file di verità per la forma logica e due mappature di tipi.
2. **I timestamp nascono `timestamptz`** su Postgres, e interi epoch UTC su SQLite. La
   decisione era già presa e non aveva mai avuto una migrazione: in v5 non serve, è lo schema
   iniziale.
3. Gli identificativi si generano **nel processo**, non cercando la libertà di un UUID con un
   ciclo di query (D-28): un UUID v7 generato in memoria è unico e ordinabile per tempo.
4. La tabella `tenant` appartiene **solo** al piano di controllo. Non viene mai creata dentro
   uno schema o un contenitore di tenant: quella copia inutile è parte della causa di D-01.

**Attenzione.** `Change` (il tracciamento) vive **dentro il contenitore del tenant**, perché
registra modifiche a dati del tenant. Nel piano di controllo ci sta solo se traccia modifiche
del piano di controllo, e allora è un'altra tabella con lo stesso nome, in un altro insieme di
migrazioni (T-5.2).

### T-2.2 · Adattatore Postgres

| | |
|---|---|
| **Scopo** | l'implementazione di riferimento delle porte di T-1.3 |
| **Specifica** | `docs/SCHEMA_V5.md` §1, `docs/CONFIGURATION_V5.md` §2 |
| **File** | nuovo `lib/database/adapters/postgres/*` |
| **Dipende da** | T-2.1 |

**Cosa fare.**

1. Driver `pg` con un pool per contenitore. Il piano di controllo ha il suo pool, dichiarato
   con lo **schema esplicito** (`public` salvo configurazione), mai dedotto dal `search_path`.
2. Per la strategia `schema`, il contesto del tenant si ottiene **qualificando le tabelle**,
   non toccando la sessione: vedi T-3.1, che è il compito dove questa decisione si dimostra.
3. Per la strategia `container` la connessione è dedicata: nessuna qualificazione, il
   contenitore **è** il database. L'implementazione della cache di connessioni è in T-7.1.
4. Esporre un percorso per l'SQL grezzo che sia sempre dentro una transazione (vedi T-3.1),
   così che nessun frammento possa lasciare impostazioni dietro di sé.

### T-2.3 · Adattatore SQLite e libSQL

| | |
|---|---|
| **Scopo** | il motore dei processi senza server e del contenitore consegnabile |
| **Specifica** | `docs/SCHEMA_V5.md` §1, `docs/CONFIGURATION_V5.md` §2 |
| **File** | nuovo `lib/database/adapters/sqlite/*` |
| **Dipende da** | T-2.1 |

**Cosa fare.**

1. Un adattatore, due driver: `better-sqlite3` (locale, sincrono) e `@libsql/client` (locale o
   remoto). **libSQL non è un adattatore**: espone un'API compatibile.
2. Impostare all'apertura di ogni contenitore: `journal_mode = WAL`, `foreign_keys = ON`,
   `busy_timeout` esplicito. Sono impostazioni per connessione, non globali: vanno applicate
   dove si apre, non una volta sola all'avvio.
3. La strategia `schema` **non esiste** su SQLite e la matrice di T-1.4 la rifiuta: non
   esistono schemi, e simularli con prefissi di tabella sarebbe la strategia `row` sotto falso
   nome, vietata dalla decisione 5.
4. Politica dei file: dove nascono, con quali permessi (mai leggibili dal gruppo), quanti
   descrittori restano aperti, come si nominano. Il nome del file **non** è lo slug del
   cliente in chiaro se il filesystem è condiviso.

**Attenzione.** Gli operatori della Magic Query che su SQLite non esistono vanno gestiti come
dice la specifica di T-0.3: reimplementati o rifiutati con 400. Mai ignorati.

### T-2.4 · Magic Query v5

| | |
|---|---|
| **Scopo** | il traduttore da query string a query, sopra Drizzle, secondo la specifica |
| **Specifica** | `docs/MAGIC_QUERY_V5.md`, per intero |
| **File** | nuovo `lib/database/query/*` |
| **Dipende da** | T-0.3, T-2.2, T-2.3 |
| **Chiude** | D-06, D-12, D-13 |

**Cosa fare.**

1. Implementare **esattamente** la specifica di T-0.3. Se durante l'implementazione la
   specifica risulta sbagliata, si corregge la specifica e poi il codice, mai il contrario in
   silenzio.
2. Nessun ripiego su un manager globale quando manca il contesto (D-06): senza contesto si
   **lancia**. Dopo T-3.3 il manager globale non esiste nemmeno più.
3. `_logic` con limiti di lunghezza e profondità, **400** oltre il limite (D-13).
4. L'operatore `:raw` **non entra in v5**. Interpolare una stringa dell'utente dentro SQL è
   una via di attraversamento dei confini (D-12); chi ha bisogno di SQL arbitrario lo scrive
   nel proprio codice, non lo riceve dalla rete.
5. Ogni operatore dichiara i motori su cui esiste. Un operatore chiesto su un motore che non
   lo ha risponde 400 con un messaggio che nomina l'operatore e il motore.

**Come si verifica.** La stessa batteria di query eseguita sui due motori, con gli stessi dati
e lo stesso risultato atteso, e l'elenco degli operatori non portabili che risponde 400 dove
deve.

### T-2.5 · I manager riscritti

| | |
|---|---|
| **Scopo** | `userManager`, `tokenManager`, `tenantManager`, `dataBaseManager`, `mfaManager` sopra Drizzle |
| **Specifica** | `docs/MANAGERS_V5.md` §3-§8 |
| **File** | nuovo `lib/database/managers/*` |
| **Dipende da** | T-2.1, T-2.2 |
| **Chiude** | D-28 |

**Cosa fare.** Portare le funzioni una a una, con la firma che **richiede il contesto** invece
di dedurlo: ogni funzione che tocca dati di un tenant riceve un `TenantHandle`, ogni funzione
che tocca il registro riceve un `ControlHandle`. Nessuna funzione «prende quello che trova».

**Attenzione.** Le proprietà già corrette elencate nell'appendice B vanno **portate, non
reinventate**: confronto di password a costo costante anche per email inesistenti, risposta
uniforme di `forgot-password`, verifica della firma anche sul token scaduto in fase di
rinnovo. Sono il risultato di correzioni precedenti: perderle nel porting è una regressione di
sicurezza, non un dettaglio.

### T-2.6 · Derivazione di chiave non bloccante

| | |
|---|---|
| **Scopo** | eliminare D-14: 82 ms di event loop bloccato per ogni verifica MFA |
| **File** | nuovo `lib/database/crypto.ts` |
| **Dipende da** | T-2.5 |
| **Chiude** | D-14 |

**Cosa fare.** `crypto.scrypt` asincrono al posto di `scryptSync`, con `encrypt` e `decrypt`
asincroni. Il formato del dato cifrato resta `v2:salt:iv:authTag:ciphertext` e AES-256-GCM con
derivazione per record: cambia solo la forma della chiamata.

**Attenzione.** In v5 non serve leggere i tre formati storici che il codice v4 accetta, ma i
dati dei progetti che migrano sì: la guida di T-8.3 deve dire come si rilegge il pregresso, o
il porting va fatto mantenendo la lettura dei formati vecchi e scrivendo solo il nuovo.

---

## Fase 3: isolamento del tenant

Obiettivo della fase: **nessuna richiesta può leggere i dati di un tenant che non è il
proprio, e la prova è il banco nero di T-0.2, che passa senza essere stato modificato.**

### T-3.1 · Contesto tenant senza stato di sessione

| | |
|---|---|
| **Scopo** | rendere D-01 e D-02 **impossibili**, non corretti |
| **File** | `lib/database/adapters/postgres/*`, `lib/loader/tenant.ts`, `lib/hooks/onResponse.ts` |
| **Dipende da** | T-2.2 |
| **Chiude** | D-01, D-02 |

**Il difetto di cui si sta parlando.** In v4 il contesto del tenant è un `SET search_path`
eseguito sulla connessione. La connessione torna nel pool con quell'impostazione addosso
perché il reset è registrato come listener su `finish` e Fastify rilascia il `QueryRunner`
prima, dagli hook `onResponse` (appendice A.1). Né `pg-pool` né il driver eseguono un reset
alla riconsegna. La richiesta successiva, su quella connessione, legge lo schema di un altro
cliente (appendice A.2).

**La forma che elimina il difetto.** Il contesto del tenant **non** vive nella sessione.

1. **Tabelle qualificate.** Con Drizzle, `pgSchema('tenant_acme').table(...)` produce SQL già
   qualificato: `select ... from "tenant_acme"."user"`. Le definizioni si costruiscono con una
   fabbrica, una volta per schema, e si tengono in una cache in memoria (sono oggetti puri,
   non connessioni: costano nulla). Nessun `SET`, nessuno stato da ripulire, nessun ordine di
   rilascio da rispettare: **la connessione torna al pool identica a com'è uscita**.
2. **L'SQL grezzo, quando serve, sta dentro una transazione.** Se un percorso ha davvero
   bisogno di `search_path` (per esempio le migrazioni), si usa
   `db.transaction(tx => { tx.execute(sql`set local search_path to ...`); ... })`: `SET LOCAL`
   è annullato dal commit o dal rollback per definizione, quindi non sopravvive comunque.
3. **Divieto assoluto**: nessun `SET search_path` fuori da una transazione, in nessun punto
   del data layer. È una regola verificabile con un grep in CI.
4. **Un solo punto di rilascio.** Il rilascio della connessione avviene in un hook
   `onResponse` dedicato del data layer, non sparso fra `lib/hooks/onResponse.ts` e un
   listener su `reply.raw`. Se il client abortisce, il rilascio di sicurezza aggancia
   `reply.raw.on('close')` e, se la connessione non è stata già rilasciata, la restituisce
   **passando un errore**, così il pool non la riusa.

**Effetto collaterale utile.** Questa forma è compatibile con PgBouncer in modalità
transaction, che T-7.1 raccomanda sopra i 100 tenant: nessuna impostazione di sessione da
preservare fra transazioni.

**Come si verifica.** Il banco nero di T-0.2 passa senza modifiche. In più, un test unitario
che, dato un doppio del pool, verifica che nessuna query emessa contenga `set search_path`
fuori da una transazione.

**Attenzione.** La fabbrica di tabelle qualificate ha una cache: va tenuta limitata come
qualsiasi cache (un tenant cancellato non deve restare in memoria per sempre) e **non deve
mai** essere indicizzata su un nome di schema non sanificato. La sanificazione resta come in
v4, dove è già corretta (appendice B).

### T-3.2 · Il tenant si lega al token, non all'header

| | |
|---|---|
| **Scopo** | eliminare D-03, D-11, D-19: oggi il controllo anti-spoofing è codice morto e il tenant è deciso solo da un header |
| **Specifica** | `docs/AUTHORIZATION_V5.md` §5 |
| **File** | `lib/hooks/onRequest.ts`, `lib/loader/tenant.ts`, `lib/config/general.ts` |
| **Dipende da** | T-1.1, T-1.2 |
| **Chiude** | D-03, D-11, D-19 |

**Cosa succede oggi.** `resolveTenant` legge `req.user?.tid`, ma l'hook del tenant gira prima
di quello di autenticazione e l'entità `User` non ha nessun campo `tid`: il confronto non
scatta mai e il tenant lo decide solo l'header.

**Cosa fare.**

1. **La risoluzione del tenant sta nel core**, non nel data layer: il core legge il token
   (header `Authorization` o cookie), ne verifica la firma, ne estrae il `tid` e passa al data
   layer **solo l'identificativo del tenant**. Il data layer non conosce i token. Questo
   rispetta il confine `dependency-cruiser` senza creare una seconda verità sulla validità dei
   token.
2. **Il token prevale sempre sull'header.** Se il token porta un `tid` e l'header ne dichiara
   un altro, la richiesta si **rifiuta**, non si sceglie il più probabile.
3. L'header (o il sottodominio) è ammesso **solo** per le richieste senza token: rotte
   pubbliche e login. Sono le uniche in cui il tenant non può venire dal token.
4. **Resolver**: `header` e `subdomain`, mai `query`. Una sola fonte attiva per volta: se il
   resolver configurato è `subdomain`, l'header **viene ignorato**, non usato come alternativa.
   Due fonti concorrenti per la stessa decisione sono la causa originale di D-03.
5. Il **rinnovo del token** verifica il `tid` come tutte le altre rotte (D-19). Oggi non lo
   fa, e diventa sfruttabile appena esiste un archivio utenti condiviso, cioè in fase 4.

**Come si verifica.** Il test «il tenant sbagliato non si spaccia» di T-0.2. In più: una
richiesta con token del tenant A e header del tenant B risponde 4xx; una richiesta di login
senza token risolve il tenant dall'header o dal sottodominio secondo configurazione.

### T-3.3 · Nessun contesto implicito: sparisce la connessione globale

| | |
|---|---|
| **Scopo** | invariante 3: in multi-tenant una query senza contesto esplicito è un errore, mai una lettura del piano di controllo |
| **File** | tutto il data layer, `lib/api/**` |
| **Dipende da** | T-3.1 |

**Cosa fare.** In v5 non esiste un `global.connection` né un `global.repository`. Chi ha
bisogno del piano di controllo riceve un `ControlHandle`; chi ha bisogno di un tenant riceve un
`TenantHandle`. Le rotte che oggi dichiarano `tenantContext: false` diventano rotte che
dichiarano di lavorare **sul piano di controllo**, e ricevono l'handle giusto per tipo.

**Attenzione.** Il default resta quello corretto della v4: una rotta lavora nel contesto del
tenant **salvo che dichiari il contrario** (`lib/loader/router.ts:159`). Non invertirlo.

### T-3.4 · I lavori schedulati dichiarano il contesto

| | |
|---|---|
| **Scopo** | eliminare D-07: oggi un job gira senza contesto tenant, quindi su una connessione qualsiasi del pool |
| **File** | `lib/loader/schedules.ts` |
| **Dipende da** | T-3.3 |
| **Chiude** | D-07 |

**Cosa fare.** Un job dichiara nella propria definizione **dove** gira: sul piano di controllo,
su un tenant nominato, oppure **su tutti i tenant** (e allora il framework lo esegue una volta
per tenant, con il contesto giusto, e riporta i fallimenti per tenant senza fermare gli altri).
Un job che non dichiara nulla gira sul piano di controllo. La funzione del job riceve l'handle
come argomento: non lo cerca.

**Attenzione.** L'esecuzione «su tutti i tenant» ha lo stesso profilo di rischio del migratore
di flotta: va limitata in concorrenza e deve poter essere interrotta.

### T-3.5 · Il tracciamento riceve il contesto

| | |
|---|---|
| **Scopo** | eliminare D-05: oggi in multi-tenant l'audit trail non scrive **nulla** e il `catch` silenzioso lo nasconde |
| **Specifica** | `docs/MANAGERS_V5.md` §7 |
| **File** | `lib/util/tracker.ts` |
| **Dipende da** | T-3.3 |
| **Chiude** | D-05 |

**Cosa fare.**

1. Il tracker riceve l'handle del contesto della richiesta e scrive `Change` **dentro il
   contenitore del tenant**.
2. **Default: un errore di tracciamento fa fallire la richiesta**, con un codice di errore
   identificabile. Una scrittura non tracciata su un sistema che promette audit è peggio di un
   errore visibile.
3. La rotta può dichiarare esplicitamente il contrario (`tracking: { strict: false }`) quando
   il tracciamento è accessorio. Il README documenta le due modalità e dice qual è il default.

**Come si verifica.** Un test in multi-tenant che esegue una modifica su una rotta tracciata e
verifica che la riga di `Change` esista **nel contenitore del tenant**; un test che, con la
scrittura di `Change` resa impossibile, verifica il 500 in modalità stretta e il 200 con
`strict: false`.

### T-3.6 · La cache non attraversa i contenitori

| | |
|---|---|
| **Scopo** | eliminare D-15 e D-26 |
| **File** | `lib/util/cache.ts`, cache del data layer |
| **Dipende da** | T-3.1 |
| **Chiude** | D-15, D-26 |

**Cosa fare.**

1. Ogni chiave di cache, a qualsiasi livello, include **l'identificativo del contenitore**. In
   v4 la cache di risposta lo fa già ed è corretta (appendice B); la cache del data layer no,
   perché la chiave è l'SQL e in multi-tenant per schema l'SQL è identico fra tenant (D-15).
   Con le tabelle qualificate di T-3.1 l'SQL torna a essere diverso, ma la chiave deve
   contenere il contenitore **comunque**, in modo esplicito: non ci si affida a una proprietà
   emergente.
2. La cache di risposta è in memoria per processo, quindi l'invalidazione dichiarata da una
   rotta non raggiunge le altre istanze (D-26). Due strade ammesse: dichiararlo nel README come
   limite noto (e allora il TTL va tenuto basso), oppure mettere una porta con un adattatore
   Redis. **Decidere e scriverlo**: il difetto oggi è che non è documentato.

---

## Fase 4: identità e ruoli di sistema

Obiettivo della fase: **chi amministra la piattaforma e chi amministra un tenant sono cose
diverse per tipo, non per fortuna.**

Oggi la differenza fra il super-admin e l'admin di un tenant poggia **solo** su quale schema
risolve la tabella `user`, cioè esattamente ciò che D-01 rompe. Finché resta così, ogni
operazione amministrativa è a un difetto di distanza da un'elevazione di privilegi.

### T-4.1 · Utenti e ruoli di sistema nel piano di controllo

| | |
|---|---|
| **Scopo** | separare l'identità di piattaforma dall'identità dentro un tenant |
| **Specifica** | `docs/AUTHORIZATION_V5.md` §2-§4 |
| **File** | `lib/database/schema/*`, `lib/middleware/authz.ts`, `lib/api/auth/*` |
| **Dipende da** | fase 3 chiusa |

**Cosa fare.**

1. Gli utenti di sistema vivono **nel piano di controllo**, con ruoli propri, in un insieme
   distinto dai ruoli dentro un tenant. Un ruolo di tenant non può nominare un permesso di
   sistema, e il compilatore lo impedisce (sono due tipi, come in T-1.2).
2. Il token di un utente di sistema **non porta un `tid`**: porta un ambito di sistema, e le
   rotte di piattaforma lo richiedono esplicitamente.
3. Un utente di sistema che opera dentro un tenant lo fa **solo** per impersonificazione
   (T-4.2), che lascia traccia. Non esiste un percorso silenzioso.

**Attenzione.** È il compito che sblocca la distruzione dei dati di un tenant (T-6.3). Finché
non è chiuso, quella operazione non si espone.

### T-4.2 · Impersonificazione tracciata

| | |
|---|---|
| **Scopo** | eliminare D-18 |
| **Specifica** | `docs/AUTHORIZATION_V5.md` §6, `docs/SCHEMA_V5.md` §3.3 |
| **File** | `lib/api/tenants/*` |
| **Dipende da** | T-4.1 |
| **Chiude** | D-18 |

**Cosa fare.** L'impersonificazione **persiste un record** nel piano di controllo: chi, verso
quale tenant e quale utente, quando, da quale indirizzo, con quale motivo dichiarato. Durata
breve e configurabile (non le 24 ore di oggi). Il claim nel token resta, ma non è più l'unica
traccia. Spariscono la stringa magica `'system'` e il ramo morto che la confronta con un campo
inesistente.

### T-4.3 · «Fondatore» si risolve nel contenitore, non nel processo

| | |
|---|---|
| **Scopo** | eliminare D-27 |
| **Specifica** | `docs/AUTHORIZATION_V5.md` §7 |
| **File** | `lib/util/authz.ts` |
| **Dipende da** | T-4.1 |
| **Chiude** | D-27 |

**Cosa fare.** Oggi `isFounderEmail` confronta con una variabile d'ambiente di processo: in
multi-tenant la stessa email è «fondatore» dentro **ogni** tenant. In v5 il fondatore è una
proprietà **della riga utente nel suo contenitore**, non dell'ambiente. La variabile
d'ambiente resta ammessa solo per la genesi del primo utente di sistema.

---

## Fase 5: migrazioni e migratore di flotta

Obiettivo della fase: **ogni contenitore ha un numero di versione, si porta avanti in modo
ripetibile e riprendibile, e il server rifiuta di servire uno schema disallineato.**

### T-5.1 · Motore, formato, collocazione della versione

| | |
|---|---|
| **Scopo** | stabilire come si scrivono e si applicano le migrazioni |
| **File** | `drizzle.config.ts`, `lib/database/migrations/*` |
| **Dipende da** | fase 2 chiusa |

**Cosa fare.**

1. `drizzle-kit generate` produce **SQL leggibile**, che si committa. È il formato: nessuna
   classe generata da interpretare.
2. **Forward-only.** Nessun `down`: `drizzle-kit` non lo genera, e un `down` su una migrazione
   distruttiva restituisce la forma, non i dati. La reversibilità sta nel disegno, non in uno
   script che mente.
3. **Expand/contract, regola scritta nel README**: la migrazione che accompagna un rilascio è
   **additiva** (nuova colonna, nuova tabella, doppia scrittura); la parte distruttiva esce in
   una release successiva, quando il codice nuovo è in esercizio ovunque. Così si torna
   indietro rilasciando il codice vecchio, senza toccare i dati.
4. La versione applicata si registra **dentro ogni contenitore migrato**, nella tabella di log
   di Drizzle. Mai in una tabella centrale: se un tenant viene ripristinato da un backup, la
   sua versione deve tornare indietro insieme a lui.
5. Le migrazioni delle entità del framework stanno **nel framework**; quelle delle entità del
   consumer stanno **nel consumer**. Il framework fornisce il motore che le applica.
6. `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP` e `POST /tool/synchronize-schemas` **non esistono in
   v5**: sono incompatibili con uno schema versionato.

### T-5.2 · Due insiemi di migrazioni

| | |
|---|---|
| **Scopo** | il piano di controllo e i tenant hanno cicli di vita diversi |
| **Dipende da** | T-5.1 |

**Cosa fare.** Due cartelle e due comandi distinti: uno per il piano di controllo (applicato
una volta) e uno per i contenitori dei tenant (applicato N volte). Le entità che vivono in
entrambi si duplicano esplicitamente: **non** si condivide lo stesso file di migrazione fra i
due insiemi. La tabella `tenant` sta solo nel primo insieme.

### T-5.3 · Migratore di flotta

| | |
|---|---|
| **Scopo** | portare N contenitori alla versione richiesta in modo ripetibile |
| **File** | `bin/` del pacchetto, più API programmatica esportata |
| **Dipende da** | T-5.2 |

**Doppia superficie, entrambe obbligatorie**: un comando (`npx volcanic migrate --tenants`) per
l'operatore, e una funzione esportata per chi lo invoca da uno script o da un job proprio. Le
due condividono l'implementazione: il comando è un involucro sottile.

**Requisiti non negoziabili.**

| Requisito | Cosa significa in pratica |
|---|---|
| **Prova a secco** | `--dry-run` mostra cosa farebbe, contenitore per contenitore, senza farlo. È il default consigliato nella documentazione |
| **Snapshot dichiarato** | senza `--snapshot <riferimento>` il comando **rifiuta di partire**; il riferimento viene registrato nel log della corsa. È l'unico modo di tornare indietro, quindi è obbligatorio |
| **Idempotenza** | eseguire due volte lo stesso comando non produce effetti diversi dal primo |
| **Ripresa** | un'interruzione a metà lascia lo stato consistente e la ripartenza riprende dal primo contenitore non completato |
| **Lock** | due esecuzioni concorrenti non possono lavorare sullo stesso contenitore. Su Postgres un advisory lock derivato dall'identificativo del contenitore; su file, un lock sul filesystem |
| **Fallimento parziale esplicito** | se 3 contenitori su 100 falliscono, il comando esce con codice non zero e stampa **quali**, non un totale |
| **Ordine controllabile** | poter migrare un sottoinsieme, per riprovare i falliti o per un rilascio graduale |
| **Concorrenza limitata** | un parametro esplicito, con default basso: cento migrazioni in parallelo saturano il database che stanno migrando |

**Attenzione.** È la parte con il rischio più alto di tutto il piano: un difetto nel router
rompe una rotta, un difetto qui rompe i database di clienti diversi. Va provato contro una
flotta di almeno 20 contenitori, con un'interruzione forzata a metà corsa fra i casi di test.

### T-5.4 · Controllo di allineamento all'avvio

| | |
|---|---|
| **Scopo** | non servire traffico su uno schema disallineato |
| **Dipende da** | T-5.3 |

**Cosa fare.** All'avvio il framework confronta la versione attesa dal codice con quella
registrata nel piano di controllo: se sono diverse, **rifiuta di avviarsi**. Per i tenant il
controllo si fa alla risoluzione del tenant: un contenitore disallineato risponde con un errore
esplicito e viene registrato, senza bloccare gli altri.

**Attenzione.** Il comportamento va reso disattivabile per il rilascio graduale, ma il default
è il rifiuto: è l'invariante 2.

---

## Fase 6: ciclo di vita del tenant

Obiettivo della fase: **un tenant si crea utilizzabile, si esporta e si distrugge, e ogni
passaggio lascia traccia.**

### T-6.1 · Creazione

| | |
|---|---|
| **Scopo** | eliminare D-08 e D-20 |
| **Specifica** | `docs/API_V5.md` §6.1, `docs/SCHEMA_V5.md` §4 |
| **Dipende da** | fase 5 chiusa |
| **Chiude** | D-08, D-20 |

**Cosa fare.**

1. La creazione **applica le migrazioni** al contenitore nuovo (non sincronizza uno schema da
   metadati) e registra la versione raggiunta.
2. L'admin seminato alla creazione è **utilizzabile subito**: `adminConfirmed` esplicito nel
   corpo della richiesta, con default `true` per il percorso di provisioning amministrativo.
   `POST /auth/register` continua a creare utenti non confermati: sono due percorsi diversi.
3. Il nome del contenitore si sanifica **una volta sola, prima del salvataggio**, e se il
   valore sanificato differisce da quello ricevuto la richiesta risponde **400**: non si
   accetta in silenzio un nome diverso da quello chiesto (D-20).

### T-6.2 · Export del contenitore

| | |
|---|---|
| **Scopo** | poter consegnare, archiviare e ripristinare i dati di un cliente |
| **Dipende da** | T-6.1 |

**Cosa fare.** Un'operazione di export per contenitore: `pg_dump` limitato allo schema o al
database per Postgres, copia coerente del file (con checkpoint WAL) per SQLite e libSQL.
L'export dichiara la versione dello schema al momento dell'esecuzione. Se il binario necessario
non è disponibile, l'operazione **fallisce**: non produce un export parziale.

### T-6.3 · Distruzione a due fasi

| | |
|---|---|
| **Scopo** | eliminare D-09: oggi `deleteTenant` è una cancellazione logica del registro e i dati restano |
| **Specifica** | `docs/API_V5.md` §6.2, `docs/SCHEMA_V5.md` §3.4 |
| **Dipende da** | T-4.1, T-6.2 |
| **Chiude** | D-09 |

**Il flusso, per intero.**

1. **Fase 1, richiesta.** Rotta riservata al ruolo di sistema. Restituisce un **token monouso
   a scadenza breve** (dieci minuti) e l'elenco esatto di ciò che verrà distrutto: nome del
   contenitore, dimensione, numero di righe per tabella, data dell'ultimo export.
2. **Fase 2, esecuzione.** La chiamata di distruzione porta **nel corpo**, mai nell'URL: il
   token, lo slug del tenant ripetuto a mano, e un secondo fattore, che è il **TOTP MFA
   dell'operatore** se ne ha uno, altrimenti un codice monouso spedito per email.
3. **Export obbligatorio prima di distruggere.** Si distrugge solo se l'export di T-6.2 è
   riuscito e il file esiste e non è vuoto. Il riferimento all'export finisce nel record
   dell'operazione.
4. L'evento si registra **prima** dell'esecuzione, non dopo. L'operazione è idempotente: la
   seconda chiamata sullo stesso tenant già distrutto risponde senza errore e senza effetti.

**Attenzione.** Il token nell'URL sarebbe finito negli access log del proxy, nella cronologia e
nei sistemi di tracciamento: per questo sta nel corpo. La documentazione deve dire chiaramente
che **sui backup il dato resta** finché il backup non scade.

---

## Fase 7: contenitore per tenant

Obiettivo della fase: **il framework sa dare a ogni tenant un contenitore proprio, che si può
consegnare, ripristinare e distruggere.**

### T-7.1 · Contenitore su Postgres: un database per tenant

| | |
|---|---|
| **Scopo** | isolamento forte con backup e ripristino per tenant |
| **Dipende da** | fase 6 chiusa |
| **Chiude** | D-10 |

**Il vincolo misurato, da rispettare nel disegno.** Un `DataSource` TypeORM per tenant costa 44
KiB di heap e 9,6 ms di inizializzazione, che è trascurabile, ma tiene **almeno una connessione
aperta**: con `max_connections = 100`, 150 contenitori falliscono con `sorry, too many clients
already` (appendice A.3). Drizzle è più leggero come oggetto, ma **il vincolo non cambia**: è
la connessione, non l'ORM.

**Dimensionamento di riferimento: da 50 a 300 tenant per istanza.**

1. Le connessioni per tenant si aprono **su richiesta** e si tengono in una cache **LRU con
   limite esplicito**, molto sotto `max_connections`: ordine di venti contenitori vivi, non
   uno per tenant.
2. Il contenitore inattivo da più di N minuti si chiude.
3. Il limite della cache e la dimensione dei pool si verificano **all'avvio** contro il
   `max_connections` del server: se il prodotto supera il disponibile, si rifiuta l'avvio.
4. Sopra i 100 tenant, **PgBouncer in modalità transaction** è la configurazione consigliata e
   va documentata. In quella modalità non si usano prepared statement lato sessione: la forma
   di T-3.1, che non tiene stato di sessione, è già compatibile.

### T-7.2 · Contenitore su file: SQLite e libSQL

| | |
|---|---|
| **Scopo** | il contenitore consegnabile e distruggibile, e il motore dei processi senza server |
| **Dipende da** | T-7.1 |

**Cosa fare.** Un file per tenant, aperto su richiesta e chiuso per inattività come in T-7.1,
con un limite esplicito di descrittori aperti. Politica di creazione, permessi, nomi e backup
come in T-2.3. Gli operatori della Magic Query non portabili si comportano come dice la
specifica di T-0.3.

### T-7.3 · Replica continua dietro una porta

| | |
|---|---|
| **Scopo** | copia continua del contenitore, senza scrivere un replicatore |
| **Dipende da** | T-7.2 |

**Cosa fare.** Una porta `replica` con **Litestream** come prima e unica implementazione. Non
scrivere un replicatore proprio: Litestream è un binario esistente e copre il caso dei file in
chiaro, che è la totalità dei casi previsti.

**Attenzione.** Se un progetto futuro chiede file **cifrati a pagina**, Litestream non basta:
è un progetto a sé, non una variante di questo compito.

---

## Fase 8: igiene del core e chiusura

Obiettivo della fase: **ciò che il framework espone è sicuro per default, e chi arriva dalla v4
sa cosa deve cambiare.**

I compiti T-8.1 e T-8.2 toccano **solo il core** e possono procedere in parallelo dalla fase 2
in poi. T-8.3 e T-8.4 si chiudono per ultimi, quando l'API è stabile.

### T-8.1 · Sicurezza del core

| | |
|---|---|
| **Scopo** | eliminare D-16, D-17, D-22 |
| **Specifica** | `docs/API_V5.md` §2.1, `docs/CONFIGURATION_V5.md` §5 |
| **Dipende da** | niente |
| **Chiude** | D-16, D-17, D-22 |

**Cosa fare, in questo ordine.**

1. **D-22, dipendenze**: `npm audit fix`, poi rieseguire `npm audit --omit=dev` e riportare
   l'esito nel commit. Alla data del rilievo: 6 vulnerabilità in produzione, 5 alte, fra cui il
   router di Fastify. In v5 si può accettare anche il cambio maggiore di `@fastify/static`.
2. **D-16, CORS**: il default diventa un'allowlist esplicita letta da variabile d'ambiente, con
   `credentials: true` **solo** se l'allowlist non è `*`. La combinazione `origin: '*'` con
   `credentials: true` **rifiuta l'avvio in produzione**: i browser la rifiutano comunque, e in
   modalità bearer lascia l'API richiamabile da qualunque origine.
3. **D-17, enumerazione**: i messaggi di `register` e `login` diventano uniformi verso il
   client. La causa reale resta nei log e in un codice interno non esposto. Verificato che
   nessun backoffice nostro dipende dai messaggi distinti: `volcanic-admin` non contiene
   nessuna di quelle stringhe. `PASSWORD_TO_BE_CHANGED` può restare distinto, perché arriva
   dopo una verifica riuscita della password.

### T-8.2 · Raccolta dei difetti minori

| | |
|---|---|
| **Scopo** | chiudere D-23, D-24, D-29 |
| **Dipende da** | niente |
| **Chiude** | D-23, D-24, D-29 |

1. **D-23**: l'hook `onError` rispetta `HIDE_ERROR_DETAILS` come già fa il gestore d'errore di
   `index.ts:216`. Oggi restituisce il messaggio dell'eccezione sui 500.
2. **D-24**: il refuso `tomezone` invece di `timezone` in `lib/loader/schedules.ts:111` fa
   ignorare in silenzio il fuso orario dei job cron.
3. **D-29**: `req.data()` restituisce la query string **oppure** il corpo, mai i due insieme:
   una `POST /auth/login?x=1` con le credenziali nel corpo fallisce con «Email not valid». In
   v5 la fusione è esplicita e documentata, con la precedenza dichiarata.

### T-8.3 · Guida di migrazione v4 → v5

| | |
|---|---|
| **Scopo** | la compatibilità è un documento, non un ramo `if` |
| **File** | nuovo `docs/MIGRATION_V4_V5.md` |
| **Dipende da** | fasi 1-7 chiuse |

**Cosa contiene.** Per ogni rottura: cosa cambia, perché, e la forma nuova accanto alla vecchia.
L'elenco delle rotture note, che è anche l'indice del documento:

| Cambia | Da | A |
|---|---|---|
| Subpath del data layer | `@volcanicminds/backend/typeorm` | `@volcanicminds/backend/db` |
| ORM | TypeORM 0.3.x | Drizzle |
| Motori | Postgres, PGlite, Mongo (dichiarato) | Postgres, SQLite, libSQL |
| Configurazione | `options.multi_tenant` | blocchi `control` e `tenants` |
| Contesto sulla richiesta | `req.db`, `req.runner` | `req.control`, `req.tenant`, tipizzati e non interscambiabili |
| Resolver | `subdomain` dichiarato, `header` eseguito, `query` tipizzato | `header` e `subdomain`, entrambi implementati; `query` rimosso |
| Magic Query | sintassi v4 | sintassi v5, tabella di corrispondenza in `docs/MAGIC_QUERY_V5.md` |
| Operatore `:raw` | dietro variabile d'ambiente | rimosso |
| Schema | `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP`, `POST /tool/synchronize-schemas` | migrazioni versionate, entrambi rimossi |
| Cifratura | `encrypt` / `decrypt` sincroni | asincroni |
| Messaggi di autenticazione | distinti per causa | uniformi verso il client |
| Tracciamento | silenziosamente inattivo in multi-tenant | attivo, e per default fa fallire la richiesta se non riesce |

### T-8.4 · Allineamento dei repository nostri

| | |
|---|---|
| **Scopo** | dimostrare che la guida funziona |
| **Dipende da** | T-8.3 |

**Cosa fare.** Portare **`volcanic-backend-sample`** alla v5: è la documentazione eseguibile, e
il porting è la prova che la guida è completa. Poi **`volcanic-admin`**, che dipende dalla
sintassi della Magic Query e va allineato alla tabella di corrispondenza di T-0.3. Ogni punto
in cui la guida risulta insufficiente si corregge nella guida, non solo nel repository.

---

## 7. Compatibilità e versionamento

Il pacchetto è pubblicato su npm e ha consumer in esercizio, **tutti in single tenant**.

| | |
|---|---|
| `main` | resta la linea **4.x**. Riceve solo correzioni di sicurezza, se emergono |
| `develop` | è la linea **5.x**. Pubblica alpha e beta con dist-tag `next` |
| `latest` | passa alla 5 solo a fase 7 chiusa e con T-8.3 scritta |

**La v5 è breaking e non finge il contrario.** Non si scrive codice di compatibilità, non si
tengono alias deprecati, non si accetta la forma vecchia della configurazione. Chi aggiorna
legge la guida. Ogni compito che cambia un comportamento osservabile **aggiunge la sua riga
alla tabella di T-8.3 nello stesso commit**: la guida non si scrive alla fine, si accumula.

---

## 8. Definizione di «fatto»

Un compito è chiuso quando **tutte** queste condizioni sono vere. Non è chiuso se ne manca una.

1. Esiste un test che **falliva prima** della modifica e **passa dopo**. Per i compiti di
   isolamento, il test verifica una proprietà osservabile, non una configurazione.
2. `npm run check-all` passa (lint, type-check compresi i test, `depcruise`).
3. `npm test` passa, zero falliti.
4. **Il banco nero di T-0.2 passa**, e non è stato modificato per farlo passare.
5. Ogni file **nuovo o riscritto** del data layer e del percorso tenant sta **sopra l'85% di
   copertura di righe**. Per i file non toccati vale la regola del non peggioramento
   (riferimento del rilievo: righe 79,7%, rami 72,1%).
6. `README.md` e i documenti in `docs/` che descrivono la parte toccata sono aggiornati **nello
   stesso commit**. Se una promessa del README non è più vera, si corregge il README.
7. Se il comportamento pubblico cambia, la riga nella tabella di T-8.3 è scritta.
8. La casella corrispondente in `docs/AUDIT_TASKS_TODO.md` è aggiornata, se il compito ne
   chiude una.

---

## 9. Glossario

| Termine | Significato preciso in questo documento |
|---|---|
| **Tenant** | un cliente dell'applicazione, i cui dati non devono essere raggiungibili da un altro cliente |
| **`none`** | non esiste il concetto di tenant: c'è un cliente solo. Ciò che l'applicazione chiama `companyId` è una colonna di dominio, non una promessa del framework |
| **`schema`** | i dati di ogni tenant stanno in un gruppo di tabelle proprio, **dentro lo stesso database**. Li separa quale gruppo di tabelle si apre. Non dà una chiave, né un backup, né un ripristino per tenant |
| **`container`** | i dati di ogni tenant stanno in un **database o in un file proprio**. Li separa quale contenitore si apre. Dà backup, ripristino e distruzione per tenant |
| **Contenitore** | il termine che comprende tutti e tre i casi: lo schema, il database dedicato, il file. Ciò che si apre per lavorare su un tenant |
| **Piano di controllo** | il database che contiene il registro dei tenant, gli utenti di sistema e ciò che è comune. **Non** contiene dati dei clienti |
| **Tabella qualificata** | una definizione di tabella che porta il nome dello schema dentro di sé, così che l'SQL emesso sia `"tenant_acme"."user"` e non dipenda da alcuna impostazione di sessione. È il meccanismo di T-3.1 |
| **Expand/contract** | la disciplina per cui una migrazione che accompagna un rilascio è additiva, e la parte distruttiva esce in una release successiva. Sostituisce il `down` |
| **Banco nero** | la suite di T-0.2: verifica proprietà osservabili via HTTP, non conosce l'ORM, sopravvive alla riscrittura |
| **Magic Query** | il traduttore da parametri di query string a query del data layer |
| **Manager** | le implementazioni iniettate dal consumer via `start(decorators)`. Se assenti, partono i null-object di `lib/defaults/managers.ts` |
| **Fail-closed** | in caso di dubbio o di componente non disponibile, si rifiuta invece di procedere |

---

## Appendice A: come riprodurre le prove

Tutte le misure della sezione 2 e le prove dei difetti D-01, D-10 e D-14 sono riproducibili.
I comandi qui sotto sono stati eseguiti il 1 settembre 2026 su macOS 24.6.0, Node 24.19.0,
in `/Users/davide/Workspace/volcanic-minds/volcanic-backend`. **Le misure di tempo dipendono
dalla macchina: vanno rifatte su hardware dedicato prima di usarle per dimensionare.**

### A.1 · Ordine dei listener: perché il reset di `search_path` non viene mai eseguito

Salvare come `probe-order.mjs` **dentro il repository** (serve la risoluzione di `fastify`
da `node_modules`) ed eseguire con `node probe-order.mjs`.

```js
import Fastify from 'fastify'

const order = []
const app = Fastify()

// come lib/loader/tenant.ts:78
app.addHook('onRequest', async (req, reply) => {
  reply.raw.on('finish', () => order.push('listener di tenant.ts (esegue il reset)'))
})

// come lib/hooks/onResponse.ts:4
app.addHook('onResponse', async () => order.push('hook onResponse (rilascia il QueryRunner)'))

app.get('/', async () => ({ ok: true }))
await app.listen({ port: 0, host: '127.0.0.1' })
await fetch(`http://127.0.0.1:${app.server.address().port}/`)
await new Promise((r) => setTimeout(r, 200))
console.log(order)
await app.close()
```

**Esito misurato** con Fastify 5.8.5:

```
1. hook onResponse (rilascia il QueryRunner)
2. listener di tenant.ts (esegue il reset)
```

Poiché `release()` imposta `isReleased = true` in modo sincrono
(`node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:88-92`), quando tocca al
secondo listener la condizione `!qr.isReleased` di `lib/loader/tenant.ts:79` è falsa e il
reset viene saltato.

### A.2 · La perdita, su Postgres reale

```bash
docker run -d --rm --name evo-audit-pg \
  -e POSTGRES_PASSWORD=evoaudit -e POSTGRES_USER=evoaudit -e POSTGRES_DB=evoaudit \
  -p 55432:5432 postgres:16-alpine
```

Poi, con un pool `max: 1` verso quel Postgres: creare `public.widget` e `tenant_acme.widget`
con contenuti diversi; acquisire una connessione, eseguire
`SET search_path TO "tenant_acme", public`, leggere `SELECT * FROM widget` e rilasciarla
**senza reset** (cioè come fa oggi il framework); riacquisire una connessione dal pool e
rileggere `SELECT * FROM widget`.

**Esito misurato:**

```
richiesta 1 (tenant acme)                                  -> ACME PRIVATE ROW
search_path ereditato                                      -> tenant_acme, public
richiesta 2 (fuori contesto, si aspetta CONTROL-PLANE)     -> ACME PRIVATE ROW
```

Confermato anche che né `pg-pool` né il driver Postgres di TypeORM eseguono un reset:
`grep -rn "search_path" node_modules/typeorm/driver/postgres/*.js` non restituisce nulla, e
`node_modules/pg-pool/index.js` non contiene alcun `DISCARD`.

### A.3 · Costo di un `DataSource` per tenant

Inizializzare N `DataSource` TypeORM verso lo stesso Postgres, con `poolSize: 1` e due
entità, misurando heap e tempo, poi contare le connessioni con
`SELECT count(*) FROM pg_stat_activity WHERE datname = 'evoaudit'`.

**Esito misurato:**

| N | Tempo | Heap | Connessioni |
|---|---|---|---|
| 100 | 957 ms (9,6 ms ciascuna) | 4,3 MiB (44 KiB ciascuna) | 100 |
| 150 | fallisce | | `error: sorry, too many clients already` |

`SHOW max_connections` sul container: `100`.

**Lettura**: il costo in memoria di un `DataSource` è trascurabile. Il vincolo è la
connessione aperta. Questo corregge l'idea che «300 `DataSource` sono pesanti»: sono
leggere, ma 300 connessioni non ci stanno.

### A.4 · Costo della derivazione di chiave

```bash
node -e "
const crypto=require('crypto');
const t0=process.hrtime.bigint();
for(let i=0;i<5;i++){crypto.scryptSync('s'.repeat(20),crypto.randomBytes(16),32,{N:32768,r:8,p:1,maxmem:64*1024*1024})}
console.log(Number(process.hrtime.bigint()-t0)/5/1e6,'ms per derivazione');
"
```

**Esito misurato**: 82,3 ms per derivazione, sincroni e bloccanti.

### A.5 · Copertura reale

```bash
npx c8@10 --reporter=text-summary \
  --include='lib/**' --include='index.ts' --include='typeorm.ts' --all \
  npm test
```

**Esito misurato**: righe 79,71% (6.492/8.144), rami 72,08% (1.557/2.160), funzioni 77,51%
(631/814), con 432 test verdi su 11 suite.

I file più scoperti, e non per caso i più critici per l'evoluzione:

| Copertura righe | File |
|---|---|
| 0,0% | `lib/api/admin/controller/manifest.ts`, `lib/middleware/isAdmin.ts` |
| 28,4% | `lib/api/tenants/controller/tenants.ts` (contiene l'impersonificazione) |
| 38,4% | `lib/loader/schedules.ts` |
| 43,2% | `lib/database/typeorm/loader/userManager.ts` |
| 45,5% | `lib/database/typeorm/query.ts` |
| 66,4% | `lib/util/tracker.ts` |
| 78,4% | `lib/loader/tenant.ts` |

### A.6 · Pulizia

```bash
docker stop evo-audit-pg
```

---

## Appendice B: comportamenti da preservare nella riscrittura

Sono proprietà **già corrette** nel codice v4, molte delle quali frutto di correzioni
precedenti. I riferimenti puntano al codice vecchio perché è lì che si legge come sono fatte.
**Perderle nel porting è una regressione di sicurezza, non un dettaglio**: ogni riga di questa
tabella deve avere il suo test anche nel data layer nuovo.

| Cosa | Dove |
|---|---|
| La cache di risposta è segmentata per tenant, soggetto e ruoli, e si disattiva se il tenant è atteso ma assente | `lib/util/cache.ts:182-200` |
| I nomi di schema sono sanificati prima di finire in SQL, in tutti i punti | `tenantManager.ts:82,131` · `tenants.ts:12-14` |
| Il confronto delle password ha costo costante anche per email inesistenti | `userManager.ts:225-236` |
| `forgot-password` risponde sempre 200 e non rivela l'esistenza dell'account | `auth.ts:197-209` |
| Il segreto MFA è cifrato con AES-256-GCM e derivazione per record con salt | `crypto.ts:53-67` |
| Il rinnovo del token verifica la firma anche del token scaduto, invece di decodificarlo | `auth.ts:405-413` |
| L'accesso a `global.repository` è vietato a runtime da un proxy che lancia | `typeorm.ts:113-127` |
| I segreti deboli o mancanti impediscono l'avvio | `lib/util/secret.ts` |
| Il confine core / data layer è reale ed è verificato in CI | `.dependency-cruiser.cjs` |
| Il default di `tenantContext` è `true`, quindi una rotta esce dal contesto solo se lo dichiara | `lib/loader/router.ts:159` |
