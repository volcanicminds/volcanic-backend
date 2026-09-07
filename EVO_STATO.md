# EVO stato dei lavori

> **Questo file è lo stato, non il piano.** Cosa fare, con quali file e con quale criterio di
> chiusura, sta in `EVO_FRAMEWORK.md`; le decisioni stanno in `EVO_PUNTI_APERTI.md`. Qui una
> riga per compito e nient'altro: descrivere di nuovo un compito qui significa crearne una
> seconda versione che diverge alla prima modifica.
>
> **Regola unica**: una casella si chiude solo con un'**evidenza citata**, cioè un `file:riga`,
> un identificativo di commit o l'output di un comando. Senza evidenza resta aperta.
>
> Linea di lavoro: branch `develop`, versione bersaglio `5.0.0`, data layer Drizzle.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

**Prossimo passo**: **fase 4 chiusa**. Si passa alla fase 5, migrazioni e migratore di flotta,
da T-5.1 (motore, formato, collocazione della versione). È ciò su cui il banco nero è fermo
adesso: nessuna tabella del framework viene creata, quindi la genesi non trova `system_user`.
Si legge `docs/SCHEMA_V5.md` §2.4 e la decisione 10 (forward-only, expand/contract, snapshot). Il banco nero ora si ferma su una tabella che non
esiste: `system_user`. **Non è un difetto, è l'ordine del piano**: le migrazioni sono la fase
5, e finché non esistono nessuna tabella del framework viene creata. Da qui in avanti il banco
resta rosso su questo, non su un buco del modello.

**Prima di toccare qualsiasi cosa**, leggere la sezione 0 di `EVO_FRAMEWORK.md`: dice quali
documenti esistono e in che ordine si leggono.

---

## Fase 0: preparazione e prove

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-0.1 | Branch, versione, catena di verifica, rimozione di TypeORM | `[x]` | `develop` allineato a `main` e pubblicato; versione `5.0.0-alpha.0`; data layer TypeORM rimosso con le suite che ci giravano sopra (resta `test/lib`); Drizzle e i driver come peer opzionali, verificati su Node 24.11; subpath `/typeorm` fuori da `exports`; decoratori tolti dal build; `tsconfig.test.json` mette i test nel type-check senza emetterli in `dist` (D-25); CI su `develop` e prerelease su dist-tag `next`. `npm run check-all` verde, `npm test` 49 verdi. Commit `db20063` e seguente |
| T-0.2 | Banco di prova nero su Postgres reale | `[x]` | `test/e2e-mt-pg/`: harness, app di prova con le due sonde, i sette test di `docs/TESTING_V5.md` §2.4. Script `npm run test:e2e:mt:pg`, job `test-pg` in CI da cui dipende la pubblicazione. **Rosso come deve essere**: fallisce su `db.js` mancante. Verificato il 6 settembre 2026 contro `postgres:16-alpine` con `DB_POOL_MAX=1` |
| T-0.3 | Le specifiche dei contratti | `[x]` | scritte il 6 settembre 2026: `docs/SCHEMA_V5.md`, `MAGIC_QUERY_V5.md`, `MANAGERS_V5.md`, `AUTHORIZATION_V5.md`, `API_V5.md`, `CONFIGURATION_V5.md`, `TESTING_V5.md`. Decisioni nell'appendice di `EVO_PUNTI_APERTI.md` |
| T-0.4 | Verifica della matrice delle combinazioni | `[x]` | sezione 1 di `EVO_FRAMEWORK.md`, quattro combinazioni confermate il 6 settembre 2026 |

