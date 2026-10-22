# EVO fase 20: il registro delle modifiche si chiama `change_log`

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce dalla revisione dei registri della piattaforma, fatta con il proprietario il 22 ottobre
> 2026 insieme a quelli del RAG. La tabella completa, con cosa contiene ogni registro, dove sta e
> quanto dura, è nella decisione D11 di `volcanic-rag/TASKS.md`: qui c'è la parte del backend.
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

## 1. Da dove si parte, verificato il 22 ottobre 2026

- La tabella `change` è dichiarata una volta sola, in `appTables` (`lib/database/schema/pg.ts:116`),
  e quindi esiste in entrambi gli insiemi: `0000_initial_tenant.sql` e `0000_initial_control.sql`,
  ciascuna con gli indici `change_entity_idx` e `change_created_at_idx`. La scrive e la legge solo
  il manager del tracciamento (`lib/database/managers/tracking.ts:19`); nessuna rotta la legge.
- Gli altri due registri del backend hanno già il suffisso: `access_log` in ogni contenitore,
  `governance_log` nel solo piano di controllo.
- `docs/SCHEMA_V5.md` (riga 18) colloca `change` nel solo contenitore del tenant, mentre esiste
  anche nel piano di controllo: il documento è indietro rispetto al codice.

## 2. Decisioni

- **F95** (proprietario, 22 ottobre 2026): `change` diventa `change_log`, come `access_log` e
  `governance_log`. Fra le tabelle di `appTables` la chiave diventa `changeLog`, gli indici
  `change_log_entity_idx` e `change_log_created_at_idx`. Il contratto del manager non cambia
  (`TrackingManagement`, `addChange`, `retrieveBy`): una riga del registro resta una modifica.
- **F96** (proprietario, 22 ottobre 2026): `access_log` e `governance_log` restano due tabelle, e
  `impersonation` resta com'è. Gli accessi contengono dati personali e si cancellano dopo 90 giorni
  nei tenant e 180 per gli operatori, mentre la governance non si cancella mai: in una tabella sola
  «mai cancellato» smetterebbe di essere una proprietà della tabella e diventerebbe una condizione
  della pulizia, dove un errore cancella la governance per sempre o tiene i dati personali più del
  dovuto. I campi in comune sono pochi (quando, evento, esito, chi, IP), e nei contenitori dei
  tenant la tabella unica conterrebbe comunque solo accessi. Per vedere insieme accessi e azioni
  di un operatore basta una lettura sulle due. `impersonation` è la sessione in corso, che ogni
  richiesta impersonata rilegge e la revoca modifica (`lib/hooks/onRequest.ts:138`); il suo inizio
  e la sua fine sono già nel registro di governance (`impersonation.started` e
  `impersonation.ended`, `lib/api/tenants/controller/tenants.ts:1024` e `:1083`).

## 3. Compiti

- [x] **T-20.1** `change` diventa `change_log` nei due insiemi. Cambiano lo schema
  (`lib/database/schema/pg.ts`), il manager del tracciamento, le due migrazioni `0000` riscritte al
  loro posto insieme alle istantanee di drizzle-kit, `scripts/check-migration-sets.mjs`, le prove
  che nominano la tabella e i documenti che la descrivono (`docs/SCHEMA_V5.md`, `docs/TESTING_V5.md`,
  `docs/AUTHORIZATION_V5.md`, `docs/MIGRATION_V4_V5.md`, `docs/_BRAINSTORMING_STACK.md`, `llms.txt`).
  I documenti delle fasi chiuse restano come sono: raccontano quello che c'era.
  **Attenzione**: riscrivere `0000` cambia l'impronta della prima migrazione di entrambi gli
  insiemi, quindi il runner rifiuta ogni database locale che l'ha già applicata, e va ricreato.
  **Fatto quando**: `drizzle-kit generate` sui due insiemi non trova niente da generare;
  `check-all` è pulito; `npm test` con `DATABASE_URL` e `test:e2e:mt:pg` sono verdi; una scrittura
  tracciata finisce in `change_log` dentro il contenitore del tenant, su Postgres vero; il nome
  vecchio non compare più fuori dai documenti delle fasi chiuse.
  **Prove**, il 22 ottobre 2026: `npm run db:generate` e `db:generate:tenant` rispondono «No schema
  changes, nothing to migrate»; `check-all` pulito, con un solo avviso di lint già presente in
  `types/global.d.ts`; `npm test` con `DATABASE_URL` su Postgres 18, 1130 verdi e nessuna saltata;
  `test:e2e:mt:pg` 69 verdi. `test/db/managers.spec.ts` legge la riga per nome di tabella nello
  schema del tenant e non la trova in quello del piano di controllo. Il nome vecchio resta solo
  nei documenti delle fasi chiuse; corretto anche il commento di
  `volcanic-backend-sample/src/config/tracking.ts`. Su Postgres 16 le cinque prove dell'export e
  una del ciclo di vita cadono per l'ambiente: `pg_dump` 18 scrive `transaction_timeout`, che la
  16 non conosce.
