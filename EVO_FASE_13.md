# EVO fase 13: step-up, la riautenticazione fresca

> **Questo file è il piano della fase, non lo stato.** Lo stato resta in `EVO_STATO.md`. La fase
> riapre il rinvio di `EVO_FASE_12.md` §3 («il collegamento avviato dall'utente, insieme a uno
> step-up») e la parte aperta di S13 in `docs/AUDIT_TASKS_TODO.md`. Riaperta dal manutentore il
> 27 settembre 2026, con due scelte: la strada **A** (freschezza sulla sessione e un flusso
> dedicato, non un codice TOTP nel corpo) e una finestra di **5 minuti**.
>
> Regola unica, la stessa delle fasi precedenti: una casella si chiude solo con un'evidenza
> citata. Perimetro: `volcanic-backend` su `v5`, poi `volcanic-admin` per la finestra di
> riautenticazione. F48 (il collegamento self-service) resta fuori: questa fase gli prepara lo
> step-up e basta.

| Simbolo | |
|---|---|
| `[ ]` | da fare |
| `[~]` | in corso |
| `[x]` | fatto, con evidenza |
| `[-]` | non applicabile, con motivo scritto |

---

## 0. Perché la fase esiste

Una sessione rubata vale quanto quella del proprietario per tutta la vita dell'access token, e
oltre se il ladro ha anche il refresh. Le operazioni che danno a quella sessione un potere che
sopravvive alla sessione stessa (aprire un'impersonation, iscrivere o togliere un secondo
fattore, domani collegare un account esterno) devono chiedere che la persona dimostri di esserci
**adesso**. Oggi nessuna lo fa: la sessione tiene già `auth_methods` (F45) proprio per questo, e
nessuno la legge.

## 1. Decisioni

| # | Decisione | Motivo |
|---|---|---|
| F50 | Strada A, finestra di 300 secondi (`STEP_UP_MAX_AGE`, fra 60 e 3600) | scelta del manutentore, 27 settembre 2026 |
| F51 | La freschezza sta sulla **sessione** (`session.authenticated_at`) e viaggia nell'access token come claim `auth_time`, in secondi. Il rinnovo la copia dalla riga e non la sposta: rinnovare non è riautenticarsi | il controllo per richiesta legge un claim firmato, senza una lettura in più; la riga serve perché il rinnovo emette token nuovi |
| F52 | Una rotta la chiede con `freshAuth: true`, al livello della rotta come `requireCapability`. Rifiuto **403 `STEP_UP_REQUIRED`** con `maxAge` nel corpo, dopo il controllo dei ruoli | 403 e non 401: un client che tratta il 401 come «sessione scaduta» manderebbe al login proprio chi deve solo riconfermare |
| F53 | Il flusso parte da `POST /auth/flow/step-up` (e `/system/auth/flow/step-up`), autenticata, con lo stesso corpo di `start`; prosegue sulle rotte di sempre (`step`, `challenge`, `cancel`, `return`). La riga del flusso porta `purpose`, `session_sid` e `expected_subject_id` | un solo motore, gli stessi metodi del login (password, TOTP, email-otp, OIDC) e le stesse regole di MFA; lo scopo sta nella riga, quindi le rotte pubbliche successive non devono sapere niente |
| F54 | Il soggetto identificato deve essere quello della sessione, altrimenti `AUTH_INVALID_CREDENTIALS` e flusso chiuso. La fine del flusso **non apre una sessione**: scrive `authenticated_at` e `auth_methods` sulla sessione di partenza e firma un access token nuovo con lo stesso `sid`. Il refresh non ruota | la riautenticazione conferma una sessione, non ne crea una seconda che il proprietario non ha chiesto |
| F55 | Mai freschi: un token di impersonation e un token di integrazione. `POST /auth/flow/step-up` rifiuta entrambi con **403 `STEP_UP_NOT_AVAILABLE`**, e così una sessione già chiusa alla fine del flusso. Lo stesso codice lo risponde la rotta `freshAuth` a quelle credenziali e a un token scaduto di freschezza senza `sid`, invece di `STEP_UP_REQUIRED`: lì nessuno step-up aiuta, solo un login nuovo | chi impersona non conosce le credenziali della persona, e un token di integrazione non ha nessuno dietro; dire `STEP_UP_REQUIRED` a chi non può farlo manderebbe il client in un giro senza uscita |
| F57 | Uno step-up è un flusso del suo soggetto come un login: aprirlo ritira gli altri flussi di quel soggetto (F37), un login in un'altra scheda compreso, e viceversa. Documentato, non evitato | un soggetto con due flussi vivi è proprio ciò che F37 esclude; aggirarlo per lo step-up vorrebbe dire due regole per lo stesso slot |
| F56 | Rotte marcate dal framework: `POST /tenants/:id/impersonate`, `/auth/mfa/setup`, `/auth/mfa/disable`, `/system/auth/mfa/setup`. Un consumer marca le sue | S13 e la gestione dei fattori; `enable` segue `setup` dentro la finestra |

