# EVO checklist TODO

> Piano di rilievo per l'evoluzione multi-tenant di `@volcanicminds/backend`.
> **Questo file è il metodo, non il risultato.** Il risultato va in `EVO_FRAMEWORK.md`.
>
> Regola unica di questo documento: **niente si dà per assunto**. Ogni casella si chiude
> solo con un riferimento `file:riga` o con l'output di un comando eseguito. Se una voce
> non si riesce a verificare, si scrive perché e resta aperta.
>
> Avvio: 1 settembre 2026 · repository `volcanic-backend` v4.0.3 · branch `main`, allineato a `origin/main`.

## Legenda

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[x]` | fatto, con evidenza citata |
| `[-]` | non applicabile, con motivo scritto |
| **CONFERMATA** / **SMENTITA** / **PARZIALE** | esito di una verifica su un'assunzione |

---

## A. Rilievo integrale del codice

Obiettivo: aver letto **ogni** file sorgente almeno una volta, non cercato per parole chiave.
Perimetro: 8.647 righe in `index.ts`, `typeorm.ts`, `server.ts`, `lib/**`, `types/**`.

- [x] **A1** `server.ts`, `index.ts` (453 righe): sequenza di boot, ordine di registrazione dei plugin, punti di fail-fast, iniezione dei manager.
- [x] **A2** `lib/loader/*` (11 file): `router`, `schemas`, `hooks`, `plugins`, `roles`, `schedules`, `tracking`, `tenant`, `translation`, `general`, `genesis`. Per ciascuno: cosa scopre, in che ordine, cosa succede se manca.
- [x] **A3** `lib/hooks/*` (5 file): catena completa `onRequest → preHandler → preSerialization → onResponse → onError`, con attenzione a chi crea e chi distrugge risorse.
- [x] **A4** `lib/middleware/*` (5 file) e `lib/util/*` (13 file): `authz`, `secret`, `cache`, `tracker`, `logger`, `regexp`, `httpError`, `errors`, `mark`, `path`, `common`, `yn`, `generate`, `require`.
- [x] **A5** `lib/api/*` (7 gruppi): `auth` (593+256), `users` (288+262), `tenants` (211+149), `token` (114+150), `tool`, `health`, `admin`. Per ciascuna rotta: ruolo richiesto, contesto db usato, cosa tocca.
- [x] **A6** `lib/schemas/*` (6 file) e `lib/config/*` (5 file): valori di default e loro effetto in produzione.
- [x] **A7** `lib/manifest/generator.ts` (349 righe): cosa espone e a chi.
- [x] **A8** Data layer completo: `typeorm.ts`, `lib/database/typeorm/query.ts` e `query/*`, `entities/*`, `loader/*`, `util/*`, `embedded.ts` (2.003 righe totali in `lib/database`).
- [x] **A9** `types/global.d.ts` (397 righe), `types/orm.d.ts`, `types/database/typeorm/global.ts`: cosa promette il tipo che il runtime non mantiene.
- [x] **A10** Catena di build e pubblicazione: `package.json` (`exports`, `files`, `sideEffects`, peer), `tsconfig.json`, `scripts/copy-assets.mjs`, `scripts/run-tests.mjs`, `.dependency-cruiser.cjs`, `.github/workflows/ci.yml`.

---

## B. Verifica puntuale delle assunzioni

Ogni voce è un'affermazione fatta **prima** di questo rilievo. Va confermata o smentita
con `file:riga`. Le smentite contano quanto le conferme e vanno scritte con la stessa evidenza.

- [x] **B1** «Multi-tenant su Mongo è fail-open: avvisa e prosegue senza isolamento.»
- [x] **B2** «`multi_tenant.resolver: 'subdomain'` è il default ed è codice morto: nessuno lo legge.»
- [x] **B3** «L'header del tenant è obbligatorio anche quando il JWT porta il `tid`.»
- [x] **B4** «Non esistono migrazioni: i tenant nascono con `synchronize: true`.»
- [x] **B5** «Il `QueryRunner` ha due percorsi di rilascio e solo uno resetta `search_path`.»
- [x] **B6** «In multi-tenant si crea un `QueryRunner` per **ogni** richiesta, anche per rotte che non toccano il database.»
- [x] **B7** «La concorrenza è tappata dalla dimensione del pool.» Verificare quale pool, con che default, e cosa succede a saturazione.
- [x] **B8** «Non esiste alcuna strategia contenitore per tenant (database o file dedicato).»
- [x] **B9** «Non esiste il concetto di piano di controllo separato dai dati dei tenant.»
- [x] **B10** «Non c'è CI.» *(sospetta: `.github/workflows/ci.yml` esiste)*
- [x] **B11** «`docs/AUDIT_TASKS_TODO.md` ha 13 voci aperte.» Per ciascuna: è ancora vera oggi nel codice?
- [x] **B12** «Tutte le suite girano su un motore solo (PGlite): zero Postgres reale, zero Mongo, zero SQLite.»
- [x] **B13** «TypeORM è confinato: fuori da `lib/database` compare in 3 file.»
- [x] **B14** «Il data layer è il 24% del codice.» Ricalcolare.

---

## C. Multi-tenancy: stato reale e superficie di rischio

- [x] **C1** Disegnare il percorso completo di una richiesta in modalità multi-tenant, dal primo hook al rilascio della connessione, con i file e le righe di ogni passaggio.
- [x] **C2** Elencare **tutte** le rotte e i punti che escono dal contesto tenant (`tenantContext: false`, uso di `global.connection`, uso di `global.repository`) e valutare per ciascuno il rischio.
- [x] **C3** Cache: la chiave include il tenant? Verificare sul codice, non sul test.
- [x] **C4** JWT: dove entra il `tid`, chi lo firma, cosa succede se manca, cosa succede se non corrisponde.
- [x] **C5** Genesi dell'admin (`lib/loader/genesis.ts`) e `ADMIN_EMAIL`: cosa fa in multi-tenant, in quale schema scrive.
- [x] **C6** Lavori fuori dalla richiesta (`lib/loader/schedules.ts`, `toad-scheduler`): come ottengono un contesto tenant, e cosa fanno se non ce l'hanno.
- [x] **C7** Ciclo di vita del tenant: creazione, aggiornamento, cancellazione logica, ripristino. **Cosa non fa**: distruzione dello schema, migrazione dello schema, export.
- [x] **C8** Messaggi di errore e codici HTTP in multi-tenant: cosa distingue «tenant inesistente» da «tenant sospeso» da «token di un altro tenant», e cosa questo rivela a chi sonda.
- [x] **C9** Verificare se esiste un percorso in cui una connessione torna nel pool con `search_path` non ripulito, e in quali condizioni.
- [x] **C10** Verificare il comportamento sotto errore: se `switchContext` lancia, la richiesta viene rifiutata o prosegue?

---

## D. Sicurezza

- [x] **D1** Rileggere `docs/AUDIT_TASKS_TODO.md` per intero e riclassificare ogni voce aperta: ancora valida, già risolta, non più applicabile.
- [x] **D2** Eseguire `npm audit` e riportare l'esito reale, non quello del documento di giugno.
- [x] **D3** Default di `lib/config/plugins.ts`: CORS, helmet, rate limit, compressione. Cosa fa un consumer che non configura niente.
- [x] **D4** Gestione dei segreti: `lib/util/secret.ts`, quali segreti sono obbligatori, quali sono controllati, quali no.
- [x] **D5** `lib/database/typeorm/util/crypto.ts`: cosa cifra, con quale algoritmo, con quale chiave, e cosa succede se la chiave manca o cambia.
- [x] **D6** Iniezione: ogni punto in cui una stringa esterna finisce in SQL. `SET search_path`, `CREATE SCHEMA`, la Magic Query, gli operatori `raw`.
- [x] **D7** `_logic`: verificare il parser (`lib/database/typeorm/query/parser.ts`) e la profondità massima accettata.
- [x] **D8** Enumerazione utenti: verificare i messaggi reali di `auth.ts` e degli hook.
- [x] **D9** Impersonificazione: se esiste, dove sta, cosa registra, quanto dura.
- [x] **D10** Superficie amministrativa: `/tool/synchronize-schemas` e `/admin/manifest`, chi può chiamarle e cosa fanno.

---

## E. Migrazioni e ciclo di vita dello schema

- [x] **E1** Ricostruire come nasce oggi lo schema: al primo avvio, alla creazione di un tenant, a un deploy successivo.
- [x] **E2** Rispondere per iscritto: cosa succede oggi se un'entità cambia e ci sono 100 schemi di tenant in produzione.
- [x] **E3** Stabilire cosa serve: strumento, formato dei file, dove vive il numero di versione, come si applica al piano di controllo e come agli N tenant.
- [x] **E4** Definire i requisiti non negoziabili del migratore di flotta: idempotenza, ripresa dopo interruzione, lock contro esecuzioni concorrenti, comportamento su fallimento parziale, verifica di allineamento all'avvio.

---

## F. Contenitore per tenant: fattibilità reale

- [x] **F1** Elencare i punti esatti del codice da toccare per aggiungere una strategia `container` (database o file per tenant), con `file:riga`.
- [x] **F2** Misurare o stimare con evidenza il costo di una `DataSource` TypeORM per tenant, e cosa comporta a 100-300 tenant.
- [x] **F3** Stabilire cosa della Magic Query è specifico di Postgres e non funzionerebbe su SQLite.
- [x] **F4** Definire come la strategia contenitore si innesta sul modello a due blocchi (piano di controllo separato dai tenant) senza rompere i consumer esistenti.
- [x] **F5** Verificare quale codice del framework assume implicitamente **una sola** connessione globale (`global.connection`).

---

## G. Test: copertura reale e necessità

- [x] **G1** Eseguire la suite completa e riportare esito, durata, fallimenti.
- [x] **G2** Misurare la copertura reale con uno strumento, non con il conteggio dei test.
- [x] **G3** Elencare cosa **non** è coperto e conta: motori diversi, concorrenza, saturazione del pool, isolamento sotto carico, errori del percorso tenant.
- [x] **G4** Definire i test che l'evoluzione richiede **prima** di scrivere il codice nuovo, distinguendo quelli che dimostrano una **proprietà** da quelli che verificano una **configurazione**.
- [x] **G5** Verificare se `tsconfig.json` include i test nel controllo dei tipi.

---

## H. DevOps e rilascio

- [x] **H1** Leggere `.github/workflows/ci.yml`: cosa verifica, cosa non verifica, dove pubblica.
- [x] **H2** Verificare `package.json`: `exports`, `files`, `sideEffects`, `engines`, coerenza fra `peerDependencies` e ciò che il codice importa davvero.
- [x] **H3** Stabilire la politica di versionamento per l'evoluzione: cosa è breaking per i consumer esistenti e cosa no.

---

## I. Sintesi

- [x] **I1** Scrivere `EVO_FRAMEWORK.md`: cosa fare, come, in che ordine, con quale scopo, e su cosa fare attenzione. Destinatari: sviluppatori senior e agenti di coding che **non conoscono nulla** del contesto e avranno solo quel documento.
- [x] **I2** Rileggere `EVO_FRAMEWORK.md` fingendo di non sapere niente: ogni frase che richiede un'informazione non contenuta nel documento va riscritta o rimossa.
- [x] **I3** Riportare in questo file, in coda, l'elenco delle assunzioni **smentite** dal rilievo.

---

## Esito del rilievo

**Rilievo eseguito il 1 settembre 2026.** Tutte le voci sono state percorse. Il risultato
operativo (cosa fare, come, in che ordine) è in **`EVO_FRAMEWORK.md`**, che è il documento da
consegnare. Qui restano solo gli esiti del metodo: cosa è stato letto, cosa è stato misurato,
e quali assunzioni di partenza sono state **smentite**.

### A. Cosa è stato letto

Letti integralmente: `server.ts`, `index.ts`, tutti gli 11 file di `lib/loader/`, tutti i 5
hook di `lib/hooks/`, tutti i 5 middleware, tutti i 13 file di `lib/util/`, tutte le 7 aree
di `lib/api/`, i 5 file di `lib/config/`, i 6 schemi di `lib/schemas/`,
`lib/manifest/generator.ts`, l'intero data layer `lib/database/typeorm/**` (2.003 righe),
`types/global.d.ts` e `types/orm.d.ts`. Letti inoltre `test/e2e-mt/harness.ts`,
`.dependency-cruiser.cjs`, `tsconfig.json`, `.github/workflows/ci.yml`, `scripts/*.mjs` e
`docs/AUDIT_TASKS_TODO.md`. Sono state ispezionate anche le parti rilevanti di
`node_modules`: `fastify/lib/route.js`, `fastify/lib/reply.js`,
`typeorm/driver/postgres/PostgresQueryRunner.js`, `typeorm/data-source/DataSource.js`,
`typeorm/query-builder/SelectQueryBuilder.js`, `pg-pool/index.js`,
`typeorm-pglite/dist/pglite-pool.js`.

### B. Esito delle assunzioni

| # | Assunzione di partenza | Esito | Riferimento |
|---|---|---|---|
| B1 | Mongo in multi-tenant è fail-open | **CONFERMATA** | D-04 |
| B2 | `resolver: 'subdomain'` è il default ed è codice morto | **CONFERMATA** | D-11 |
| B3 | L'header è obbligatorio anche quando il JWT porta il `tid` | **CONFERMATA, e la causa è peggiore**: il controllo anti-spoofing è codice morto per due motivi indipendenti | D-03 |
| B4 | Non esistono migrazioni | **CONFERMATA** | fase 2 di `EVO_FRAMEWORK.md` |
| B5 | Due percorsi di rilascio, un solo reset | **CONFERMATA e provata su Postgres reale** | D-01, appendice A.1 e A.2 |
| B6 | Un `QueryRunner` per ogni richiesta | **CONFERMATA** | `lib/loader/tenant.ts:66` |
| B7 | La concorrenza è tappata dal pool | **CONFERMATA e quantificata**: il muro è `max_connections`, non la memoria | D-10, appendice A.3 |
| B8 | Nessuna strategia contenitore | **CONFERMATA** | fase 4 |
| B9 | Nessun piano di controllo separato | **CONFERMATA** | fase 3 |
| B10 | Non c'è CI | **SMENTITA**: `.github/workflows/ci.yml` esiste ed è completa (lint, type-check, depcruise, build, publint, attw, test, pubblicazione al tag) | sezione 2 |
| B11 | 13 voci di audit aperte | **PARZIALE**: le caselle aperte sono 13, ma **Q11 (niente CI) è obsoleta** e **S5 (niente rate limit su auth) è in gran parte chiusa**: le rotte di autenticazione dichiarano `rateLimit` (10 richieste per 60 s, configurabile). **Q12 è invece sottostimata**: 6 vulnerabilità in produzione, 5 alte | D-22 |
| B12 | Un solo motore nei test | **CONFERMATA, ed è la scoperta più importante sul piano dei test**: PGlite non ha un pool, quindi l'intera classe D-01 è irraggiungibile | T-0.3 |
| B13 | TypeORM confinato a 3 file fuori dal data layer | **CONFERMATA** | fase 5 |
| B14 | Il data layer è circa il 24% del codice | **CONFERMATA**: 2.003 righe su 7.532 di `lib/`, cioè il 26,6% | fase 5 |

### C. Cosa il rilievo ha trovato e non era stato ipotizzato

Le voci **D-01** (perdita provata), **D-02**, **D-05** (audit trail silenziosamente rotto in
multi-tenant), **D-06**, **D-07**, **D-08** (un tenant appena creato non è utilizzabile),
**D-09**, **D-13**, **D-14**, **D-15**, **D-20**, **D-21**, **D-24**, **D-27**, **D-29** di
`EVO_FRAMEWORK.md` non erano nell'elenco di partenza.

### D. Misure

| | |
|---|---|
| Test | 432 passano, 0 falliscono, 11 suite, ~65 s |
| Copertura | righe 79,71% · rami 72,08% · funzioni 77,51% |
| `npm audit --omit=dev` | 6 vulnerabilità, 5 alte |
| Costo `DataSource` per tenant | 44 KiB e 9,6 ms ciascuna, ma **una connessione ciascuna**: a 150 il processo muore con `sorry, too many clients already` |
| `scryptSync` sul percorso MFA | 82,3 ms bloccanti per derivazione |

### E. Cosa questo rilievo NON dice

- Le misure di tempo vengono da un portatile condiviso: vanno rifatte su macchina dedicata
  prima di usarle per dimensionare.
- La perdita di `search_path` è provata sul meccanismo (ordine dei listener, assenza di reset
  nel pool e nel driver) e riprodotta su Postgres 16 con un pool a una connessione. **Non è
  stata riprodotta facendo girare l'applicazione completa** contro un Postgres reale: quel
  banco è il compito T-0.3, che va scritto per primo e deve fallire.
- Non sono state esaminate le dipendenze `@volcanicminds/tools` né i repository consumer.
- Non è stata eseguita alcuna modifica al codice: il rilievo è di sola lettura.