## Fase 1: la forma del sistema

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-1.1 | Configurazione `control` e `tenants` | `[x]` | `multi_tenant` sostituito dai due blocchi in `lib/config/general.ts` e `lib/loader/general.ts`; fusione profonda in `lib/util/merge.ts` (D-21) e default del blocco tenant applicati solo se dichiarato (`normalizeOptions`); tipi `ControlConfig`/`TenantsConfig` in `types/global.d.ts`; sei punti del core passano da `lib/util/tenancy.ts`; gruppo `/tool` rimosso; 9 test nuovi in `test/lib/merge.spec.ts`, totale 58 verdi |
| T-1.2 | Due tipi distinti, `ControlHandle` e `TenantHandle` | `[x]` | brand fantasma in `types/global.d.ts`, senza nominare l'ORM (invariante 10); `req.db`/`req.runner` spariti, al loro posto `req.control`, `req.tenant`, `req.tenantInfo`; 61 chiamate ai manager migrate a contesto-primo con `dataContext(req)`; interfacce dei manager riscritte su `docs/MANAGERS_V5.md` (`TrackingManagement`, `SystemUserManagement`, `TenantManagement` senza `switchContext`); null-object riscritti con una fabbrica; controller dei tenant riscritto senza `global.connection` e senza i cinque `@ts-ignore`; `scope: 'control'` letto davvero dal router; `onResponse` non rilascia più niente. 60 test verdi |
| T-1.3 | Porte del data layer e subpath `/db` | `[x]` | `lib/database/ports.ts` (ConnectionProvider, MigrationRunner, ContainerLifecycle, DataLayer), entry `db.ts` esportato come `@volcanicminds/backend/db`, `depcruise` estesa al nuovo entry. Il nome dell'ORM non compare nell'API pubblica |
| T-1.4 | Matrice di capacità e rifiuto all'avvio | `[x]` | `lib/database/capabilities.ts`: quattro motori, tre strategie, `assertSupported` con `onFatal` iniettabile chiamata da `db.start()` prima di aprire una connessione. 8 test in `test/db/capabilities.spec.ts`, suite `npm run test:db`. Chiude D-04 |
| T-1.5 | Regola su cosa sta nel piano di controllo | `[x]` | scritta nel README, in forma citabile in revisione: fuori dal contenitore del cliente sta solo ciò che potresti pubblicare |

## Fase 2: il data layer su Drizzle

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-2.1 | Schema base v5 | `[x]` | otto tabelle in `lib/database/schema/{pg,sqlite}.ts` con fabbriche per schema (`appTables`, `registryTables`), `timestamptz` su Postgres ed epoch ms su SQLite, UUID v7 generato nel processo (`lib/database/uuid.ts`, chiude D-28), registro fuori dai contenitori, `change` append-only. 14 test nuovi: parità fra i due dialetti, qualificazione dello schema, ordinamento degli id |
| T-2.2 | Adattatore Postgres | `[x]` | `lib/database/adapters/postgres/`: pool con `search_path` fissato alla connessione, handle di controllo e di tenant costruiti sulle tabelle qualificate, cache dei contenitori, `createSchema`/`dropSchema` con identificatori validati. 5 test, 4 dei quali contro Postgres reale (saltati senza `DATABASE_URL`): provano che dopo una lettura sul contenitore la connessione non resta puntata lì, e che un `SET LOCAL` non sopravvive alla transazione |
| T-2.3 | Adattatore SQLite e libSQL | `[x]` | `lib/database/adapters/sqlite/`: un file per contenitore, percorsi vincolati dentro la directory configurata, pragma WAL, `foreign_keys`, `busy_timeout` applicati all'apertura, permessi 0600, LRU che chiude davvero i descrittori. libSQL è un driver dentro lo stesso adattatore. 7 test |
| T-2.4 | Magic Query v5 | `[x]` | `lib/database/query/`: catalogo operatori con i motori dichiarati, parser di `_logic` a discesa ricorsiva con limiti, assemblatore con validazione in ordine fisso e 16 codici di errore stabili. Niente più degradi silenziosi: `:raw` rimosso, intervalli con `..`, jolly escapati, campi sensibili non filtrabili, operatori array/JSON che rispondono 400 su SQLite. 24 test sui due dialetti |
| T-2.5 | Manager riscritti | `[x]` | `lib/database/managers/`: user, token, tracking, tenant su Drizzle, contesto obbligatorio come primo argomento (`runtime()` lancia se manca), bcrypt costo 12 e confronto a costo costante portati dalla v4, token di reset con la scadenza dentro, segreto MFA cifrato. `db.start()` costruisce provider e manager. 21 test. Il null-object è stato ristretto al contratto: rispondeva a ogni proprietà e Fastify lo scambiava per un accessor |
| T-2.6 | Derivazione di chiave non bloccante | `[x]` | `lib/database/crypto.ts`: `scrypt` asincrono, formato e parametri invariati, letture legacy conservate. 6 test, fra cui la prova che un timer scatta durante la derivazione |

