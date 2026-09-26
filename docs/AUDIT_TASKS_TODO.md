# AUDIT TASKS — TODO

> Security/quality audit across the 4 workspace projects (`volcanic-backend`, `volcanic-tools`,
> `volcanic-database-typeorm`, `volcanic-backend-sample`). Date: 2026-06-17.
>
> **All interventions are non-functional**: they do not change the observable behavior of the APIs,
> but improve security, robustness, performance and maintainability.
>
> Project legend: **BE** = volcanic-backend · **TO** = volcanic-tools · **DB** = volcanic-database-typeorm · **SA** = volcanic-backend-sample

---

## 🔴 CRITICAL

- [x] **S1 — Vulnerable `fast-jwt` dependency (algorithm/cache confusion)** · `BE`, `SA` ✅ *(2026-06-17)*
  - File: `package.json` (transitive dep via `@fastify/jwt`)
  - `fast-jwt ≤6.2.3`: CVE-2023-48223 (incomplete fix, algorithm confusion via whitespace-prefixed RSA key) + cache confusion (claims of one token returned for another → identity/authorization mixup). `npm audit`: 1 critical + 6 high per repo.
  - Action: update `@fastify/jwt`/`fast-jwt`; `npm audit fix`; pin versions; re-run the audit.
  - **Done:** `@fastify/jwt` bumped to `^10.1.0` in `volcanic-backend` (requires `fast-jwt ^6.2.0`) → installed `fast-jwt@6.2.4`. In `volcanic-backend-sample` (transitive) `npm update fast-jwt` → `6.2.4`. `npm audit`: **0 critical** in both repos. `type-check` OK; the test failure is pre-existing and unrelated (the `@volcanicminds/typeorm` peer is missing from the repo node_modules, required by the test bootstrap).
  - **Scope correction:** `fast-jwt` is present only in `BE` (direct) and `SA` (transitive). The critical/high items in `TO` and `DB` concern **other** packages → they fall under **Q12**, not S1.

---

## 🟠 HIGH

- [x] **S2 — Missing/weak JWT secret (fail-fast)** · `BE` ✅ *(2026-06-17)*
  - File: `index.ts:188`, `240-243`
  - **Analysis correction:** with `JWT_SECRET=''` the server does NOT start with an empty secret (`@fastify/jwt` does `assert(secret, 'missing secret')` → exception, moreover unhandled in `server.ts`). The real risk was not "tokens forgeable from an empty secret" but **a weak secret silently accepted** (short/known/low entropy) + an unreadable startup error.
  - **Done (Option A — fail-fast):** new utility `lib/util/secret.ts` (`validateSecretStrength`/`assertSecretStrength`): missing → always fatal `process.exit(1)`; weak (length < 32, denylist of known values, < 8 distinct chars) → fatal in production, warning in dev. Wired into `index.ts` before registering JWT, for `JWT_SECRET`, `JWT_REFRESH_SECRET` (if refresh is enabled) and `COOKIE_SECRET` (if `AUTH_MODE=COOKIE`). Added a `.catch` in `server.ts` to avoid an unhandled rejection.
  - **Verification:** `type-check` OK; 4 scenarios (missing dev / weak prod / weak dev / strong) with the expected exit codes (1/1/0/0); dev secret (88 chars) passes without warning.
  - **Note:** the "public routes only, no secret" scenario was intentionally not implemented — the native auth routes (login/refresh) sign tokens and require the secret anyway; see discussion (Options B/Hybrid discarded).

- [x] **S3 — CORS default `origin: '*'` + `credentials: true`** · `BE`
  - File: `lib/config/plugins.ts:6-9`
  - Default too permissive for B2B. Allowlist origins via env; forbid `*`+credentials; startup warning.
  - **Done in v5 (D-16):** the allowlist comes from `CORS_ORIGINS` (`lib/config/plugins.ts:8`), and
    `credentials` is never granted against a wildcard (`lib/util/cors.ts`, `corsCredentialsFor`).

