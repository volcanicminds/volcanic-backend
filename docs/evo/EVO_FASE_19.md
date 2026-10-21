# EVO fase 19: il contenitore di un tenant fuori da una richiesta

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> nasce dalle prove di `volcanic-rag-sample`: le stesse prove devono girare con un tenant solo e
> con i tenant, e nove dei loro file leggono e scrivono il registro del RAG nello stesso processo
> del server. Con i tenant quel registro sta nel contenitore del tenant, e fuori da una richiesta
> o da un job il backend non lo prestava.
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5`; l'uso nelle prove è lavoro di
> `volcanic-rag-sample`.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 1. Da dove si parte, verificato il 21 ottobre 2026

- Il contenitore di un tenant arriva in due modi: alla richiesta, dalla risoluzione
  (`openTenantContext`, `lib/loader/tenant.ts:268`), e al job, dallo scheduler, che lo prende in
  prestito e lo restituisce attorno alla chiamata (`inTenant`, `lib/loader/schedules.ts`).
  Nessuno dei due è esportato.
- Il prestito è contabilità e basta: sul Postgres un contenitore non tiene una connessione fra
  due istruzioni, e la lease dice al limite dei contenitori aperti di non chiudere quello in uso
  (`releaseRequestScope`, `lib/database/adapters/postgres/index.ts:508`).
- Chi oggi ne ha bisogno fuori da quei due casi apre una connessione sua: la suite dei tenant del
  rag-sample lo fa con un `pg.Client` sul locator (`test-tenants/tenants.spec.ts:59`).

## 2. Decisioni

- **F94** (proprietario, 21 ottobre 2026): il backend presta il contenitore di un tenant anche
  fuori da una richiesta o da un job, con una funzione pubblica, sullo stesso prestito dei job.
  Scartate una connessione aperta dal progetto, che resta fuori dal limite dei contenitori aperti
  e che export e distruzione non vedono, e la riscrittura via HTTP dei passi diretti delle prove.

## 3. Compiti

- [x] **T-19.1** `withTenant(server, slug, fn)`, esportata da `@volcanicminds/backend`: il
  contenitore del tenant attivo `slug` prestato a `fn` con il suo handle e la sua riga, `fn`
  dentro il tenant (log e span lo nominano), restituito quando `fn` finisce, bene o male. Rifiuta
  senza blocco `tenants`, senza data layer, per uno slug fuori dal registro o un tenant non
  `active`. Lo scheduler passa dalla stessa funzione (`lendTenant`, `activeTenant` in
  `lib/util/withTenant.ts`).
  **Fatto quando**: `test/lib/withTenant.spec.ts` prova prestito, restituzione anche quando `fn`
  lancia, la lease tenuta finché `fn` lavora e i quattro rifiuti, con quattro difetti piantati
  presi (restituzione prima che `fn` finisca, restituzione solo a buon fine, controllo dello stato
  tolto, controllo dei tenant tolto); `test/lib/schedules.spec.ts` resta verde; le 108 prove del
  rag-sample girano con i tenant nelle quattro combinazioni, leggendo il registro dal contenitore
  prestato.
  **Prove**: `test/lib/withTenant.spec.ts` e `schedules.spec.ts` 21 verdi, `npm run test:lib` 751
  verdi, `check-all` pulito; i quattro difetti piantati presi. Nel rag-sample (T-10.10 di
  volcanic-rag) `npm test` 108 verdi e `npm run test:tenants` 13 più 108 verdi in ciascuna delle
  quattro combinazioni; con il runner che scrive fuori dal tenant cadono 12 prove.