## Fase 3: isolamento del tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-3.1 | Contesto tenant senza stato di sessione | `[x]` | il contesto non tocca la sessione: le tabelle qualificate arrivano da T-2.2, il divieto ora è imposto due volte. `scripts/check-session-state.mjs` (in `check-all` e nel job `verify`) vieta di **scrivere** un `set search_path` fuori da una transazione; `lib/database/adapters/postgres/guard.ts` vieta di **emetterlo**, sul driver, quindi copre anche l'SQL grezzo di un consumer (`set local` ammesso solo dentro transazione, e fuori nemmeno quello: sarebbe un no-op). Punto di rilascio unico in `lib/loader/tenant.ts`: `req.control` e `req.dataScope` su ogni richiesta, `release()` marca lo scope prima di attendere, rete di sicurezza su `reply.raw.on('close')` che rilascia **passando un errore**. `lib/database/leases.ts`: l'LRU non chiude più un contenitore che una richiesta sta usando (su SQLite era un descrittore chiuso sotto una query) e il locator è validato **prima** di diventare chiave di cache. 19 test nuovi: `test/db/session-state.spec.ts` (doppio del pool: legge le istruzioni davvero emesse) e `test/lib/dataContext.spec.ts` (abort su socket reale). 156 verdi, 89 dei quali contro `postgres:16-alpine` |
| T-3.2 | Il tenant si lega al token | `[x]` | la risoluzione sta nel core e gira **prima** dell'hook di autenticazione, quindi il confronto che in v4 era codice morto ora scatta davvero: `lib/loader/tenant.ts` legge il token (`lib/util/bearer.ts`, unico lettore, condiviso con `lib/hooks/onRequest.ts`), ne verifica la firma e ne estrae il `tid`; al data layer arriva solo l'identificativo. Token e header che nominano tenant diversi: **403 `TENANT_MISMATCH`**, con la stessa risposta sia che il tenant dichiarato esista sia che non esista (niente sondaggio del registro). Header o sottodominio solo per le richieste senza token, e **una sola fonte per volta** (`lib/util/tenantResolution.ts`: con `resolver: 'subdomain'` l'header non viene letto, chiude D-11); mai la query string. Nessun tenant dichiarato: 400 `TENANT_REQUIRED`; sconosciuto o sospeso: 404 identico. Token di controllo dentro un tenant: 403 `SCOPE_MISMATCH`. D-19 chiuso in `lib/api/auth/controller/auth.ts`, dove il token arriva nel corpo e la risoluzione non può vederlo: `/auth/refresh-token` confronta il `tid` del token con il tenant risolto e con quello del refresh token. La tolleranza per le rotte non registrate dal router (Swagger, static, 404) è esplicita: senza `tenantContext` booleano l'hook non interviene. 17 test nuovi in `test/lib/tenantResolution.spec.ts`, 169 verdi. `lib/config/general.ts` non è stato toccato: i default del resolver stanno già in `lib/loader/general.ts` da T-1.1 |
| T-3.3 | Sparisce la connessione globale | `[x]` | `global.connection`, `global.entity` e `global.repository` sono usciti anche da `types/global.d.ts`: non esistono più nemmeno come dichiarazione. `dataContext(req)` in `lib/util/tenancy.ts` non ripiega più: tre casi dichiarati (rotta `scope: 'control'`, deployment senza tenant, contenitore del tenant) e un `NoDataContextError` dove la v4 scriveva `?? global.connection.manager` (D-06). Il default non è invertito: senza `scope` la rotta lavora nel tenant. `tenantContext` come parola scritta da un consumer è **rifiutata all'avvio**, non tradotta (invariante 9): `lib/loader/router.ts` raccoglie l'errore fra quelli di integrità e la partenza fallisce, con il messaggio che dice quale `scope` scrivere. `lib/api/health` e `lib/api/admin` migrate a `scope: 'control'`. Recuperato un guasto silenzioso: `ensureGenesisAdmin` era gateato su `global.connection` e dopo T-0.1 non girava **mai**, quindi un'istanza poteva partire senza amministratori senza dirlo; ora chiede l'handle al provider e lo passa a ogni chiamata. 12 test nuovi fra `test/lib/dataContext.spec.ts`, `router.spec.ts` e `genesis.spec.ts`. 181 verdi con Postgres reale |
| T-3.4 | I job dichiarano il contesto | `[x]` | un job **dichiara** il piano e **riceve** l'handle, non lo cerca: `scope: 'control'` (default, perché un job che non dice niente non deve finire nei dati di un cliente), `'tenant'` con `tenant: '<slug>'`, `'every-tenant'`. La firma cambia in `job(ctx, run)`, con `run.tenant` (riga di registro) e `run.signal`. Il fan-out ha lo stesso profilo del migratore di flotta: concorrenza limitata (default 1, massimo 16), si ferma alla chiusura del server via `AbortSignal` su `onClose`, e il fallimento di un tenant non annulla gli altri (girano tutti, ogni errore va a log con il suo tenant e il job fallisce una volta sola con l'elenco). Ogni tenant è preso e restituito con una lease come una richiesta (T-3.1), quindi un giro lungo non fissa i contenitori che ha visitato. La validazione del piano è al **load**, non al primo tick, ed è passata da `log.t` a `log.e`: prima un job scartato era invisibile ai livelli di log normali. 9 test in `test/lib/schedules.spec.ts` (con fixture in `test/lib/fixtures/schedules`), 186 verdi. README e `docs/MIGRATION_V4_V5.md` aggiornati; messo un cartello sul capitolo v4 del README, che documentava `runInTenantContext` e `switchContext` come il modo di far girare un job |
| T-3.5 | Il tracciamento riceve il contesto | `[x]` | il tracker passa `dataContext(req)`, quindi il `Change` finisce nel contenitore del tenant, accanto alla riga che descrive. **Strict di default**: un errore di tracciamento fa fallire la richiesta con 500 e `TRACKING_FAILED`; `tracking: { strict: false }` sulla rotta lo declassa a log, e `config.strict` in `config/tracking.ts` sposta il default del deployment (precedenza rotta, poi deployment, poi strict). Perché prima non poteva funzionare comunque: `preHandler` e `preSerialization` invocavano il tracker **senza `await`**, quindi la risposta partiva prima dell'audit e un fallimento non poteva raggiungerla nemmeno in linea di principio; ora sono attesi e `preSerialization` restituisce il payload. Corretto un difetto del documento (regola di precedenza, §0): `docs/MANAGERS_V5.md` §7 tipizzava `retrieveBy` come `Change[]`, la cronologia, mentre il suo unico chiamante ha bisogno della riga **prima** della scrittura; ora restituisce la riga, e `null` sia quando non esiste sia quando la tabella non è del framework (entità del consumer, `global.entity` non c'è più). Senza baseline la voce registra solo il valore nuovo e omette `old`: «non catturato» non è `old: null`. Chiave primaria esclusa dal diff, niente tracciamento su risposte 4xx/5xx, `changeEntity` rimosso. 13 test nuovi (`test/lib/tracker.spec.ts`, più i manager). 201 verdi con Postgres reale. README, `docs/MANAGERS_V5.md` e `docs/MIGRATION_V4_V5.md` aggiornati |
| T-3.6 | La cache non attraversa i contenitori | `[x]` | D-15 non ha più dove esistere: in v5 non c'è cache di query nel data layer (era quella di TypeORM, con l'SQL come chiave), e le uniche cache degli adattatori sono indicizzate sul locator del contenitore, validato. La chiave della cache di risposta diventa `keyGroup :: container :: subject\|roles :: METHOD url`, con il contenitore **scritto** (`control` oppure `tenant:<id>`) e non dedotto: era già isolata per tenant, ma per proprietà emergente, ed è esattamente il modo in cui D-15 era nato. L'invalidazione dichiarata da una rotta ora spazza solo il contenitore in cui la richiesta è girata: una scrittura dentro un cliente non può aver reso stantii i dati di un altro. D-26 **deciso e scritto** (verbale in `EVO_PUNTI_APERTI.md`, punto 4): resta in memoria per processo, niente porta Redis, e il TTL di default diventa doppio, scelto dalla forma del deployment, 3600s senza blocco `tenants` e 60s con i tenant dichiarati, più un avviso all'avvio. Caso residuo dichiarato: una single-tenant su più istanze deve fissare `cache.ttl` a mano. 7 test in `test/lib/cache.spec.ts`, 208 verdi con Postgres reale. `docs/CACHE.md` riscritto nelle sezioni 3, 4 e 6 |