- [x] **S4 — helmet disabled by default and absent with GraphQL** · `BE` ✅ *(2026-06-17)*
  - File: `lib/config/plugins.ts:46-49`, `index.ts:201` (`!loadApollo`)
  - Enable helmet by default; for Apollo use helmet with a compatible CSP instead of excluding it.
  - **Done:** decided (with the maintainer) to **remove GraphQL entirely** — it was a demo stub (`helloWorld`), disabled by default, zero tests. This removes the `!loadApollo` condition on helmet at the root. helmet was also set to `enable: true` by default in `lib/config/plugins.ts`.
  - **GraphQL removal:** removed Apollo imports/functions and `GRAPHQL`/`loadApollo` from `index.ts`; deleted the `lib/apollo/` folder; removed the `@apollo/server`, `@as-integrations/fastify`, `graphql` deps from `package.json` (+ the `apollo`/`graphql` keywords); cleaned up `.env` (backend+sample), `README.md`, `llms.txt` (removed Part 9 + TOC + env, 275 lines).
  - **Verification:** `type-check` + `build` + lint OK; real boot OK (39 routes, "Server up", helmet active). `npm audit` prod: from **13 → 9** vulnerabilities (4 removed with apollo/graphql).
  - **Note:** public-surface change (published package) → mark as **minor/breaking** in versioning. Cosmetic leftover: in `llms.txt` the numbering jumps "Part 8 → Part 10" (not renumbered to avoid touching the `10.x` sub-paragraphs).

- [x] **S5 — rate-limit disabled by default + no limit on auth/MFA** · `BE`
  - File: `lib/config/plugins.ts:41-44`, `lib/api/auth/routes.ts`
  - Brute-force on login and on the MFA code (6 digits = 10⁶) without throttling. Rate-limit enabled by default + tight per-route limits on login/forgot/reset/mfa.
  - **Done in v5:** the login flow routes carry their own limits and the MFA step spends the
    attempts of its flow; every other tenant route that takes a secret (register, unregister,
    change and reset password, confirm-email) declares `AUTH_RATELIMIT_MAX` per minute per IP, and
    `/auth/refresh-token` a looser 60. Tested by `test/lib/authFlowRoutes.spec.ts`; observed over
    HTTP on Postgres: nine wrong codes on `/auth/confirm-email` answer 403, the eleventh request 429.
    The store is in memory, so the ceiling counts per instance.

- [x] **S6 — Timing attack / user enumeration in login** · `DB` ✅ *(2026-06-17)*
  - File: `lib/loader/userManager.ts:217-227`
  - If the email does not exist `bcrypt.compare` is not run → faster response. Run a constant-cost dummy compare.
  - **Done:** `retrieveUserByPassword` now **always** runs `bcrypt.compare` (against a cost-12 dummy hash when the user does not exist) and returns `null` in both failure cases. It equalizes the timing (test: 267.0 vs 266.7 ms) and also removes the previous inconsistency throw→500 (missing user) vs return-null→403 (wrong password): both paths now return a uniform 403 "Wrong credentials". Removed the redundant `try/catch`. Bump `@volcanicminds/typeorm 2.3.4 → 2.3.5`.
  - **Verification:** `type-check` + `build` OK on typeorm.

- [x] **S7 — User enumeration via messages/states** · `BE` ✅ *(2026-09-26)*
  - File: `lib/api/auth/controller/auth.ts:28,153,157,212`; `lib/hooks/onRequest.ts:147`
  - "Email already registered", "User blocked" vs "Wrong credentials", `404 SUBJECT_NOT_FOUND`. `forgotPassword` must always respond with a generic 200; make the public messages uniform.
  - **Done in v5:** a failed login answers `401 AUTH_INVALID_CREDENTIALS` whatever the cause
    (D-17); a registration on a taken address answers as a new one does; `forgot-password` always
    answers 200; unregister, change-password, confirm-email and reset-password answer a blocked
    account with the same `403 Wrong credentials` as a wrong secret (`test/lib/authMessages.spec.ts`).
    `SUBJECT_NOT_FOUND` stays: it needs a token the server signed, so it tells nothing to whoever
    does not already hold one.

