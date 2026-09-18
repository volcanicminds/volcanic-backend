# EVO punti aperti: verbale delle decisioni

> Domande poste e risposte il **6 settembre 2026**. Questo file non è più un elenco di
> domande: è il verbale. **Dove diverge da `EVO_FRAMEWORK.md`, prevale questo**, finché
> `EVO_FRAMEWORK.md` non viene riscritto nella forma v5.

---

## La decisione che cambia il piano

**v5 breaking, data layer su Drizzle, mentalità greenfield.** Si evolve come se non
esistessero progetti o clienti sul codice attuale. Per chi resta su v4 si scrive una **guida
tecnica di migrazione**; l'assistenza al porting si dà solo su richiesta esplicita del
progetto. Nessuna finestra di deprecazione, nessun doppio percorso di compatibilità: la
rottura è dichiarata nel numero di versione.

**Conseguenza immediata sull'ordine dei lavori.** Le correzioni della fase 0 **non si
applicano al data layer TypeORM**: nascono corrette nel data layer nuovo. Si lavora solo su
Drizzle, sul branch `develop`. Il difetto D-01 resta aperto sul codice attuale per la durata
del porting, e questo è accettabile perché **nessun consumer è in produzione in
multi-tenant** (verificato: `multi_tenant` non compare in nessun repository del workspace
fuori da `_archive/`; i repo che dipendono dal framework sono `volcanic-backend-sample`,
`volcanic-minds-backend`, `playground-transformers-backend`, tutti single tenant).

---

## Decisioni, punto per punto