## Fase 4: identità e ruoli di sistema

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-4.1 | Utenti e ruoli di sistema nel piano di controllo | `[x]` | due cataloghi separati, non due voci dello stesso: `global.systemRoles` con i tre ruoli protetti di `lib/config/systemRoles.ts` e il catalogo di capability **chiuso** (`SYSTEM_CAPABILITIES`), accanto a `global.roles` che resta quello dei tenant. Il compilatore fa la parte che può: `SystemRole.code` è `` `system:${string}` `` e le sue capability sono un'unione letterale chiusa. La parte che non può la fa il router all'avvio (§2.1): rotta di controllo con ruolo di tenant, rotta di tenant con ruolo di controllo, capability dal catalogo sbagliato, tutte **rifiutano la partenza**. Ha trovato subito le sette rotte `/tenants/*`, che dichiaravano `roles: [roles.admin]`, ora su capability di controllo. `lib/database/managers/systemUser.ts`: ogni metodo prende un `ControlHandle`, quindi un'identità di piattaforma non è raggiungibile da dentro un contenitore. Token con `scp: 'control'` e **senza** `tid`; il gate §2.2 è completo (token di controllo dentro un tenant rifiutato in T-3.2, token di tenant su rotta di piattaforma rifiutato qui, 403 `SCOPE_MISMATCH`). Rotte `/system/auth/*` e `/system/users/*` in `lib/api/system/`. Genesi biforcata: con i tenant dichiarati `ADMIN_EMAIL` semina un **utente di sistema** con `system:admin`. **Scelta di disegno dichiarata**: la separazione vale dove i due piani esistono davvero, quindi senza blocco `tenants` le rotte di controllo continuano ad autenticare gli utenti dell'applicazione e `/system/*` non viene montato. **Rinviato con motivo**: il flusso MFA per gli utenti di sistema (le colonne ci sono, il flusso arriva con T-6.3 che ne ha bisogno davvero); nel frattempo il login di un utente di sistema con MFA attivo **rifiuta** invece di saltare il fattore. 12 test nuovi (`test/lib/systemScope.spec.ts`, `test/db/managers.spec.ts`, `router.spec.ts`), 223 verdi con Postgres reale |
| T-4.2 | Impersonificazione tracciata | `[x]` | il record viene scritto **prima** del token, e l'ordine è la correzione, non un dettaglio: un token emesso prima della traccia è un token la cui traccia può fallire. `lib/database/managers/impersonation.ts` nel piano di controllo (un tenant che potesse scrivere il proprio registro di impersonificazioni si starebbe controllando da solo); `getImpersonation` risponde solo per una sessione né revocata né scaduta, così chi chiama non può dimenticare uno dei due controlli. `reason` obbligatorio (400 `REASON_REQUIRED`, e senza motivo non si scrive niente). TTL 30 minuti di default, massimo assoluto 4 ore non configurabile, contro le 24 ore della v4. Il token emesso è **di tenant** con `imp`: dentro il contenitore la sessione è un utente ordinario. Ogni richiesta verifica il **record**, non la firma, quindi la revoca vale subito: `POST /tenants/impersonate/end` e la richiesta successiva riceve 403 `IMPERSONATION_ENDED`. Il costo è una lettura sul piano di controllo per richiesta impersonata, dichiarato in commento. Corretti due difetti dei documenti (regola §0): `docs/AUTHORIZATION_V5.md` §6 chiedeva che le scritture tracciate registrassero la sessione e `change` non aveva dove metterla, quindi la colonna `impersonation_id` è entrata in `docs/SCHEMA_V5.md` §2.3 (colonna e non chiave dentro `contents`: un audit trail il cui attore non è indicizzabile è mezzo audit trail); e `/tenants/impersonate/end` era «authenticated (control)», che su una rotta di controllo si risolve nel solo superuser, quindi è passata alla capability `tenants:impersonate`. La stringa magica `'system'` e il ramo morto non esistono più (verificato con grep). 13 test in `test/lib/impersonation.spec.ts`, 236 verdi con Postgres reale |
| T-4.3 | «Fondatore» risolto nel contenitore | `[x]` | `isFounderEmail` non esiste più: al suo posto `isFounder(user)` in `lib/util/authz.ts`, che legge la colonna `is_founder` della riga. La domanda la risponde il contenitore in cui la riga vive, quindi due tenant hanno ciascuno il proprio fondatore e nessuno eredita le protezioni dell'altro. Cinque guardie in `lib/api/users/controller/user.ts` migrate. `ADMIN_EMAIL` sopravvive per un solo lavoro, seminare la prima identità all'avvio, e non viene letto in nessun altro punto (verificato con grep). La genesi ora **riconcilia la riga**: crea con `isFounder: true` su un contenitore senza sovrano, promuove una riga esistente se il contenitore non ne ha, e **rifiuta di coniarne un secondo** se ce n'è già uno, scrivendolo nel log. Cambiare la variabile d'ambiente non sposta più la sovranità: era esattamente ciò che rendeva D-27 un problema di privilegi e non di nomenclatura. Se la conta dei fondatori fallisce, la risposta è «ce n'è uno», perché l'altra risposta è quella che ne conia uno. 7 test nuovi fra `authz.spec.ts` e `genesis.spec.ts`, più `genesis.spec.ts` reso autonomo (dipendeva da un `global.log` impostato da un altro file). 239 verdi con Postgres reale. README e `docs/MIGRATION_V4_V5.md` aggiornati |