- [x] **Q1 — `username` regex with `/gi` flag used with `.test()` (validation bug)** · `BE` ✅ *(2026-06-17)*
  - File: `lib/util/regexp.ts:5`
  - `lastIndex` persists across calls → alternating true/false results. Remove the `g` flag.
  - **Done:** removed the `g` flag (`i` remains). Added a regression test (`test/unit/regexp.ts`: `username.test('john')` called 4× → always `true`).

---

## 🟡 MEDIUM

- [x] **S8 — `refreshToken` uses `jwt.decode` (no signature verification) + wrong "Token too old" check** · `BE` ✅ *(2026-06-18)*
  - File: `lib/api/auth/controller/auth.ts:336-341`
  - `decode` does not verify the signature; the check compares `sub` (externalId) with a timestamp. Use `verify` (`ignoreExpiration`) and a real time claim.
  - **Done:** replaced `jwt.decode(token)` with `jwt.verify(token, { ignoreExpiration: true })` (in try/catch → `403 Invalid token` on invalid signature): the signature is now verified, but the expired access token is still accepted (that's the point of refresh). Rewrote the "Token too old" check on the real `iat` time claim (the token is signed with `expiresIn`, so it carries `iat`+`exp`): rejects if `iat` is missing or older than now−30d. The old `sub > minAcceptable` comparison (user id vs unix timestamp) was dead code.
  - **Verification:** `check-all` (lint + type-check) OK.

- [x] **S9 — Crypto: unauthenticated legacy AES-256-CBC fallback + weak key derivation** · `DB` ✅ *(2026-06-26)*
  - File: `lib/database/typeorm/util/crypto.ts` (data layer now lives under `volcanic-backend/lib/database/typeorm`)
  - Malleable CBC (downgrade); key = first 32 chars of `base64(sha256(secret))` (no salt/HKDF). Migrate to GCM only; HKDF/scrypt; deprecate/migrate CBC records.
  - **Done (full versioned fix, backward compatible):** new write format `v2:salt:iv:authTag:ciphertext` (hex). Each record carries a random 16-byte salt and a per-record key derived with **scrypt** (`N=2^15, r=8, p=1`, `maxmem` raised to 64MB) — replaces the weak truncated-base64 derivation. New writes are **always** authenticated GCM. `decrypt` stays 100% backward compatible in **read**: v2 (5 parts, scrypt key) + legacy GCM (3 parts, old key) + legacy CBC (2 parts, old key, read-only, never written again) → **no MFA-secret lockout**, records migrate to v2 on the next re-encrypt. Removed the redundant getKey duplication.
  - **Verification:** `check-all` (lint + type-check + depcruise) OK; typeorm tests **34 passing** including new cases: v2 roundtrip, random salt/IV, auth-tag tamper rejection, and **decrypt of legacy GCM + legacy CBC** records.
  - **Note:** scrypt adds ~160ms per encrypt/decrypt; acceptable since the MFA secret is decrypted only at MFA setup/verify (rare, login-time), not on hot paths.

- [x] **S10 — Possible ReDoS in the email regexes** · `BE`
  - File: `lib/util/regexp.ts:7,14`
  - Nested quantifiers (`\w+([.+-]?\w+)*`). Simplify the regexes; bound the input length before matching.
  - **Done:** confirmed the exponential ReDoS (len 34 = ~20s of event-loop blocking). Made the separator **mandatory** (`[.+-]`/`[.-]` instead of `[.+-]?`/`[.-]?`) → unique partition → linear time (50k chars = 0.24ms), validation semantics unchanged on the test corpus. Added `MAX_EMAIL_LENGTH = 254` (RFC 5321) and an `isEmail()` helper that does the length-guard **before** matching; the 3 call sites in `auth.ts` (register/forgot/check) now use `isEmail`. `emailAlt` verified safe (separators already mandatory), note added. Regression tests in `test/unit/regexp.ts` (length-bound + linearity on adversarial input).

- [x] **S11 — No TOTP anti-replay protection + no MFA rate-limit** · `TO`, `BE` ✅ *(2026-06-26)*
  - File: `lib/mfa/index.ts:60-73` (TO), `lib/api/auth/controller/auth.ts` (BE)
  - TOTP code reusable within the window. Track the last `delta` used per user; add rate-limit.
  - **Done — anti-replay:**
    - **TO (`volcanic-tools`):** added `verifyTokenDelta(token, secret, window)` returning the matched time-step `delta` (`number | null`); `verifyToken` now delegates to it (boolean contract unchanged → no break for tools consumers). Version `0.1.1 → 0.1.2`, `dist` rebuilt, MFA tests **10 passing** (+2 delta cases).
    - **BE (this repo):** `MfaManagement.verify` contract changed to return `number | null` (delta); legacy boolean still tolerated at runtime. New persistent field `mfaLastUsedCounter` on the abstract `User` entity (+ concrete column in the sample, `int`). In `auth.ts` a helper `evaluateMfaResult` converts the delta into the absolute consumed step (`floor(now/30)+delta`); `mfaVerify` and `mfaEnable` now **reject a code whose step was already used** (`counter <= mfaLastUsedCounter`) and persist the new counter. Note: `delta` can be `0` → checks use `!== null`, not truthiness.
  - **Done — MFA rate-limit:** `@fastify/rate-limit` registered with `global: false` (limits only opted-in routes, doesn't pre-empt S5's global throttling); `/mfa/enable` and `/mfa/verify` opt in with `max: 10 / 60s` to curb online brute-force of the 6-digit code.
  - **Verification:** backend `check-all` OK; tests **49 core + 34 typeorm** passing.
  - **Boundary with [[S5]]:** S5 still owns flipping global rate-limit on + tight limits on login/forgot/reset. Here only the MFA opt-in limits were added.

- [x] **S12 — `SET search_path` interpolated without re-sanitization** · `BE`
  - File: `lib/api/tenants/controller/tenants.ts:114`
  - Unlike `tenantManager.switchContext`. Centralize and apply schema sanitization/whitelist everywhere.
  - **Done:** added a `sanitizeSchemaName()` helper in `tenants.ts` with the **same** canonical pattern as `@volcanicminds/typeorm`'s `tenantManager.switchContext` (`replace(/[^a-z0-9_]/gi, '')`); applied in `resolveTargetUser` before the `SET search_path`, with **fail-fast** (`throw 'Invalid target tenant schema'`) if the schema collapses to empty. Added a defense-in-depth guard at the input boundary: `pattern: '^[a-zA-Z0-9_]+$'` on `dbSchema` in `tenantBodySchema`. Verified the other `SET search_path` in BE: either constant (`TO public`) or delegated to the already-safe `tenantManager`. Tests in `test/unit/tenants.ts` (identity on valid names, stripping of injection payloads, nullish input).

- [ ] **S13 — Impersonation: audit not persisted, 24h TTL, no step-up MFA** · `BE`
  - File: `lib/api/tenants/controller/tenants.ts:141-193`; `index.ts:319-352` (MFA admin reset via env)
  - Persist the audit log; reduce the TTL; consider step-up MFA; mandatory audit on the MFA reset via env.
  - **Partly done in v5:** the impersonation session is persisted and every request it makes is
    logged. The step-up MFA is deferred after 5.0, together with F48.

- [x] **S14 — Revocation latency: cache on `retrieveUserByExternalId`** · `DB`
  - File: `lib/loader/userManager.ts:208-211` (`cache: global.cacheTimeout`)
  - Blocked user/changed roles stay valid until the cache expires. Invalidate the cache on `block`/`resetExternalId`/role change; document the trade-off.
  - **Done in v5 (D-15):** the TypeORM manager is gone; `retrieveUserByExternalId` in
    `lib/database/managers/user.ts` reads the container with no query cache.

- [x] **Q2 — `changePassword`: null deref if the user does not exist** · `DB` ✅ *(2026-06-18)*
  - File: `lib/loader/userManager.ts:239-240`
  - `bcrypt.compare(old, user.password)` with `user` possibly `null`. Add a guard.
  - **Done:** `bcrypt.compare(oldPassword, user?.password || DUMMY_PASSWORD_HASH)` + the `if (user && match)` condition. Removes the `TypeError` (→ 500) on a non-existent user and keeps the bcrypt cost constant by reusing the [[S6]] pattern (same `DUMMY_PASSWORD_HASH`). The failure path is now uniform: `400 Password not changed`.
  - **Verification:** `build` (typeorm) OK.

- [x] **Q3 — `isPasswordToBeChanged`: `throw new Error(e)` with `e` being an Error** · `DB` ✅ *(2026-06-18)*
  - File: `lib/loader/userManager.ts:327`
  - `[object…]` message. Use `throw e` or an explicit message.
  - **Done:** `throw new Error(e)` → `throw e` (the only catchable error in the try is already an `Error`, previously it was double-wrapped/stringified).
  - **Verification:** `build` (typeorm) OK.

- [x] **Q4 — `_logic` parser without depth/length limit (DoS)** · `DB`
  - File: `lib/query/parser.ts`
  - Limit the number of tokens and the nesting depth.
  - **Done in v5 (D-13):** `DEFAULT_LOGIC_LIMITS` in `lib/database/query/logic.ts` (length 512,
    depth 8, aliases 32); exceeding them answers `QUERY_LOGIC_TOO_COMPLEX`.

- [x] **Q5 — `Semaphore.release()` can make `running` negative** · `TO` ✅ *(2026-06-18)*
  - File: `lib/ai/concurrency.ts:40`
  - Clamp `running = Math.max(0, running - 1)`.
  - **Done:** `this.running--` → `this.running = Math.max(0, this.running - 1)`. A `release()` not balanced by an `acquire()` (double release, release after error) no longer drives `running` below zero, preventing the semaphore from granting extra permits beyond `max`.
  - **Verification:** `check-all` (lint + type-check) OK on `volcanic-tools`.

- [x] **Q6 — `login` validates password complexity at login** · `BE` ✅ *(2026-06-18)*
  - File: `lib/api/auth/controller/auth.ts:232`
  - Tightening the policy would lock out existing users + leak the policy. Validate complexity only on registration/password change.
  - **Done:** at login the complexity is no longer checked — only presence + a length cap (`MAX_PASSWORD_LENGTH = 256`, anti-payload guard). bcrypt remains the only gate. This **decouples** login from the policy and makes [[T3]] safe (no lockout of existing users). Complexity is still enforced in register/change/reset/validate.

---

## 🟢 LOW

- [x] **S15 — Cookie `maxAge` (1d) ≠ `JWT_EXPIRES_IN` (15d) + access token too long-lived** · `BE`
  - File: `lib/api/auth/controller/auth.ts:296` vs `index.ts:189`
  - Align the expirations; reduce the access token (e.g. 15m) relying on the refresh.
  - **Done in phase 10 (T-10.38, T-10.39):** the cookie's `Max-Age` is read from the token's `exp`
    (`lib/util/credential.ts`), renewal works in cookie mode, and `JWT_EXPIRES_IN` defaults to `1h`.
    Tested by `test/lib/authChannels.spec.ts`.

- [x] **S16 — Missing explicit `bodyLimit`/`limits` for multipart (payload DoS)** · `BE` ✅ *(2026-09-26)*
  - File: `index.ts` (server/multipart registration)
  - Set `bodyLimit` and `limits.fileSize`.
  - **Done in v5:** `bodyLimit` comes from `BODY_LIMIT` (default 1 MiB, `index.ts`); multipart gets
    `fileSize` equal to it and caps on files, fields and parts, under whatever the consumer's
    `plugins.multipart` entry writes. Observed over HTTP: a 4 KB JSON body with `BODY_LIMIT=2048`
    answers 413.

- [x] **S17 — `console.log('DEBUG: …')` in production** · `TO` ✅ *(2026-06-18)*
  - File: `lib/ai/model.ts:50,52`
  - Remove or move to the logger at debug level.
  - **Done (already resolved):** the `console.log('DEBUG: …')` had already been removed in commit `d100188` ("✅ [Tests] AI createModel + MFA unit coverage; drop debug logs") of `volcanic-tools`. Verified: no residual `console.log`/`DEBUG:` in `lib/ai/`. No change needed, task closed.

- [x] **Q7 — `embedded_auth` read at import-time** · `BE` ✅ *(2026-06-18)*
  - File: `lib/hooks/onRequest.ts:5`
  - Move the read inside the handler.
  - **Done:** removed the module-level destructuring `const { embedded_auth = true } = global.config?.options || {}` (executed at import, when `global.config` might not be populated yet → frozen/`undefined` value at first load) and moved it inside the `onRequest` handler, so the flag is re-read on every request from the now-initialized `global.config`.
  - **Verification:** `check-all` (lint + type-check) OK on `volcanic-backend`.

- [x] **Q8 — `do/while` loop with a DB query for UUIDv4 uniqueness** · `DB`
  - File: `lib/loader/userManager.ts:61-65,116-120`; `lib/loader/tokenManager.ts:51-54`
  - Collision ~impossible: generate the UUID and rely on the unique constraint.
  - **Done in v5 (D-28):** ids are UUID v7 generated in process (`lib/database/uuid.ts`), with no
    database round trip.

- [x] **Q9 — Useless and repeated `try { } catch (e) { throw e }`** · `DB`
  - File: `lib/loader/userManager.ts`, `lib/loader/tokenManager.ts` (various, with `eslint-disable no-useless-catch`)
  - Remove the useless wrappers.
  - **Not applicable in v5:** both files were removed with the TypeORM data layer, and no
    `no-useless-catch` suppression is left in `lib/`.

- [x] **Q10 — `@ts-ignore`/`as any` on `req.user`/`req.tenant`** · `BE`
  - File: `lib/api/tenants/controller/tenants.ts`
  - Type the Fastify augmentations to eliminate the bypasses.
  - **Done in v5:** no `@ts-ignore` and no `as any` on `req.user`, `req.tenant` or `req.method`
    left in `lib/`; the last ones, in `lib/util/cache.ts`, went with the cache hit marker becoming
    a `WeakSet`.
  - **Closed (2026-09-26):** `req.server['systemUserManager']` was already typed, since the
    `FastifyInstance` augmentation in `types/global.d.ts` declares every manager and an index with a
    literal key resolves to it (a misspelt method fails `tsc`). The last `as any` on Fastify objects
    went: the managers in `lib/loader/genesis.ts`, which surfaced a control handle typed as a
    generic `DataHandle`; `migrations` in `lib/loader/schemaVersion.ts` and `lib/loader/tenant.ts`,
    through one `SchemaVersionPort`; cookies and `jwt.decode` in `lib/util/credential.ts`, typed by
    their plugins.

- [x] **Q11 — No CI** · `BE`, `TO`, `DB`, `SA`
  - File: `.github/` absent
  - Pipeline on PR: `lint` + `type-check` + `test` + `npm audit` + SAST.
  - **Done in v5 (backend):** `.github/workflows/ci.yml` runs lint, type-check, depcruise, the
    session and migration checks, build, publint, attw, the suites with coverage and a Postgres
    job; `npm audit --omit=dev --audit-level=high` stops the `verify` job. No SAST step.
  - **Done (2026-09-26), `v5` of each repository:** `volcanic-tools@700576a` (lint, type-check,
    production audit, tests, build, publint), `volcanic-admin@acb6303` (lint, production audit,
    library and demo builds, publint), `volcanic-rag@83f4a4f` and `7970d32` (type-check, subpath
    boundary, production audit, unit tests with a Qdrant 1.19.1 service; the backend `v5` is
    checked out and built next to it, as `file:../volcanic-backend` needs). SAST is CodeQL
    (`security-extended`) on push, pull request and weekly in backend, tools and admin; 0 open
    alerts on the first run. The backend CI also gained `check:refusals` (`7d6fc0b`), which
    `check-all` ran and CI did not. All runs green on GitHub.
    Admin CI validates the example manifest against the schema (`volcanic-admin@1951e7a`).
  - **Left out, each with its reason:** `volcanic-rag` has no SAST, since the repository is private and CodeQL there
    needs GitHub Advanced Security; the `volcanic-rag-sample` suites are not in rag CI (they need a
    token for the private repository, deferred to rag T-10.8); `volcanic-backend-sample` (SA) has
    no CI; DB is the TypeORM package, deprecated in v5.

- [x] **Q12 — Residual moderate vulnerabilities (`yaml`, `uuid`, …)** · `BE`, `TO`, `DB`, `SA`
  - File: dependencies
  - `npm audit fix` and re-verify.
  - **Done in v5 (backend):** `npm audit --omit=dev` reports 0 vulnerabilities (2026-09-25); the 7
    moderate left are in dev dependencies only. CI now fails on a high one in production (Q11).
  - **Found (2026-09-26), `npm audit --omit=dev`:** `volcanic-tools` 44 (1 critical,
    `fast-xml-parser`; 10 high; all fixable by `npm audit fix` except `nodemailer`, which needs
    major 10); `volcanic-admin` 28 (2 high, `fast-uri` and `linkify-it`); `volcanic-rag` 0.
  - **Done (2026-09-26):** `volcanic-admin` 0 (`3074fa1` for the high ones, `255e9c3` moves the
    rich text editor to Tiptap 3 for the 26 moderate ones). `volcanic-tools` down to 4 moderate
    (`0dbdf38`, nodemailer 10), all in the `minio` chain (`decode-uri-component`, `stream-json`):
    the only fix offered is `minio` 7.1.3 from `^8.0.6`, a major downgrade, so it does not apply.
    The tools commits are on `origin/v5`.

---

## 🆕 Findings that emerged while writing the tests (2026-06-17)

- [x] **T1 — i18n broken in the published package (production BUG)** · `BE` ✅ *(2026-06-17)*
  - `tsc` did not copy `lib/locales/*.json` into `dist/`, but the runtime loads the dictionaries from `dist/lib/locales` (via `main: dist/index.js`). Result: published package with an empty i18n catalog → every `t.__(...)` fell back to the key/`generic error` (this is why the sample received `undefined`).
  - **Fix:** `scripts/copy-assets.mjs` + a `postbuild` that copies the locales into `dist/`. Covered by the real translation tests (backend + sample).

- [x] **T2 — Tests that masked failures** · `BE`, `SA` ✅ *(2026-06-17)*
  - Asserts inside silenced `try/catch` + `tearDown` with `process.exit(0)` (suite always exit 0). Removed; the tests now really assert. See also the loader/`--exit` fixes already committed.

- [x] **T3 — Password policy does not enforce the special character (BUG)** · `BE` ✅ *(2026-06-18)*
  - File: `lib/util/regexp.ts` (`password` regex)
  - The `[...()-_=...]` class contained the **unintended range** `)-_` (0x29–0x5F) → uppercase letters and digits satisfied the "1 special character" requirement. E.g. `NoSpecial1A` passed despite having no specials.
  - **Done:** `-` is now **escaped** (`\-`) in both occurrences → the special character is actually required. Side effect: `/` and `\` (allowed only thanks to the bug) are no longer valid characters for **new** passwords (no impact on existing users, see Q6). Made safe by the resolution of [[Q6]]. Real test in `test/unit/regexp.ts` + verification matrix (12 cases).

- [x] **T4 — Test suite made runnable + initial coverage** · `BE`, `TO`, `TO`, `SA` ✅ *(2026-06-17)*
  - Working mocha+tsx infra across all repos (before: backend did not compile, sample crashed, tools/typeorm zero). Added tests: backend (S2 secret, validators/Q1, S4 plugins, translation), typeorm (crypto/S9, Magic Query with injection/proto guard, S6), tools (MFA TOTP, concurrency). Total: **45 passing + 1 pending**. Prerequisite for [[Q11]] (CI).

---

## ⚡ Quick wins (high impact / low effort)

1. **S1** — `npm audit fix` + upgrade `@fastify/jwt` (closes the critical JWT vuln across all repos).
2. **S2** — fail-fast on a missing/weak `JWT_SECRET`.
3. **S3/S4/S5** — flip the defaults: helmet + rate-limit **on**, CORS allowlist.
4. **Q1** — remove the `g` flag from the `username` regex (concrete validation bug).
