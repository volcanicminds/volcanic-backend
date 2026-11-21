# EVO fase 21: il canale degli avvisi per gli amministratori

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce da T-7.18 di `volcanic-rag/TASKS.md`: qui c'è la parte del backend, il canale generico;
> le fonti (il RAG per primo) e la pagina della console stanno nei loro repository.
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5`.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 1. Da dove si parte, verificato il 21 novembre 2026

- Nel backend non esiste niente che si chiami avviso, notifica o posta in arrivo: né codice, né
  tabelle, né rotte.
- Il modello più vicino per una registrazione all'avvio è `tenantLifecycles`
  (`lib/util/tenantLifecycle.ts`): una lista passata a `start()`, controllata al boot (nome valido,
  nessun doppione) e congelata.
- Il piano di controllo di un'installazione senza tenant contiene sia `user` sia `system_user`:
  `session`, `auth_flow`, `external_identity` e `access_log` li distinguono con la colonna `scope`.

## 2. Decisioni

- **F105**: il backend non conosce nessuna fonte. Un pacchetto che ha avvisi passa una
  `NoticeSource` a `start({ noticeSources })`: nome, piani su cui risponde (`tenant`, `control`) e
  `notices(req, plane)`, che risponde con gli avvisi correnti già filtrati per chi legge.
- **F106**: un avviso non contiene testo. Porta `id` (stabile per un'occorrenza, unico nella fonte),
  `kind`, `level` (`info` o `warning`), `at` facoltativo (istante ISO completo) e `data`; la console
  compone la frase dal suo dizionario, chiave `notice.<fonte>.<kind>`.
- **F107**: il backend tiene solo chi ha visto quale avviso, in `notice_seen (notice, reader, scope,
  seen_at)`, chiave `(notice, reader, scope)`, nel contenitore di chi legge: in ogni tenant e nel
  piano di controllo. `notice` è `<fonte>:<id>`; `scope` è `tenant` per un `user` e `system` per un
  `system_user`.
- **F108**: a ogni lettura i segni di una fonte che ha risposto, il cui avviso non è più corrente,
  si cancellano: un avviso che sparisce e torna è di nuovo nuovo. I segni di una fonte che fallisce
  restano, perché una fonte che non risponde non dice cosa è sparito.

## 3. Compiti

- [x] **T-21.1** Il canale nel backend. `start({ noticeSources })` con il controllo al boot
  (`lib/util/notices.ts`, `noticeSourcesOf`); la tabella `notice_seen` in `appTables`
  (`lib/database/schema/pg.ts`), nelle due migrazioni `0000` riscritte al loro posto con le
  istantanee; il manager `noticeManager` (`lib/database/managers/notice.ts`); le rotte
  `GET /notices`, `POST /notices/seen`, `GET /system/notices` e `POST /system/notices/seen`, sotto
  la capacità `notices`, riservata da entrambi i cataloghi come `manifest` e `governance-log`. Una
  fonte che lancia un errore finisce nel log e in `failed`, le altre rispondono; un avviso
  malformato fa fallire tutta la sua fonte. `POST .../seen` ignora un id che la sua fonte non
  serve in quel momento. Una credenziale che non è una persona riceve 403.
  **Fatto quando**: `check-all` è pulito; le prove unitarie, quelle del livello dati su PGlite e su
  Postgres, quelle delle migrazioni e una prova end to end sulle due strategie sono verdi; un
  difetto piantato fa cadere almeno una prova.
  **Prove**, il 21 novembre 2026: `check-all` pulito; `test:lib` 824 verdi (`test/lib/notices.spec.ts`
  11); su Postgres 18 con `DATABASE_URL`, `test:db` 398 verdi (`test/db/notices.spec.ts` su PGlite e
  Postgres), `test:migrations` 45 verdi, `test/e2e-mt-pg/notices.e2e.spec.ts` 10 verdi sulle due
  strategie (ogni amministratore di tenant vede solo i suoi avvisi, quello della piattaforma solo
  quelli del piano di controllo, il segno sopravvive a un nuovo login e sta nel contenitore di chi
  legge, un avviso sparito e tornato è di nuovo non visto, una fonte che fallisce non ferma le
  altre). Togliendo la cancellazione dei segni sparsi cadono due prove di `test/lib/notices.spec.ts`.
  `npm run db:generate` e `db:generate:tenant` rispondono «No schema changes, nothing to migrate».
  `scripts/check-migration-sets.mjs` rifiuta in `meta` ogni voce che non sia il journal o uno
  snapshot, perché drizzle-kit la leggerebbe come snapshot (una cartella `.claude` lì dentro ferma
  `db:generate:tenant` con `EISDIR`), e `scripts/copy-assets.mjs` non copia in `dist` le voci
  nascoste. Fuori da questa fase e presenti anche senza le sue modifiche: in `test:e2e:mt:pg`
  cadono le due prove «in cookie mode takes the token from the header» di
  `controlToken.e2e.spec.ts`.
- [ ] **T-21.2** La prima fonte e la pagina. Il RAG registra `ragNotices()` (`volcanic-rag`,
  T-7.18); `volcanic-admin` ha una pagina «Avvisi» e un pop-up per ogni fonte.
  **Fatto quando**: nel browser un avviso non visto compare una volta, su qualsiasi computer lo
  stesso amministratore apra, e resta nella pagina.
  **Evidenze**, 21 novembre 2026: `ragNotices()` è registrato e coperto dai test del RAG
  (T-7.18); `volcanic-admin` ha la pagina `/notices`, la campanella con il conteggio dei non visti
  e il pop-up, con la frase composta dai dizionari (`test/engine/notices.test.ts`, 10 test). Nel
  browser sul sample: il pop-up compare una volta, chiuderlo scrive il segno di visto sul server,
  dopo il ricaricamento non ricompare e la pagina conserva l'avviso.
  Le rotte degli avvisi stanno fuori dal manifest con `manifest: { exclude: true }`, così la
  console non ne disegna una seconda voce: `test/lib/manifestRealRoutes.spec.ts` lo verifica su
  entrambi i piani e fallisce se il router non passa l'opzione; il manifest del sample, generato
  all'avvio, non ha più la risorsa `notices`.
  **Resta**: la prova su un secondo computer.