## Fase 5: migrazioni e flotta

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-5.1 | Motore, formato, collocazione della versione | `[ ]` | |
| T-5.2 | Due insiemi di migrazioni | `[ ]` | |
| T-5.3 | Migratore di flotta, comando e API | `[ ]` | |
| T-5.4 | Controllo di allineamento all'avvio | `[ ]` | |

## Fase 6: ciclo di vita del tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-6.1 | Creazione | `[ ]` | |
| T-6.2 | Export del contenitore | `[ ]` | |
| T-6.3 | Distruzione a due fasi | `[ ]` | |

## Fase 7: contenitore per tenant

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-7.1 | Contenitore su Postgres e cache LRU | `[ ]` | |
| T-7.2 | Contenitore su file, SQLite e libSQL | `[ ]` | |
| T-7.3 | Replica continua dietro una porta | `[ ]` | |

## Fase 8: igiene del core e chiusura

| | Compito | Stato | Evidenza |
|---|---|---|---|
| T-8.1 | Sicurezza del core (CORS, enumerazione, dipendenze) | `[ ]` | |
| T-8.2 | Raccolta dei difetti minori | `[ ]` | |
| T-8.3 | Guida di migrazione v4 → v5 | `[~]` | `docs/MIGRATION_V4_V5.md` aperto con le rotture già in codice: subpath `/db`, blocchi `control`/`tenants`, contesto sulla richiesta e manager con contesto primo, `scope` al posto di `tenantContext`, risoluzione dal token, Magic Query, rotte rimosse. Si accumula riga per riga a ogni rottura, non si scrive alla fine |
| T-8.4 | Allineamento di `volcanic-backend-sample` e `volcanic-admin` | `[ ]` | |

