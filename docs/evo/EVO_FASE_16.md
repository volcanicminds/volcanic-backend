# EVO fase 16: un database per tenant, e i pacchetti che seguono la vita del tenant

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce da T-7.2 di `volcanic-rag` (il corpus di ogni tenant creato, esportato e distrutto con
> il tenant) e da una richiesta di un cliente del 12 ottobre 2026: la strategia `container`, un
> database per tenant, che fin qui creava uno schema come la strategia `schema`.
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5`; T-7.2 resta scritto e chiuso in
> `volcanic-rag/TASKS.md`.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 1. Decisioni

| # | Decisione | Motivo |
|---|---|---|
| F77 | Con `strategy: 'container'` il **contenitore è un database** che porta il nome del locator: creato con `CREATE DATABASE` fuori da ogni transazione, migrato con le migrazioni del tenant nel suo `public`, esportato con `pg_dump` del database intero, contato con `pg_database_size` e le tabelle del suo `public`, eliminato con `DROP DATABASE ... WITH (FORCE)` dopo aver chiuso il pool che il processo tiene su di esso. Un database già esistente con quel nome è rifiutato, mai adottato. La strategia del corpo di `POST /tenants` deve essere quella del deployment, altrimenti 400 `TENANT_STRATEGY_MISMATCH` | la strategia era dichiarata ma creava uno schema: la riga di registro descriveva un contenitore che non esisteva in quella forma; un database trovato già lì ha un contenuto che nessuno ha verificato; senza `FORCE` una sessione aperta da un'altra istanza fa fallire la distruzione; un deployment ha una strategia sola, quindi una riga con l'altra è un tenant irraggiungibile |
| F78 | Una **porta pubblica del ciclo di vita del tenant**, `TenantLifecycle`, passata a `start({ tenantLifecycles })`: `create(place, handle)` dopo che il contenitore è creato e migrato e prima della riga di registro, `export(tenant, target)` dopo il dump e accanto a esso, `destroy(place)` prima del drop del contenitore. Un `create` che fallisce annulla tutti i pacchetti partiti, quello che fallisce compreso, in ordine inverso, poi il contenitore; un `export` che fallisce rimuove il dump e ogni artefatto; un `destroy` che fallisce ferma la distruzione con il contenitore ancora lì. Nomi controllati all'avvio. Accanto, `access(handle).raw` (`query`, `transaction`): SQL testuale con parametri `$n` dentro il contenitore, con la stessa regola di `execute` | un pacchetto che tiene dati per tenant fuori dal contenitore (file, un indice suo) è invisibile al framework: senza porta un export li lascerebbe fuori e una distruzione li lascerebbe indietro; i metodi del contenitore erano un'interfaccia privata del controller; il nome finisce nei nomi dei file dell'export; un pacchetto che non usa l'ORM avrebbe dovuto aprire una connessione sua e scegliere a mano schema o database |
| F79 | Il **token di integrazione porta `tid`**, il tenant in cui è stato creato, come il token di una sessione; senza tenant non porta il claim. Una macchina manda il solo token; un header che nomina un altro tenant è 403 `TENANT_MISMATCH` | firmato con il solo `sub`, il token obbligava la macchina a nominare il tenant con l'header, contro `docs/AUTHORIZATION_V5.md` §5 ("The tenant of a request comes from `tid`, never from a header, whenever a token is present"); deciso dal proprietario il 13 ottobre 2026 |
| F80 | Un **contenitore già esistente è rifiutato sotto entrambe le strategie**, schema compreso: `createContainer` risponde `false` senza toccarlo, e `POST /tenants` risponde 409 `TENANT_LOCATOR_TAKEN` prima di costruire qualcosa | sotto `schema` la creazione usava `if not exists`: uno slug che, sanificato, dà il locator di un altro tenant, o un locator dichiarato uguale, adottava il suo schema, e l'annullamento di una creazione fallita lo eliminava con i dati dell'altro tenant; deciso dal proprietario il 13 ottobre 2026 |
| F81 | Sotto tenancy un **token del piano tenant senza `tid` è rifiutato** con 401 `TOKEN_TENANT_MISSING`, qualunque cosa dica l'header | ogni token firmato dal framework dentro un tenant porta `tid` (F79); uno senza è stato firmato dove non c'erano tenant, e l'header accanto sarebbe l'unica cosa a nominare il tenant, contro `docs/AUTHORIZATION_V5.md` §5; v5 non ha retrocompatibilità; deciso dal proprietario il 13 ottobre 2026 |

## 2. Compiti

- [x] **T-16.1** Un database per tenant (F77). `lib/database/adapters/postgres/index.ts`:
  `createContainer` e `dropContainer` per strategia, conteggio di righe e dimensione sul
  database del tenant, export con `wholeDatabase`; `reportIdleErrors` sui pool del piano di
  controllo e di ogni contenitore, perché una connessione inattiva chiusa dal server non faccia
  cadere il processo. `lib/database/containers/export.ts`: `exportPostgres` con o senza
  `--schema`. `lib/api/tenants/controller/tenants.ts`: la strategia del corpo, assente, è quella
  del deployment; diversa, `TENANT_STRATEGY_MISMATCH`.
  Evidenza: `test/db/containers.spec.ts` (7 prove nuove su Postgres: database creato, database
  esistente rifiutato, conteggio di righe e dimensione, export del database intero, pool che
  sopravvive alla chiusura di una connessione inattiva, SQL raw, drop con `FORCE`),
  `test/lib/tenantProvisioning.spec.ts` (strategia del deployment presa e strategia diversa
  rifiutata), `test/e2e-mt-pg/containerLifecycle.e2e.spec.ts` (4, via HTTP: un database per
  tenant, migrato, e nessuno schema nel database di controllo; ogni tenant vede solo i suoi
  utenti; l'export contiene il database del tenant e niente dell'altro né del piano di
  controllo; il database distrutto sparisce e l'altro tenant continua a funzionare). Difetto
  piantato: export con `--schema` anche sotto `container`; cadono 1 prova di `containers.spec.ts`
  e 2 dell'e2e.
- [x] **T-16.2** La porta del ciclo di vita (F78). `lib/util/tenantLifecycle.ts`
  (`tenantLifecyclesOf`, `createInPackages`, `undoPackages`, `exportFromPackages`,
  `destroyInPackages`), tipi `TenantLifecycle`, `TenantPlace`, `ExportedArtifact` in
  `types/global.d.ts`, `RawSql` in `lib/database/access.ts` e nell'adapter Postgres, PGlite
  compreso.
  La risposta dell'export porta `artifacts`, e la riga di governo li registra.
  Evidenza: `test/lib/tenantProvisioning.spec.ts` (7 prove sui pacchetti: girano a contenitore
  completo e prima della riga; annullati in ordine inverso, quello che fallisce compreso, anche
  quando è la riga a fallire; nessuno interpellato se il contenitore fallisce prima; export
  accanto al dump e nessun resto di un export incompleto; nomi rifiutati all'avvio),
  `test/lib/destruction.spec.ts` (2: export e rimozione prima del contenitore, registrati;
  contenitore tenuto quando un pacchetto non riesce a rimuovere la sua parte),
  `test/migrations/export.spec.ts` aggiornato, `test/db/postgres.spec.ts` e
  `test/db/session-state.spec.ts` (2 prove raw ciascuno: parametri legati dentro il tenant e
  connessione lasciata com'era; transazione annullata o confermata per intero; `SET LOCAL` in
  una transazione sul tenant e niente sul piano di controllo), `test/e2e-mt-pg/tenantLifecycle.e2e.spec.ts`
  (4 per strategia, `schema` e `container`: il pacchetto costruisce la sua parte dentro e fuori
  dal contenitore e niente nel piano di controllo; un pacchetto che rifiuta il tenant annulla sé
  stesso e il contenitore e non scrive la riga; la cartella esportata accanto al dump e la
  tabella dentro il dump; la cartella rimossa con il tenant e quella dell'altro intatta).
  Difetto piantato: distruzione senza `destroyInPackages`; cadono 2 prove di
  `destruction.spec.ts` e 2 dell'e2e, una per strategia.
  Uso reale: `volcanic-rag` vi aggancia `ragLifecycle()`, e `volcanic-rag-sample` lo prova via
  HTTP su entrambe le strategie e con entrambi i motori (`npm run test:tenants`, 24 prove).
- [x] **T-16.3** Il token di integrazione porta il suo tenant (F79).
  `lib/api/token/controller/token.ts`: `create` firma `tid` quando la richiesta ha un tenant.
  Evidenza: `test/lib/tokenApex.spec.ts` (1 prova nuova: `tid` firmato dentro un tenant, nessun
  claim senza tenant), `test/e2e-mt-pg/integrationToken.e2e.spec.ts` (2 prove riscritte: il
  bearer porta `tid`; funziona senza header, con l'header del suo tenant, e con quello di un
  altro è 403 `TENANT_MISMATCH`). Difetto piantato: `tid` tolto dalla firma; cadono 1 prova
  unitaria e 2 dell'e2e. Uso reale: `volcanic-rag-sample` manda i documenti di ogni tenant con il
  solo token e prova che l'header di un altro tenant è rifiutato (`npm run test:tenants`, 28
  prove).
- [x] **T-16.4** Un contenitore esistente non è mai adottato (F80).
  `lib/database/adapters/postgres/index.ts`: `createContainer` risponde `true` quando crea e
  `false` su `42P04` (database) o `42P06` (schema), cercato lungo la catena di `cause`;
  `lib/api/tenants/controller/tenants.ts`: `false` è 409 `TENANT_LOCATOR_TAKEN`, prima che il
  contenitore sia segnato come costruito, quindi niente da annullare.
  Evidenza: `test/db/containers.spec.ts` (1 prova riscritta, database esistente rifiutato e
  intatto; 1 nuova, schema esistente rifiutato con le sue tabelle e righe intatte),
  `test/lib/tenantProvisioning.spec.ts` (1 nuova: 409, nessun drop, nessun pacchetto, nessuna
  riga), `test/e2e-mt-pg/tenantLifecycle.e2e.spec.ts` (1 nuova per strategia: un tenant con il
  locator di GLOBEX è 409, e le righe e la cartella di GLOBEX restano). Difetto piantato:
  contenitore esistente adottato (`true` sul duplicato); cadono 2 prove di `containers.spec.ts`
  e 4 dell'e2e, dove l'annullamento elimina il contenitore e la cartella di GLOBEX.
- [x] **T-16.5** Un token senza tenant non è creduto sotto tenancy (F81). `lib/loader/tenant.ts`:
  `claimedTenant` distingue un token verificato senza `tid`, e la risoluzione risponde 401
  `TOKEN_TENANT_MISSING` invece di passare all'header.
  Evidenza: `test/lib/tenantResolution.spec.ts` (1 prova nuova: token senza `tid` con un header
  valido, 401). Difetto piantato: il token senza `tid` ricade sull'header; cade 1 prova.

Gate, 13 ottobre 2026, con `DATABASE_URL` su `postgres:16-alpine`: `npm run check-all` verde;
`npm test` 1053 prove, 1 saltata (`pg_dump` più vecchio del server, ambientale); `npm run
test:e2e:mt:pg` 51. I difetti piantati sono stati tolti e le prove toccate rilanciate verdi. Sulla
macchina di sviluppo il `pg_dump` 16 era quello del container del server, raggiunto con
`docker exec`: il client locale era più vecchio. Dopo T-16.3, lo stesso giorno: `npm run
check-all` verde, `npm test` 1054 prove, 1 saltata, `npm run test:e2e:mt:pg` 51. Dopo T-16.4 e
T-16.5: `npm run check-all` verde (101 rifiuti nominati), `npm test` 1057 prove, 1 saltata, `npm
run test:e2e:mt:pg` 53.

## 3. Segnalato, non toccato

`docs/_BRAINSTORMING_STACK.md` resta non tracciato.