| # | Punto | Decisione |
|---|---|---|
| 1 | Mongo è requisito o abitudine? | **Abitudine.** Si va su Drizzle. Mongo, dove servirà, si userà con Mongoose fuori dal framework, su database single tenant |
| 2 | Resolver del tenant | **`header` + `subdomain`, niente `query`.** Una sola fonte attiva per volta: se il resolver è `subdomain`, l'header viene ignorato, mai usato come alternativa. Il default dichiarato deve essere quello che il codice esegue |
| 3 | Un errore del tracciamento fa fallire la richiesta? | **Configurabile per rotta, default fail.** Se una rotta dichiara tracciamento e la scrittura di `Change` fallisce, la richiesta fallisce; un flag esplicito sulla rotta consente il best effort |
| 4 | Distruzione dei dati di un tenant | **HTTP a due fasi.** Fase 1: richiesta, ruolo di sistema, restituisce un token monouso a scadenza breve e l'elenco di ciò che verrà distrutto. Fase 2: chiamata di distruzione con token, slug ripetuto e secondo fattore nel corpo: **TOTP MFA se l'operatore ce l'ha, codice via email come fallback**. Evento registrato prima dell'esecuzione, operazione idempotente |
| 4b | Rete di sicurezza sulla distruzione | **Export obbligatorio prima di distruggere.** Si distrugge solo se l'export è riuscito. Nessun cestino a scadenza: la reversibilità sta nell'export |
| 5 | Ruolo di sistema separato | **Sì: utenti di sistema nel piano di controllo**, con ruoli propri, separati per tipo dai ruoli dentro un tenant. Sblocca la distruzione dei dati e chiude D-18 |
| 6 | Quanti tenant per istanza | **Centinaia (50-300).** Cache LRU stretta delle connessioni (ordine di venti vive), distruzione delle connessioni inattive dopo N minuti, PgBouncer in modalità transaction documentato come configurazione consigliata sopra i 100 tenant |
| 7 | I dodici difetti orfani | **Assegnati alle fasi esistenti.** D-07 e D-19 con l'isolamento, D-15 e D-21 con la separazione controllo/tenant, D-18 con il ruolo di sistema, i minori (D-23, D-24, D-25, D-26, D-27, D-28, D-29) in un compito unico di raccolta. Nessun difetto resta senza casa |
| 8 | D-19 e D-21 legati alle rispettive fasi | **Sì**, assorbito dal punto 7 |
| 9 | Chi è in produzione in multi-tenant | **Nessuno.** Nessuna patch d'urgenza, nessun avviso ai consumer |
| 10 | Finestra per i consumer Mongo sul fail-closed | **Decaduta.** Con la v5 breaking, l'adattatore Mongo esce dal data layer. Nella nuova matrice di capacità Mongo non compare |
| 11 | Migrazioni reversibili | **Forward-only, con expand/contract e snapshot obbligatorio.** Nessun `down`: `drizzle-kit` non lo genera e un `down` su una migrazione distruttiva restituisce lo schema, non i dati. La regola scritta nel README è che la migrazione che rilascia è additiva e la parte distruttiva esce in una release successiva. Il migratore di flotta pretende uno snapshot dichiarato prima di partire |
| 12 | Dove vive il migratore di flotta | **In `@volcanicminds/backend`, doppia superficie**: comando `bin` per l'operatore e **API programmatica** per chi lo vuole invocare da uno script o da un job proprio |
| 13 | `timestamp` naive verso `timestamptz` | **Sì, direttamente nello schema base della v5**: le entità di base nascono già `timestamptz`, quindi non esiste una migrazione di conversione. Su SQLite e libSQL si mappa su intero epoch UTC |
| 14 | Messaggi di login uniformi (D-17) rompono il backoffice? | **No.** Verificato oggi: `volcanic-admin/src` non contiene nessuna delle stringhe distintive (`unconfirmed`, `password is expired`, `user blocked`, `wrong credentials`, `invalid user`). I messaggi diventano uniformi verso il client; la causa reale resta nei log e in un codice interno non esposto |
| 15 | CORS: finestra a warning | **Decaduta.** In v5 il default nasce sicuro: allowlist esplicita, `credentials: true` solo quando l'allowlist non è `*`, rifiuto all'avvio in produzione per la combinazione insicura |
| 16 | Chi risolve il tenant, core o data layer | **Il core.** Legge e verifica il token, risolve il tenant e passa al data layer **solo l'identificativo**; il data layer si limita ad aprire il contesto. Rispetta il confine `dependency-cruiser` senza inventare una seconda verità sulla validità dei token |
| 17 | La suite Postgres reale blocca la release | **Sì, bloccante come gli altri job**, anche sul tag `v*`. Se non passa, non si pubblica |
| 18 | La fase 4 è pagata da un progetto? | **Domanda decaduta**: le combinazioni scelte al punto 23 rendono il contenitore per tenant parte del prodotto, non un'ipotesi |
| 19 | Obiettivo di copertura | **Deciso qui**: nessuna percentuale globale da inseguire, ma ogni file **nuovo o riscritto** del data layer e del percorso tenant sta **sopra l'85% di righe**, e ogni proprietà di isolamento ha il suo test nero. Sotto quella soglia il compito non è chiuso |
| 20 | Branch di lavoro | **`develop`.** Va prima riallineato: oggi è fermo al 24 ottobre 2024, due anni dietro `main` |
| 21 | Versione bersaglio | **v5 in questo ciclo**, breaking dichiarata. Le deprecazioni non si accumulano: ciò che va tolto si toglie qui |
| 22 | Chi aggiorna i consumer | **Guida tecnica di migrazione** per tutti; **compito esplicito di allineamento** per `volcanic-admin` e `volcanic-backend-sample`, eseguito quando l'API v5 è stabile. Il sample è anche la prova che la guida funziona |
| 23 | Combinazioni motore in v5 | **Quattro, tutte da costruire e mantenere**: controllo PG + tenant PG per schema · controllo PG + tenant PG per contenitore · controllo PG + tenant SQLite/libSQL per file · tutto su SQLite/libSQL, controllo compreso |
| 24 | Magic Query nel porting | **Sintassi ripulita, non conservata.** La v5 corregge le incoerenze degli operatori e la semantica di `_logic`. Prima del codice si scrive `docs/MAGIC_QUERY_V5.md`: grammatica completa, confronto con la v4, tabella di corrispondenza per motore (cosa non esiste su SQLite) |
| 25 | Primo passo concreto | **Solo Drizzle, su `develop`.** Nessuna correzione sul data layer TypeORM: le proprietà di isolamento si verificano con il banco di prova nero su Postgres reale, che vale per entrambi i motori |
| 26 | Il data layer TypeORM durante il porting | **Esce al primo commit di sviluppo.** `lib/database/typeorm/**` e `typeorm.ts` vengono cancellati subito: nessuna convivenza, nessun dubbio su quale codice sia vivo. Conseguenza accettata: **il repository resta non compilabile e senza suite verdi per tutta la fase 2**, cioè finché il data layer Drizzle non regge le suite. Ripristino, se serve guardare il codice vecchio: `git checkout main -- lib/database/typeorm typeorm.ts` |
| 27 | Versionamento dei documenti | Piano e specifiche committati su `develop` in **due commit**: uno per il piano (`EVO_*.md`), uno per le specifiche e i cartelli (`docs/**`) |

