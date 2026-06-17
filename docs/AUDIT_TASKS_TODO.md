# AUDIT TASKS — TODO

> Audit di sicurezza/qualità sui 4 progetti del workspace (`volcanic-backend`, `volcanic-tools`,
> `volcanic-database-typeorm`, `volcanic-backend-sample`). Data: 2026-06-17.
>
> **Tutti gli interventi sono non-funzionali**: non cambiano il comportamento osservabile delle API,
> ma migliorano sicurezza, robustezza, performance e manutenibilità.
>
> Legenda progetti: **BE** = volcanic-backend · **TO** = volcanic-tools · **DB** = volcanic-database-typeorm · **SA** = volcanic-backend-sample

---

## 🔴 CRITICA

- [x] **S1 — Dipendenza `fast-jwt` vulnerabile (algorithm/cache confusion)** · `BE`, `SA` ✅ *(2026-06-17)*
  - File: `package.json` (dep transitiva via `@fastify/jwt`)
  - `fast-jwt ≤6.2.3`: CVE-2023-48223 (fix incompleto, algorithm confusion via RSA key whitespace-prefixed) + cache confusion (claim di un token restituiti per un altro → identity/authorization mixup). `npm audit`: 1 critical + 6 high per repo.
  - Azione: aggiornare `@fastify/jwt`/`fast-jwt`; `npm audit fix`; pinnare versioni; ripetere audit.
  - **Fatto:** `@fastify/jwt` bumpato a `^10.1.0` in `volcanic-backend` (richiede `fast-jwt ^6.2.0`) → installato `fast-jwt@6.2.4`. Nel `volcanic-backend-sample` (transitivo) `npm update fast-jwt` → `6.2.4`. `npm audit`: **0 critical** in entrambi i repo. `type-check` OK; il fallimento dei test è pre-esistente e indipendente (manca il peer `@volcanicminds/typeorm` nel node_modules del repo, richiesto dal bootstrap di test).
  - **Scope corretto:** `fast-jwt` è presente solo in `BE` (diretto) e `SA` (transitivo). I critical/high di `TO` e `DB` riguardano **altri** pacchetti → rientrano in **Q12**, non in S1.

---

## 🟠 ALTA

- [x] **S2 — Secret JWT mancante/debole (fail-fast)** · `BE` ✅ *(2026-06-17)*
  - File: `index.ts:188`, `240-243`
  - **Correzione di analisi:** con `JWT_SECRET=''` il server NON parte con secret vuoto (`@fastify/jwt` fa `assert(secret, 'missing secret')` → eccezione, per giunta unhandled in `server.ts`). Il rischio reale non era "token forgiabili da secret vuoto" ma **secret debole accettato in silenzio** (corto/noto/bassa entropia) + errore di avvio illeggibile.
  - **Fatto (Opzione A — fail-fast):** nuova utility `lib/util/secret.ts` (`validateSecretStrength`/`assertSecretStrength`): mancante → sempre fatale `process.exit(1)`; debole (lunghezza < 32, denylist valori noti, < 8 caratteri distinti) → fatale in produzione, warning in dev. Cablata in `index.ts` prima di registrare JWT, per `JWT_SECRET`, `JWT_REFRESH_SECRET` (se refresh attivo) e `COOKIE_SECRET` (se `AUTH_MODE=COOKIE`). Aggiunto `.catch` in `server.ts` per evitare unhandled rejection.
  - **Verifica:** `type-check` OK; 4 scenari (mancante dev / debole prod / debole dev / forte) con exit code attesi (1/1/0/0); secret dev (88 char) passa senza warning.
  - **Nota:** scenario "solo rotte pubbliche senza secret" non implementato di proposito — le rotte auth native (login/refresh) firmano i token e richiedono comunque il secret; vedi discussione (Opzioni B/Ibrido scartate).

- [ ] **S3 — CORS default `origin: '*'` + `credentials: true`** · `BE`
  - File: `lib/config/plugins.ts:6-9`
  - Default troppo permissivo per B2B. Allowlist origini via env; vietare `*`+credentials; warning di startup.