---

## Fuori piano, da non perdere

| | Stato | Nota |
|---|---|---|
| Push forzato di `develop` su `origin` | `[ ]` | il remoto è indietro di 209 commit; serve una richiesta esplicita |
| Cartelli sui documenti v4 | `[x]` | `DATA_LAYER_MAGIC.md` e `CONFIGURATION.md` marcati come sostituiti, `AUTH_COMPOSABLE_EVOLUTION.md` come rinviato fuori dalla v5 |
| `docs/AUTHORIZATION_MODEL.md` | `[-]` | resta valido: `AUTHORIZATION_V5.md` lo estende, non lo sostituisce |
| Dipendenze Drizzle installate e verificate su Node 24.11 | `[ ]` | `drizzle-orm`, `drizzle-kit`, `better-sqlite3` (build nativo, da provare), `@libsql/client`. `pg` e `bcrypt` ci sono già |
| `npm audit fix` sulla baseline | `[ ]` | da fare **prima** di aggiungere le dipendenze nuove, altrimenti l'audit successivo non dice più chi ha portato cosa |
| Finestra senza rete di test | `[~]` | aperta il 6 settembre 2026. `check-all` e `npm test` sono verdi, e i test risaliti a 156 (89 sul data layer, contro Postgres reale) contro i 432 della v4: le suite end-to-end si rifanno in fase 2 su `docs/TESTING_V5.md` §1, recuperando gli spec da `main` (`git show main:test/e2e/auth-lifecycle.e2e.spec.ts`). Ripristino del codice vecchio: `git checkout main -- lib/database typeorm.ts` |
| Misure di tempo rifatte su macchina dedicata | `[ ]` | quelle dell'appendice A vengono da un portatile condiviso: non usarle per dimensionare |