---

## Decisioni prese senza domanda, dichiarate qui

1. **Subpath del data layer**: `@volcanicminds/backend/typeorm` diventa `@volcanicminds/backend/db`, neutro rispetto al motore. Il nome dell'ORM non sta nell'API pubblica.
2. **Formato dell'export obbligatorio prima della distruzione**: `pg_dump` per schema e contenitore Postgres, copia del file per SQLite e libSQL, in una directory configurata. Se il binario `pg_dump` non è disponibile o l'export esce con codice diverso da zero, **la distruzione non parte**.
3. **Ordine di scrittura**: il banco di prova nero (Postgres reale, via HTTP) si scrive per primo e resta valido attraverso il cambio di ORM.
5. **Secondo fattore della distruzione, solo TOTP (deciso il 10 settembre 2026, in T-6.3)**: `docs/API_V5.md` §6.2 ammetteva, per un operatore senza MFA, un codice monouso spedito per email. Non implementato, e non per pigrizia: il framework non ha una propria catena di invio email, e inventarne una sul percorso della sua unica operazione irreversibile significherebbe che il secondo fattore vale quanto una configurazione SMTP che nessuno ha rivisto. Chi può distruggere i dati di un cliente si iscrive prima all'MFA, e il rifiuto glielo dice con la rotta da chiamare. È **più stretto** della specifica, non più largo. Se un giorno servirà davvero il percorso email, si aggiunge quando esiste un invio email di cui fidarsi.

4. **Cache di risposta, D-26 (deciso il 7 settembre 2026, in T-3.6)**: resta **in memoria per processo**, senza porta e senza adattatore Redis. L'invalidazione raggiunge l'istanza che ha servito la richiesta e nessun'altra, ed è un limite dichiarato nel README e in `docs/CACHE.md`, non un difetto taciuto. A bilanciarlo, il TTL di default diventa **doppio e scelto dalla forma del deployment**: 3600s senza blocco `tenants`, 60s quando i tenant sono dichiarati, perché quello è il deployment che si replica. Motivo dello scarto: un adattatore Redis aggiunge un servizio da gestire e un modo nuovo di fallire (cache irraggiungibile: si fallisce la richiesta o si degrada in silenzio?) per un problema che un TTL basso limita. La porta si aggiunge quando un deployment la chiede davvero, con quel deployment sotto mano. **Caso residuo, dichiarato**: un'applicazione single-tenant può girare comunque su più istanze, e lì il default da un'ora è quello sbagliato; va dichiarato `cache.ttl` esplicito.

---

## Residui che restano aperti

1. **`develop` è stato riallineato a `main`** il 6 settembre 2026 con `git branch -f develop main`, senza conservare lo stato precedente (deciso: era fermo al 2024 e non serviva). Resta da fare il **push forzato** su `origin/develop`, che oggi è indietro di 209 commit: non eseguito, serve una richiesta esplicita.
2. **Rate limit, TTL e soglie della cache LRU: CHIUSO il 18 settembre 2026, in T-9.4.** Il banco misura ora anche la cache e il rate limit (`npm run tune`, risultati e provenienza in `docs/TUNING.md`). Esito: **nessun default cambia, e adesso si sa perché**. `maxEntries` resta 1000: misurati 4.485 B per voce su una pagina da 25 righe (4,3 MB al tetto) e 17.101 B su una da 100 righe (16,3 MB), con le operazioni piatte da mille a cinquantamila voci, quindi il tetto è una decisione di memoria e non di velocità; 7.500 voci starebbero nel budget solo alla pagina piccola, perché alla grande costerebbero circa 122 MB. Il TTL resta 3600s e 60s: è la politica di obsolescenza decisa in D-26, e un banco misura il meccanismo (scadenza e spazzata), non quanto una distribuzione è disposta a stare indietro. `AUTH_RATELIMIT_MAX` resta 10 per 60s: una verifica bcrypt costa 281,47 ms, quindi un indirizzo compra 14.400 tentativi al giorno e il 4,7% di un core, e ne servono 22 per saturarne uno. Il limite del 404 resta 30 per 30s: dietro c'è un `reply.code(404).send()` da 0,02 ms, non un hash, e ne servirebbero 50.000 di indirizzi per saturare un core. **Resta da rifare su macchina dedicata**: la misura è stata forzata con `--force` su un portatile di sviluppo con carico 3,52 su 10 core, e `connections` è saltata perché senza `DATABASE_URL` non c'è un server vero contro cui misurarla.
3. **Litestream** resta l'unico adattatore di replica previsto. Se servirà un contenitore cifrato a pagina, è un progetto a sé, non una variante.