- [x] **S4 — helmet disabilitato di default e assente con GraphQL** · `BE` ✅ *(2026-06-17)*
  - File: `lib/config/plugins.ts:46-49`, `index.ts:201` (`!loadApollo`)
  - Abilitare helmet di default; per Apollo usare helmet con CSP compatibile invece di escluderlo.
  - **Fatto:** deciso (con il maintainer) di **rimuovere del tutto il GraphQL** — era uno stub demo (`helloWorld`), disabilitato di default, zero test. Questo elimina alla radice la condizione `!loadApollo` su helmet. Inoltre helmet portato a `enable: true` di default in `lib/config/plugins.ts`.
  - **Rimozione GraphQL:** tolti import/funzioni Apollo e `GRAPHQL`/`loadApollo` da `index.ts`; eliminata cartella `lib/apollo/`; rimosse deps `@apollo/server`, `@as-integrations/fastify`, `graphql` da `package.json` (+ keyword `apollo`/`graphql`); ripulito `.env` (backend+sample), `README.md`, `llms.txt` (rimossa Part 9 + TOC + env, 275 righe).
  - **Verifica:** `type-check` + `build` + lint OK; boot reale OK (39 rotte, "Server up", helmet attivo). `npm audit` prod: da **13 → 9** vulnerabilità (rimosse 4 con apollo/graphql).
  - **Nota:** cambio di superficie pubblica (pacchetto pubblicato) → segnare come **minor/breaking** nel versioning. Residuo cosmetico: in `llms.txt` la numerazione salta "Part 8 → Part 10" (non rinumerato per non toccare i sotto-paragrafi `10.x`).

- [ ] **S5 — rate-limit disabilitato di default + nessun limite su auth/MFA** · `BE`
  - File: `lib/config/plugins.ts:41-44`, `lib/api/auth/routes.ts`
  - Brute-force su login e su codice MFA (6 cifre = 10⁶) senza throttling. Rate-limit attivo di default + limiti stretti per-route su login/forgot/reset/mfa.

