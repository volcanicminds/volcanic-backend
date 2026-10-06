# EVO fase 15: il tenant nella telemetria, il registro di governo, la ricerca su Postgres

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce dalla richiesta del manutentore del 6 ottobre 2026: il tenant su ogni span e ogni riga di
> log, un registro degli eventi di governo nel piano di controllo, poi in `volcanic-rag` il ramo
> lessicale BM25 (T-11.4) e la strategia `diskann` (T-11.5) sul backend Postgres.
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5` per T-15.1 e T-15.2; `volcanic-rag` per T-11.4 e
> T-11.5, che restano scritti e chiusi in `volcanic-rag/TASKS.md`.

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
| F75 | Il **tenant su ogni riga di log e ogni span** del lavoro di un tenant: la richiesta dal momento in cui il tenant è risolto, e i job con `scope: 'tenant'` o `'every-tenant'`. `tenant_id` sulle righe di log, `tenant.id` sugli span. Solo l'id, mai lo slug. Il contesto sta in `AsyncLocalStorage` nel core (`lib/util/requestContext.ts`); gli span lo ricevono da uno span processor del core, aggiunto all'SDK che il framework avvia. Con un SDK avviato da `--import` solo lo span della richiesta lo porta. Niente attributo sulle metriche | un collettore deve poter filtrare per tenant senza unire a mano log, trace e registro; lo slug è spesso il nome di un cliente, e log e span escono verso il collettore che il deployment ha scelto; il data layer non conosce il tenant al driver con la strategia `schema`, quindi la query lo eredita dal contesto e non da un parametro che attraversa il confine; un SDK già costruito non accetta processor nuovi (sdk-trace 2.x); una serie di metriche per tenant moltiplica la cardinalità per il numero di clienti |
| F76 | Un **registro degli eventi di governo** nel piano di controllo, `governance_log`, separato da `access_log` e accanto alle tabelle del registro, così sopravvive alla distruzione del tenant. Le modifiche al registro scrivono l'evento nella stessa transazione del piano di controllo; gli effetti che nessuna transazione raggiunge (export con `pg_dump`, distruzione del contenitore) scrivono prima l'intento, fail-closed, poi l'esito. Lettura con una capability nuova del catalogo chiuso, `governance-log`, concessa a `system:auditor`, su `GET /system/governance-log` paginata con filtri per tenant, azione e attore. Nessuna purga automatica; l'IP troncato come in `access_log` | il registro degli accessi è per tenant, best effort e purgato a 90 e 180 giorni: non può essere la memoria di chi ha creato, sospeso, esportato o distrutto un tenant; il nome segue `access_log`, la capability `access-log` e la rotta `/system/access-log`; transazione dove esiste, intento prima dell'effetto dove non esiste, come la distruzione (voce 4 di `EVO_PUNTI_APERTI.md`) |

## 2. Compiti

- [x] **T-15.1** Il tenant su log e span (F75). `lib/util/requestContext.ts`: contesto per
  richiesta aperto in `onRequest` e riaperto in `preValidation` (Fastify legge il corpo dagli
  eventi del socket e lo perde) e in `onResponse` (gira dal `finish` della risposta);
  `enterTenant` in `lib/loader/tenant.ts` dopo la risoluzione, `runInTenant` in
  `lib/loader/schedules.ts` attorno al job di un tenant; il mixin del logger aggiunge
  `tenant_id`; `tenantSpanProcessor` in `lib/loader/telemetry.ts`, davanti agli exporter che
  l'SDK costruisce da `OTEL_TRACES_EXPORTER`. Costo accettato: `getSpanProcessorsFromEnv` si
  importa per percorso (`@opentelemetry/sdk-node/build/src/utils.js`), legato al peer
  `^0.222.0`, che fissa la minor.
  Evidenza: `test/lib/requestContext.spec.ts`, 5 prove su un server in ascolto e non `inject()`
  (sei richieste concorrenti di tre tenant con corpo da 200 kB, 15 righe ciascuna col proprio
  tenant; span dall'SDK del framework con exporter `console`), più una prova in
  `test/lib/schedules.spec.ts`; quattro difetti piantati, uno alla volta (senza il rientro in
  `preValidation`, senza quello in `onResponse`, senza l'attributo sullo span di richiesta,
  senza il processor nell'SDK), ciascuno fa cadere una prova, e togliere `runInTenant` dal job fa
  cadere la sua. A runtime, server intero su PGlite con un tenant `schema` creato via API
  (`scripts/httpWorld.ts`), `GET /users/me` col token del tenant: `tenant.id` sullo span
  `GET /users/me`, sulla query del soggetto nel contenitore e sugli hook dopo la risoluzione,
  assente sulla lettura del registro e sugli hook di prima; `tenant_id` sulle righe del gestore e
  su `request completed`, assente su `incoming request`. `npm test` 887 prove, 30 saltate senza
  `DATABASE_URL`; `npm run check-all` verde.
- [x] **T-15.2** Il registro di governo (F76). Tabella `governance_log` nell'insieme `control`
  (migrazione generata da drizzle-kit), porta con default Null Object e manager cablato da
  `startDataLayer()`; eventi su tenant (creazione, modifica, sospensione, ripristino,
  cancellazione, richiesta di distruzione, distruzione, export), impersonazione (inizio, fine),
  utenti di sistema (creazione, modifica, cancellazione, blocco, sblocco, reset MFA), identity
  provider (creazione, modifica, cancellazione), politica di creazione degli account; capability
  `governance-log` e rotta di lettura. Chiuso quando: ogni rotta di governo lascia la sua riga,
  una scrittura dell'evento che fallisce annulla la modifica al registro, un export o una
  distruzione senza intento scritto non parte, la riga resta dopo la distruzione del tenant, e
  un auditor la legge mentre un operatore senza capability riceve 403.
  Fatto: migrazione `0006_governance_log_control`, `lib/database/managers/governanceLog.ts`
  (21 azioni a catalogo chiuso, IP troncato come nell'access log, nessuna FK, nessuna pulizia),
  `lib/util/governance.ts` (`governed` per modifica ed evento nella stessa transazione, `intend`
  e `settle` per export e distruzione), 503 `GOVERNANCE_LOG_NOT_AVAILABLE` senza manager,
  `GET /system/governance-log` e `/count` con la capability `governance-log` data a
  `system:auditor`. Evidenza: `test/lib/governanceLog.spec.ts` (8 prove),
  `test/db/governanceLog.spec.ts` (8, su PGlite e su Postgres), nuove prove in
  `tenantProvisioning.spec.ts` e `destruction.spec.ts`, `test/e2e-mt-pg/governanceLog.e2e.spec.ts`
  (4, via HTTP su Postgres 14 usa e getta: tutte e 21 le azioni lasciano la riga, export con
  intento e poi successo, schema del tenant distrutto e righe rimaste, auditor 200 e operatore
  403). Sei difetti piantati, uno alla volta, ciascuno fa cadere almeno una prova: `within` senza
  transazione, `intend` che inghiotte l'errore, l'evento che sovrascrive attore e IP della
  richiesta, `suspend` senza evento, auditor senza capability, rotta senza `requireCapability`.
  `npm test` con `DATABASE_URL` 1031 prove, 1 saltata (`pg_dump` più vecchio del server,
  ambientale); `test:e2e:mt:pg` 39; `npm run coverage` sopra i pavimenti; `npm run check-all`
  verde. L'e2e ha girato sul database `postgres` del cluster usa e getta, non su un database
  dedicato.

## 3. Segnalato, non toccato

Il reset MFA d'emergenza all'avvio (`lib/loader/mfaReset.ts`) scrive solo nell'access log, non in
`governance_log`: non passa da una rotta e non ha un operatore. Il 409 della distruzione con
export fallito riporta ancora il messaggio d'errore dell'export, che può citare la stringa di
connessione; la riga di governo tiene solo il codice.

`docs/_BRAINSTORMING_STACK.md`, non tracciato, è superato in più punti; è la fonte delle due
richieste di questa fase. `EVO_STATO.md` cita T-11.3 di rag fra i compiti aperti, mentre è chiuso
(`src/postgres/`, contratto verde su Postgres 18.6).