---

## Appendice: decisioni prese scrivendo le specifiche (6 settembre 2026)

Sono i bivi che la stesura dei documenti in `docs/*_V5.md` ha imposto di sciogliere. Le ho
sciolte io, con il criterio dichiarato accanto a ciascuna. **Sono tutte revocabili**: cambiarne
una significa correggere il documento citato e la tabella di corrispondenza v4 → v5, non il
codice.

### Schema (`docs/SCHEMA_V5.md`)

| | Decisione | Criterio |
|---|---|---|
| S1 | identificativi **UUID v7 generati nel processo**, implementati nel framework senza dipendenze | chiude D-28 (il ciclo `do/while` che interrogava il database) e dà un ordinamento temporale gratuito |
| S2 | `external_id` resta, accanto a `id` | è il soggetto del JWT: ruotarlo invalida i token di quell'utente, ed è l'unico modo per farlo senza cambiare chiave primaria |
| S3 | nuova colonna `user.is_founder` | il fondatore è una proprietà della riga nel suo contenitore, non dell'ambiente di processo (D-27) |
| S4 | nuova colonna `token.expires_at`, obbligatoria nel corpo, `null` solo se esplicito | una credenziale macchina senza scadenza è un segreto permanente per distrazione |
| S5 | `change` diventa append-only: acquisisce `id` e `token_id`, perde `updated_at` | un record di audit modificabile non è un audit |
| S6 | `tenant`: `dbSchema`/`dbName` sostituiti da `strategy` + `engine` + `locator` + `config` + `schema_version` | la coppia vecchia non sa descrivere un contenitore su file |
| S7 | tre tabelle nuove nel piano di controllo: `system_user`, `impersonation`, `destruction_request` | reggono rispettivamente i ruoli di sistema, D-18 e la distruzione a due fasi |
| S8 | i campi sensibili diventano anche **non filtrabili** (400) | in v4 si poteva filtrare su `password`: è un oracolo |

### Magic Query (`docs/MAGIC_QUERY_V5.md`)