- [x] **S6 — Timing attack / user enumeration in login** · `DB` ✅ *(2026-06-17)*
  - File: `lib/loader/userManager.ts:217-227`
  - Se l'email non esiste non si esegue `bcrypt.compare` → risposta più rapida. Eseguire un compare dummy a costo costante.
  - **Fatto:** `retrieveUserByPassword` ora esegue **sempre** `bcrypt.compare` (contro un hash dummy cost-12 quando l'utente non esiste) e ritorna `null` in entrambi i casi di fallimento. Equalizza il timing (test: 267.0 vs 266.7 ms) ed elimina anche l'incoerenza precedente throw→500 (utente assente) vs return-null→403 (password errata): ora entrambi i percorsi danno 403 "Wrong credentials" uniforme. Rimosso il `try/catch` ridondante. Bump `@volcanicminds/typeorm 2.3.4 → 2.3.5`.
  - **Verifica:** `type-check` + `build` OK su typeorm.

- [ ] **S7 — User enumeration via messaggi/stati** · `BE`
  - File: `lib/api/auth/controller/auth.ts:28,153,157,212`; `lib/hooks/onRequest.ts:147`
  - "Email already registered", "User blocked" vs "Wrong credentials", `404 SUBJECT_NOT_FOUND`. `forgotPassword` deve rispondere sempre 200 generico; uniformare i messaggi pubblici.

- [x] **Q1 — Regex `username` con flag `/gi` usata con `.test()` (bug validazione)** · `BE` ✅ *(2026-06-17)*
  - File: `lib/util/regexp.ts:5`
  - `lastIndex` persiste tra chiamate → risultati alternati true/false. Rimuovere il flag `g`.
  - **Fatto:** rimosso il flag `g` (resta `i`). Aggiunto test di regressione (`test/unit/regexp.ts`: `username.test('john')` chiamato 4× → sempre `true`).

---

## 🟡 MEDIA

- [ ] **S8 — `refreshToken` usa `jwt.decode` (no verifica firma) + check "Token too old" errato** · `BE`
  - File: `lib/api/auth/controller/auth.ts:336-341`
  - `decode` non verifica la firma; il check confronta `sub` (externalId) con un timestamp. Usare `verify` (`ignoreExpiration`) e una vera claim temporale.

- [ ] **S9 — Crypto: fallback legacy AES-256-CBC non autenticato + key derivation debole** · `DB`
  - File: `lib/util/crypto.ts:29-36, 8-13`
  - CBC malleabile (downgrade); key = primi 32 char di `base64(sha256(secret))` (no salt/HKDF). Migrare a solo GCM; HKDF/scrypt; deprecare/migrare record CBC.

- [x] **S10 — Possibile ReDoS nelle regex email** · `BE`
  - File: `lib/util/regexp.ts:7,14`
  - Quantificatori annidati (`\w+([.+-]?\w+)*`). Semplificare le regex; limitare lunghezza input prima del match.
  - **Fatto:** confermato il ReDoS esponenziale (len 34 = ~20s di blocco event-loop). Reso il separatore **obbligatorio** (`[.+-]`/`[.-]` invece di `[.+-]?`/`[.-]?`) → partizione unica → tempo lineare (50k char = 0.24ms), semantica di validazione invariata sul corpus di test. Aggiunti `MAX_EMAIL_LENGTH = 254` (RFC 5321) e helper `isEmail()` che fa il length-guard **prima** del match; i 3 call site in `auth.ts` (register/forgot/check) ora usano `isEmail`. `emailAlt` verificata sicura (separatori già obbligatori), aggiunta nota. Test di regressione in `test/unit/regexp.ts` (length-bound + linearità su input avversariale).

- [ ] **S11 — Nessuna protezione anti-replay TOTP + nessun rate-limit MFA** · `TO`, `BE`
  - File: `lib/mfa/index.ts:60-73` (TO), `lib/api/auth/controller/auth.ts:430-461` (BE)
  - Codice TOTP riusabile entro la finestra. Tracciare l'ultimo `delta` usato per utente; aggiungere rate-limit.

- [x] **S12 — `SET search_path` interpolato senza risanitizzazione** · `BE`
  - File: `lib/api/tenants/controller/tenants.ts:114`
  - A differenza di `tenantManager.switchContext`. Centralizzare e applicare ovunque la sanitizzazione/whitelist dello schema.
  - **Fatto:** aggiunto helper `sanitizeSchemaName()` in `tenants.ts` con lo **stesso** pattern canonico del `tenantManager.switchContext` di `@volcanicminds/typeorm` (`replace(/[^a-z0-9_]/gi, '')`); applicato in `resolveTargetUser` prima del `SET search_path`, con **fail-fast** (`throw 'Invalid target tenant schema'`) se lo schema collassa a vuoto. Aggiunto guard in profondità al confine d'input: `pattern: '^[a-zA-Z0-9_]+$'` su `dbSchema` in `tenantBodySchema`. Verificati gli altri `SET search_path` del BE: o costanti (`TO public`) o delegati al `tenantManager` già sicuro. Test in `test/unit/tenants.ts` (identità su nomi validi, strip di payload injection, input nullish).

- [ ] **S13 — Impersonation: audit non persistito, TTL 24h, no step-up MFA** · `BE`
  - File: `lib/api/tenants/controller/tenants.ts:141-193`; `index.ts:319-352` (MFA admin reset via env)
  - Persistere audit log; ridurre TTL; valutare step-up MFA; audit obbligatorio sul reset MFA via env.

- [ ] **S14 — Revocation latency: cache su `retrieveUserByExternalId`** · `DB`
  - File: `lib/loader/userManager.ts:208-211` (`cache: global.cacheTimeout`)
  - Utente bloccato/ruoli cambiati restano validi fino a scadenza cache. Invalidare cache su `block`/`resetExternalId`/cambio ruoli; documentare il trade-off.

- [ ] **Q2 — `changePassword`: null deref se utente inesistente** · `DB`
  - File: `lib/loader/userManager.ts:239-240`
  - `bcrypt.compare(old, user.password)` con `user` possibile `null`. Aggiungere guard.

- [ ] **Q3 — `isPasswordToBeChanged`: `throw new Error(e)` con `e` Error** · `DB`
  - File: `lib/loader/userManager.ts:327`
  - Messaggio `[object…]`. Usare `throw e` o messaggio esplicito.

- [ ] **Q4 — Parser `_logic` senza limite profondità/lunghezza (DoS)** · `DB`
  - File: `lib/query/parser.ts`
  - Limitare numero token e profondità di annidamento.

- [ ] **Q5 — `Semaphore.release()` può rendere `running` negativo** · `TO`
  - File: `lib/ai/concurrency.ts:39`
  - Clamp `running = Math.max(0, running - 1)`.

- [x] **Q6 — `login` valida la complessità password al login** · `BE` ✅ *(2026-06-18)*
  - File: `lib/api/auth/controller/auth.ts:232`
  - Inasprire la policy bloccherebbe utenti esistenti + leak della policy. Validare complessità solo in registrazione/cambio password.
  - **Fatto:** al login la complessità non è più verificata — solo presenza + tetto di lunghezza (`MAX_PASSWORD_LENGTH = 256`, guard anti-payload). bcrypt resta l'unico gate. Questo **disaccoppia** il login dalla policy e rende sicura [[T3]] (nessun lockout di utenti esistenti). La complessità resta imposta in register/change/reset/validate.

---

## 🟢 BASSA

- [ ] **S15 — Cookie `maxAge` (1g) ≠ `JWT_EXPIRES_IN` (15g) + access token troppo longevo** · `BE`
  - File: `lib/api/auth/controller/auth.ts:296` vs `index.ts:189`
  - Allineare scadenze; ridurre access token (es. 15m) appoggiandosi al refresh.

- [ ] **S16 — Manca `bodyLimit`/`limits` multipart espliciti (DoS payload)** · `BE`
  - File: `index.ts` (registrazione server/multipart)
  - Impostare `bodyLimit` e `limits.fileSize`.

- [ ] **S17 — `console.log('DEBUG: …')` in produzione** · `TO`
  - File: `lib/ai/model.ts:50,52`
  - Rimuovere o passare al logger a livello debug.

- [ ] **Q7 — `embedded_auth` letto a import-time** · `BE`
  - File: `lib/hooks/onRequest.ts:5`
  - Spostare la lettura dentro l'handler.

- [ ] **Q8 — Loop `do/while` con query DB per unicità UUIDv4** · `DB`
  - File: `lib/loader/userManager.ts:61-65,116-120`; `lib/loader/tokenManager.ts:51-54`
  - Collisione ~impossibile: generare l'UUID e affidarsi all'unique constraint.

- [ ] **Q9 — `try { } catch (e) { throw e }` inutile e ripetuto** · `DB`
  - File: `lib/loader/userManager.ts`, `lib/loader/tokenManager.ts` (vari, con `eslint-disable no-useless-catch`)
  - Rimuovere i wrapper inutili.

- [ ] **Q10 — `@ts-ignore`/`as any` su `req.user`/`req.tenant`** · `BE`
  - File: `lib/api/tenants/controller/tenants.ts`
  - Tipizzare le augmentation Fastify per eliminare i bypass.

- [ ] **Q11 — Nessuna CI** · `BE`, `TO`, `DB`, `SA`
  - File: `.github/` assente
  - Pipeline su PR: `lint` + `type-check` + `test` + `npm audit` + SAST.

- [ ] **Q12 — Vulnerabilità moderate residue (`yaml`, `uuid`, …)** · `BE`, `TO`, `DB`, `SA`
  - File: dipendenze
  - `npm audit fix` e ri-verifica.

---

## 🆕 Rilievi emersi durante la stesura dei test (2026-06-17)

- [x] **T1 — i18n rotto nel pacchetto pubblicato (BUG di produzione)** · `BE` ✅ *(2026-06-17)*
  - `tsc` non copiava `lib/locales/*.json` in `dist/`, ma il runtime carica i dizionari da `dist/lib/locales` (via `main: dist/index.js`). Risultato: pacchetto pubblicato con catalogo i18n vuoto → ogni `t.__(...)` cadeva sulla chiave/`generic error` (per questo il sample riceveva `undefined`).
  - **Fix:** `scripts/copy-assets.mjs` + `postbuild` che copia i locales in `dist/`. Coperto dai test translation reali (backend + sample).

- [x] **T2 — Test che mascheravano i fallimenti** · `BE`, `SA` ✅ *(2026-06-17)*
  - Assert dentro `try/catch` silenziati + `tearDown` con `process.exit(0)` (suite sempre exit 0). Rimossi; i test ora asseriscono davvero. Vedi anche fix loader/`--exit` già committati.

- [x] **T3 — Policy password non applica il carattere speciale (BUG)** · `BE` ✅ *(2026-06-18)*
  - File: `lib/util/regexp.ts` (regex `password`)
  - La classe `[...()-_=...]` conteneva il **range non voluto** `)-_` (0x29–0x5F) → lettere maiuscole e cifre soddisfacevano il requisito "1 carattere speciale". Es. `NoSpecial1A` passava pur senza speciali.
  - **Fatto:** `-` ora **escapato** (`\-`) in entrambe le occorrenze → il carattere speciale è realmente richiesto. Effetto collaterale: `/` e `\` (ammessi solo grazie al bug) non sono più caratteri validi per **nuove** password (nessun impatto sugli utenti esistenti, vedi Q6). Reso sicuro dalla risoluzione di [[Q6]]. Test reale in `test/unit/regexp.ts` + matrice di verifica (12 casi).

- [x] **T4 — Suite di test resa eseguibile + copertura iniziale** · `BE`, `TO`, `TO`, `SA` ✅ *(2026-06-17)*
  - Infra mocha+tsx funzionante su tutti i repo (prima: backend non compilava, sample crashava, tools/typeorm zero). Aggiunti test: backend (S2 secret, validatori/Q1, S4 plugins, translation), typeorm (crypto/S9, Magic Query con guard injection/proto, S6), tools (MFA TOTP, concurrency). Tot: **45 passing + 1 pending**. Prerequisito per [[Q11]] (CI).

---

## ⚡ Quick wins (alto impatto / basso sforzo)

1. **S1** — `npm audit fix` + upgrade `@fastify/jwt` (chiude la vuln critica JWT su tutti i repo).
2. **S2** — fail-fast su `JWT_SECRET` mancante/debole.
3. **S3/S4/S5** — invertire i default: helmet + rate-limit **on**, CORS allowlist.
4. **Q1** — rimuovere il flag `g` dalla regex `username` (bug di validazione concreto).