## 2. Compiti

- [x] **T-13.1** Schema e migrazioni: `session.authenticated_at`; `auth_flow.purpose`,
  `session_sid`, `expected_subject_id`; `0004_step_up_*` nei quattro insiemi. Evidenza:
  `test/migrations/stepUpUpgrade.spec.ts` (contenitore fermo a 0003, flusso in volo che diventa
  `login`, sessione con `authenticated_at` nullo) verde su SQLite e su Postgres 16.
- [x] **T-13.2** Port e manager: `SessionManagement.markAuthenticated`, `authenticatedAt` sulla
  sessione, i tre campi sul flusso; Null Object e `docs/MANAGERS_V5.md`. Evidenza:
  `test/db/sessions.spec.ts` (sessione viva sì; altro soggetto, impersonation, scaduta per
  inattività o assoluta, revocata, inesistente no).
- [x] **T-13.3** Claim `auth_time` al login e al rinnovo; controllo `freshAuth` nell'hook; la
  variabile `STEP_UP_MAX_AGE`. Evidenza: `test/lib/stepUp.spec.ts` (limiti 60 e 3600),
  `test/lib/sessionRoutes.spec.ts` (il rinnovo copia `auth_time` dalla riga),
  `test/lib/router.spec.ts` (rifiuto all'avvio su rotta non autenticata). Difetto piantato (finestra
  moltiplicata per 100) preso da 2 test.
- [x] **T-13.4** Il motore: scopo `step-up`, soggetto atteso, fine che eleva invece di emettere;
  le due rotte di avvio; `step-up.succeeded` e `step-up.failed` nel registro degli accessi.
  Evidenza: `test/lib/authEngine.spec.ts` (5 casi), `test/lib/authFlowRoutes.spec.ts` (8 casi: bearer
  e cookie, secondo fattore, soggetto altrui, F55, piano di controllo).
- [x] **T-13.5** Le rotte marcate (F56), le prove (unitarie, data layer, banco multi-tenant) e i
  documenti (`AUTH_FLOW_V5.md` §8.5, `API_V5.md`, `AUTHORIZATION_V5.md` §10, `CONFIGURATION_V5.md`,
  `MANAGERS_V5.md`, `SCHEMA_V5.md`, `MIGRATION_V4_V5.md` §30, README, `llms.txt`). Evidenza:
  `test/e2e-mt-pg/stepUp.e2e.spec.ts` su Postgres 16 reale (riga del solo contenitore del
  chiamante, stesso `sid`, `/auth/mfa/setup` e impersonation rifiutate e poi ammesse, token di
  impersonation `STEP_UP_NOT_AVAILABLE`); togliere `freshAuth` dall'impersonation fa fallire il banco.
  `npm test` con `DATABASE_URL`: 936 verdi, 3 saltati; `npm run test:e2e:mt:pg`: 25 verdi;
  `npm run check-all` verde.
- [ ] **T-13.6** `volcanic-admin`: su `STEP_UP_REQUIRED` la finestra di riautenticazione, poi la
  richiesta ripetuta; provato nel browser.

## 3. Rinviato

**SAML.** Scelta `@node-saml/node-saml`, a condizione che non sia ferma da più di sei mesi. Al
27 settembre 2026 lo è: l'ultima versione su npm è la 5.1.0 del 21 luglio 2025, mentre il
repository riceve commit (l'ultimo il 25 settembre 2026) con correzioni di sicurezza non
pubblicate (`InResponseTo` di una risposta non firmata, byte verificati in
`validatePostRequestAsync`). Si riprende quando esce una versione nuova.