| | Decisione | Criterio |
|---|---|---|
| Q1 | **tutti** i parametri riservati con prefisso `_`: `_page`, `_pageSize`, `_sort`, `_fields`, `_relations`, `_logic`, `_withDeleted` | in v4 alcuni non ce l'avevano, quindi una colonna chiamata `page` o `sort` era irraggiungibile |
| Q2 | `skip` e `take` rimossi | dicono la stessa cosa di `_page` e `_pageSize`: due risposte per una domanda |
| Q3 | ordinamento `_sort=-amount,createdAt` invece di `sort=amount:desc` | i due punti separano già l'operatore: usarli anche qui è ambiguo |
| Q4 | **gli operatori base diventano case-sensitive**, il suffisso `i` rende insensibili, l'env `VOLCANIC_CASE_INSENSITIVE_DEFAULT` sparisce | è l'incoerenza peggiore della v4: lo stesso URL dava risultati diversi su due server dello stesso prodotto |
| Q5 | le varianti con suffisso `s` (`:eqs`, `:containss`, ...) spariscono | «strict» è ora il significato della forma base |
| Q6 | separatore di intervallo `..` invece di `:` (`between=2026-01-01..2026-12-31`) | con `:` una data ISO rompeva la condizione, che veniva **scartata in silenzio** |
| Q7 | `:null=true\|false` e `:empty=true\|false`; via `:notNull`, `:isEmpty`, `:isNotEmpty` | tre operatori per due significati, due dei quali ignoravano il proprio valore |
| Q8 | `:raw` rimosso, senza sostituto; `:overlap` diventa `:arrayOverlaps` | D-12: un frammento SQL dalla rete è una via oltre il confine del tenant |
| Q9 | operatori array e JSONB: **400 esplicito** su SQLite e libSQL | mai emulare in silenzio con una semantica diversa |
| Q10 | `%` e `_` **escapati** nei valori di `contains`/`starts`/`ends`; `:like` resta con i caratteri jolly del chiamante | in v4 `amount:contains=50%` cercava tutto ciò che inizia per 50 |
| Q11 | ogni degrado silenzioso diventa **400 con un codice stabile** (elenco nel documento) | invariante: rispondere a una domanda diversa da quella posta è peggio di un errore |
| Q12 | `req.data()` fonde query string e corpo, **vince il corpo**; nuovi `req.queryData()` e `req.bodyData()` | chiude D-29 |
| Q13 | la coercizione dei valori la decide **il tipo della colonna**, non la forma della stringa | in v4 `code:eq=0042` perdeva gli zeri iniziali |

### Manager e ambiti (`docs/MANAGERS_V5.md`, `docs/AUTHORIZATION_V5.md`)

| | Decisione | Criterio |
|---|---|---|
| M1 | l'handle è il **primo argomento** di ogni metodo, sempre chiamato `ctx`; tutti i metodi `async` | una chiamata senza contesto non compila, ed è greppabile |
| M2 | `req.db` e `req.runner` spariscono **senza alias deprecati** | è una major: la compatibilità è un documento |
| M3 | `dataBaseManager` diventa `trackingManager`, e perde `synchronizeSchemas()` | il nome vecchio prometteva la gestione del database e scriveva solo l'audit |
| M4 | `resolveTenant(req)` e `switchContext()` spariscono, arriva `openContainer(tenantId)` | la risoluzione del tenant sale nel core, il data layer apre e basta |
| M5 | `disableUserById` rimosso (duplicava `blockUserById`); `forceDisableMfaForAdmin(email)` diventa `forceDisableMfa(ctx, userId)` | il nome descriveva il chiamante, e prendere un'email invitava all'enumerazione |
| M6 | nuovo `SystemUserManagement`, e gli amministratori di piattaforma vivono nel piano di controllo | è la separazione che D-01 rompeva |
| M7 | `tenantContext: false` diventa `scope: 'control'` | il nome vecchio descriveva un meccanismo, il nuovo descrive il significato |
| M8 | ruoli di sistema con prefisso `system:`, tre predefiniti, e `tenants:destroy` **separata** da `tenants` | creare un tenant e distruggerne i dati non sono lo stesso mestiere |
| M9 | token di controllo con `scp: 'control'` e **senza** `tid`; un token dell'ambito sbagliato è 403 prima di ogni altro controllo | nessun percorso in cui un admin di tenant è «abbastanza admin» |
| M10 | impersonificazione: motivo **obbligatorio**, record persistito prima del token, 30 minuti di default, massimo 4 ore, revocabile | D-18 |

### Rotte (`docs/API_V5.md`)

| | Decisione | Criterio |
|---|---|---|
| A1 | il gruppo `/tool/*` sparisce del tutto | conteneva solo `synchronize-schemas`, incompatibile con le migrazioni versionate |
| A2 | nuovi gruppi `/system/auth/*` e `/system/users/*` | gli amministratori di piattaforma hanno un login proprio: un solo endpoint che restituisce due tipi di token è un invito allo sbaglio |
| A3 | `/token/block/:id` diventa `/token/:id/block` | allinea alla forma già usata da `/users/:id/block` |
| A4 | una risorsa di un altro tenant risponde **404**, mai 403 | 403 confermerebbe che esiste da qualche parte |
| A5 | `POST /auth/register` con email già registrata risponde **200** come una registrazione riuscita, senza creare nulla | D-17: è l'unico modo di non rivelare l'esistenza dell'account |
| A6 | la distruzione esporta **prima**, e non parte se l'export fallisce o è vuoto | l'export è la rete di sicurezza scelta al punto 4b |

