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

## 2. Decisioni da prendere

Sono del proprietario; al 20 ottobre 2026 nessuna è presa. Prendono un numero da F94 in poi
quando vengono prese.

1. **Chi c'è dietro il token**: una riga della tabella `token`, che lo schema del piano di
   controllo porta già (`lib/database/schema/entry/control.pg.ts:19`, oggi per il caso senza
   tenant), oppure un utente di sistema di tipo macchina, senza password né login.
2. **Che cosa apre**: il backend non sa niente di rag, quindi la capability non può nominare un
   corpus. O il catalogo di sistema diventa estendibile dal progetto, come lo è quello del tenant,
   e il progetto dichiara la capability che le rotte di rag chiedono; oppure il framework aggiunge
   una capability generica per le macchine, e le rotte del pacchetto la chiedono.
3. **Il canale**: in modalità cookie un'eccezione a `CREDENTIAL_CHANNEL` limitata ai token di
   integrazione di controllo, sul modello di quella che il piano del tenant fa già
   (`integrationOnly`); una sessione nell'header resta rifiutata.
4. **Chi lo emette e cosa resta scritto**: emissione, rinnovo e revoca sotto `system:admin`, con
   o senza step-up, e una riga di `governance_log` per ciascuna.

## 3. Compiti

- [ ] **T-18.1** Un token di integrazione sul piano di controllo. Firmato con `sub` e
  `scp: 'control'`, senza `tid`; emesso, rinnovato e revocato da rotte `scope: 'control'`;
  riconosciuto dall'hook sulle rotte di controllo accanto all'utente di sistema; con i ruoli del
  catalogo di sistema. Dipende dalle decisioni della sezione 2.
  **Fatto quando**: una macchina con un token di controllo chiama una rotta `scope: 'control'` che
  la sua capability apre e riceve 200, e una che non apre riceve 403; lo stesso token dentro un
  tenant è 403 `SCOPE_MISMATCH`; un token del tenant sulla stessa rotta di controllo è 403; un
  token revocato è rifiutato dalla richiesta successiva; in modalità cookie il token passa
  dall'header e una sessione no. Prove via HTTP su Postgres reale, con entrambe le strategie.
  Difetti da piantare: un token senza `scp` accettato sul piano di controllo; la revoca letta da
  una cache; l'eccezione del canale estesa alle sessioni.