### Test e configurazione (`docs/TESTING_V5.md`, `docs/CONFIGURATION_V5.md`)

| | Decisione | Criterio |
|---|---|---|
| T1 | `test/typeorm` diventa `test/db`; nuova suite `test/e2e-mt-pg` sulla porta 2241 | il nome dell'ORM esce anche dai test |
| T2 | in CI il banco nero gira con `DB_POOL_MAX=1`; lo scenario a 4 connessioni esiste ma **non** è il cancello | con più connessioni il fallimento è probabilistico, e un cancello instabile insegna a ignorare il rosso |
| T3 | via le variabili `DB_SYNCHRONIZE_SCHEMA_AT_STARTUP`, `VOLCANIC_CUSTOM_QUERY_OPERATORS`, `VOLCANIC_CASE_INSENSITIVE_DEFAULT` | rispettivamente: incompatibile con le migrazioni, abilita `:raw`, rende ambiguo il significato di un URL |
| T4 | `CORS_ORIGINS` obbligatoria in produzione, e la coppia `*` + credenziali rifiuta l'avvio | D-16 |

## Appendice: decisioni della fase 10 (11 settembre 2026)

Prese durante `EVO_FASE_10.md`. Le prime due su indicazione esplicita, le altre come default
dichiarati e reversibili.

| | Decisione | Criterio |
|---|---|---|
| F1 | `LOG_LEVEL` non impostato vale `info` in produzione e `debug` altrove | un livello che nessuno ha scelto non deve scrivere ogni soggetto risolto nei log di produzione |
| F2 | di default la sessione del browser sta in un cookie httpOnly, mai in `localStorage` (T-10.37) | un token leggibile da qualunque script della pagina è un token che una XSS porta via |
| F3 | il reset MFA forzato dell'admin si configura **solo** dall'ambiente | è un'azione di emergenza con una finestra di dieci minuti: un valore con scadenza non va in un file committato |
| F4 | il manifest resta **uguale per tutti** i chiamanti; la documentazione ora lo dice | filtrarlo per ruolo renderebbe il manifest pinnato dell'admin dipendente da chi lo scarica; resta aperto se il costo vale la riduzione di superficie |
| F5 | le chiavi di configurazione storiche restano in snake_case (`mfa_policy`, `allow_multiple_admin`, `export_directory`, …); i blocchi introdotti in v5 sono camelCase (`control`, `tenants`, `manifest`, `cache`); **nessuna rinomina in 5.0** | rinominare una chiave esistente rompe in silenzio ogni consumer che la imposta (la chiave vecchia diventa ignorata, non un errore); la regola per le chiavi nuove è camelCase, e la convivenza è scritta qui invece di essere scoperta |
| F6 | `tenants.engine` resta senza variabile d'ambiente | `CONTROL_ENGINE` esiste perché il control plane cambia fra ambienti; il motore dei tenant è una scelta di architettura, non di deployment. Da rivedere se un progetto reale lo chiede |
| F7 | ~~`noImplicitAny` resta spento~~ **acceso il 18 settembre 2026**, `tsconfig.json`, con codice e test a zero errori | i 169 errori erano per due terzi **una dichiarazione mancante**: i manager iniettati si raggiungevano come `req.server['userManager']`, cioè un indice su un tipo che non li dichiara. Dichiarati su `FastifyInstance` (e la configurazione di rotta su `FastifyContextConfig`), ne restavano 55, tutti parametri e indici da annotare. Il resto del lavoro lo ha pagato subito: quattro chiamate che il compilatore non poteva vedere erano **morte o sbagliate** (vedi sotto) |
| F8 | in modalità cookie l'header `Authorization` accetta **solo token di integrazione**; la regola «una fonte per configurazione» diventa «una fonte per tipo di credenziale» (T-10.37) | accendere il cookie spegneva ogni integrazione; accettare anche le sessioni nell'header non aggiunge nulla, perché in modalità cookie nessuna sessione esce mai nel corpo |
| F9 | quando una richiesta porta sia l'header sia il cookie, vale l'header | l'header è la credenziale esplicita di un programma, il cookie quella ambientale di un browser; rifiutare entrambi romperebbe lo Swagger usato da un browser già loggato |
| F10 | una coppia di cookie **per piano** (`auth_token`/`refresh_token`, `control_token`/`control_refresh_token`) | con un cookie solo, aprire un'impersonificazione cancellava la sessione di controllo, cioè l'unica che può chiuderla |
| F11 | in modalità cookie il rinnovo usa **solo** il refresh token, senza il vincolo dei 30 giorni sull'access token del rinnovo bearer; niente rotazione del refresh token | il cookie di accesso muore con il suo token (T-10.38), quindi al rinnovo non c'è più; la sessione dura al massimo `JWT_REFRESH_EXPIRES_IN` e `/auth/invalidate-tokens` la chiude. Rotazione e rilevamento del riuso **sono chiusi dalla fase 11** (`EVO_FASE_11.md`), che sostituisce il refresh JWT con un credenziale opaco e un registro delle sessioni |
| F12 | i refresh token emessi prima di `typ: 'refresh'` non rinnovano più | accettarli significherebbe accettare un access token come refresh ogni volta che i due segreti coincidono; il costo è un login per utente dopo l'aggiornamento |

### Che cosa ha trovato `noImplicitAny` (18 settembre 2026)

Cinque difetti che compilavano solo perché il manager iniettato si raggiungeva senza tipo. Non
sono stati cercati: sono caduti fuori appena la dichiarazione è esistita.

1. **Il reset MFA di emergenza non ha mai funzionato.** `index.ts` chiamava
   `forceDisableMfaForAdmin(email)`, metodo che non esiste su nessun manager: la chiamata lanciava,
   il `try` lo trasformava in un «MFA RESET FAILED» generico, e la via di fuga documentata era
   morta. Ora cerca l'utente per indirizzo nel piano di controllo e chiama `forceDisableMfa`.
2. **`/auth/unregister` rispondeva sempre 500.** Chiamava `disableUserById`, anch'esso inesistente.
   Ora blocca l'utente con `blockUserById`, che è l'operazione che il contratto ha e che la rotta
   intende in un framework che non cancella gli account.
3. **Il token di reset password non arrivava a nessuno.** `forgotPassword` restituisce il token,
   non la riga, e il codice leggeva `updated?.resetPasswordToken`: cioè una proprietà di una
   stringa, sempre `undefined`. Il middleware che deve recapitare il link riceveva il vuoto.
4. **Il secondo fattore accettava qualunque codice, con un gestore asincrono.** Tre chiamate a
   `mfaManager.verify()` non erano attese: una Promise non è né un numero né `null`, quindi cadeva
   nel ramo «gestore vecchio, valido senza passo». Con il gestore sincrono dei tools non si vedeva.
5. **Il codice del ruolo pubblico non veniva mai letto.** `global.role?.public?.code` usa un
   globale che non esiste (`role` invece di `roles`): valeva sempre `undefined` e vinceva la
   stringa di ripiego.

### Blocco C, decisioni del 15 settembre 2026

Prese su domanda esplicita durante T-10.14, T-10.15 e T-10.16, con le alternative scartate.

| | Decisione | Criterio |
|---|---|---|
| F13 | una console lavora su **un piano**, scelto con la prop `plane` dell'admin (`tenant` di default, `control` per la piattaforma); il backend aggiunge `GET /system/auth/me` (T-10.14) | scartati l'interruttore sulla schermata di login, che fa cambiare piano a una sessione, e i piani dichiarati nel manifest, che aggiungono grammatica per lo stesso comportamento |
| F14 | **un manifest per piano**: `/admin/manifest` di scope tenant con le sole rotte tenant, `/system/manifest` di controllo con le sole rotte di controllo; senza tenant nessun filtro. Precisa F4: uguale per tutti i chiamanti **dello stesso piano** | scartato il manifest pinnato per le console dei clienti: nel bundle è leggibile senza login con le rotte e i ruoli della piattaforma, e in modalità cookie la pull non si autentica sul piano di controllo. Il percorso di esempio della domanda era `/admin/manifest/tenant`; scelto `/admin/manifest` per il tenant e `/system/manifest` per la piattaforma, perché lascia invariato il caso comune e mette la superficie di controllo sotto `/system` |
| F15 | con resolver `header` il tenant **si chiede al login** e si ricorda nel browser, o lo fissa la prop `tenant`; `tenancy.switchable` è sempre `false` e il selettore sparisce (T-10.15) | dal login il token lega il tenant (T-3.2) e la lista `/tenants` è una rotta di controllo: un selettore sotto la sessione produrrebbe solo `TENANT_MISMATCH`. Scartate la sola prop e il solo resolver `subdomain` |
| F16 | `manifest` resta un nome riservato da **entrambi** i cataloghi, uno per piano (`SHARED_CAPABILITIES`) | è l'unico caso in cui la stessa operazione esiste su due piani; un nome nuovo per il piano tenant avrebbe rotto ogni `config/roles.ts` che concede già `manifest` |
| F17 | la descrizione dell'input di un'azione non-CRUD si **deriva dal body schema** della rotta; un hint `config.manifest.input` aggiunge widget, etichette ed esclusioni (T-10.16) | una fonte sola, la validazione. Scartato l'hint scritto a mano da solo: due descrizioni dello stesso body divergono alla prima modifica |

### Fase 11, decisioni del 18 settembre 2026

Prese in discussione esplicita prima di scrivere codice. La forma lunga, con le alternative
scartate, sta in `EVO_FASE_11.md` §1; qui la riga che vale.

| | Decisione | Criterio |
|---|---|---|
| F18 | esiste un **registro delle sessioni** persistito nel contenitore, dietro il port `SessionManagement` con default no-op | il core non importa il data layer, e un port lascia al consumer la libertà di implementarlo su Redis senza toccare il core |
| F19 | la sessione vive **sul piano del soggetto**: utente del tenant nel suo contenitore, identità di sistema nel piano di controllo | l'export o la distruzione di un tenant si porta via le sue sessioni, ed è il comportamento corretto |
| F20 | il refresh token è **opaco e auto-descrittivo** (`vs1.<routing>.<sid>.<segreto>`), in tabella solo il suo SHA-256 | il rinnovo interroga comunque la riga, quindi la firma non aggiungeva nulla e costava un secondo segreto; il prefisso serve a scegliere il contenitore prima di poter leggere qualsiasi cosa |
| F21 | il `sid` è **stabile per tutta la sessione**, ruota il segreto con un contatore di generazione | un `sid` che cambia a ogni rinnovo toglie sia la chiusura della famiglia sia la lista dei dispositivi |
| F22 | l'access token resta **stateless**: la riga si legge e si scrive solo al rinnovo | `last_used_at` a ogni richiesta è una riga caldissima e contesa; il prezzo è un ritardo di revoca pari alla vita dell'access token |
| F23 | **finestra di grazia** di pochi secondi sulla generazione appena ruotata, confrontata in modo stretto | due schede che rinnovano insieme presentano lo stesso segreto; con `<=` una tolleranza di zero non era una tolleranza di zero (difetto trovato dalla prova) |
| F24 | **due scadenze** per riga: inattività e vita massima assoluta | la sola scadenza che si sposta a ogni rinnovo produce sessioni eterne |
| F25 | riuso fuori finestra: **revoca dell'intera sessione**, motivo in riga, evento a log, `SESSION_REUSE_DETECTED` | il server non sa quale dei due presentatori sia il ladro, e chiudere è l'unica mossa onesta |
| F26 | revoca a **tre livelli**: la singola sessione, tutte quelle del soggetto, il cambio di `external_id` come emergenza | l'`external_id` è un identificatore pubblico serializzato nelle risposte: usarlo come sigillo di sessione rompe i riferimenti di chi lo ha salvato |
| F27 | rotazione su **entrambi i piani e in entrambe le modalità** | non c'è motivo per cui un client bearer debba avere una sessione meno sicura di un browser |
| F28 | registro **acceso quando il data layer c'è**; senza, il rinnovo non esiste invece di esistere e non proteggere | un refresh che nessuno può consumare è una credenziale che non scade mai |
