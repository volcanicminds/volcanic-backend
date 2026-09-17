# Testing (v5)

> **Status: specification. Implement exactly this.**
> Target: `@volcanicminds/backend` v5. Tasks **T-0.1** and **T-0.2** of `EVO_FRAMEWORK.md`.
> It answers, without leaving anything to invent: which suites exist, how each one boots, with
> which environment, against which engine, and what "covered" means.

## 1. Suite map

| Suite | Directory | Engine | Command | Port |
|---|---|---|---|---|
| unit, core | `test/unit`, `test/lib`, `test/common` | none | `npm run test:lib` | — |
| core end-to-end | `test/e2e` | PGlite | `npm run test:e2e:pglite` | 2234 |
| multi-tenant, logic | `test/e2e-mt` | PGlite | `npm run test:e2e:mt:pglite` | 2235 |
| cookie mode, no-refresh, MFA, rate limit, fixtures | `test/e2e-*` | PGlite | one script each | 2236-2240 |
| data layer | `test/typeorm` → **rename to `test/db`** | PGlite | `npm run test:db` | — |
| **isolation, black box** | **`test/e2e-mt-pg` (new)** | **real Postgres** | **`npm run test:e2e:mt:pg`** | **2241** |
| performance | `test/perf` | PGlite | `npm run test:perf` | 2233 |

Every suite runs in **its own mocha process**: they own singletons (`global.config`,
`global.server`, the shared PGlite instance) and cannot share one.

`test:lib` runs with `AUTH_MODE=BEARER` set by the script, not by the specs: most of them present
a session in the `Authorization` header, which cookie mode (the default) refuses, and one of them
imports `index.ts`, whose `dotenv.config()` loads the developer's `.env` into the process. A mode
left to the environment would make the result depend on whose machine it ran on. The cookie mode
is covered by `test/lib/authChannels.spec.ts`, which sets it for itself and restores it after.

**PGlite keeps its place** for logic, speed and unit work. It is disqualified for one thing
only: isolation. `PGlitePool.connect()` always returns the same object, so there is no pool, and
without a pool the whole D-01 class of defects is unobservable. That is why the suite below
exists.

---

## 2. The black-box suite on real Postgres (T-0.2)

**It is written first, before any v5 code, and it must fail on the current code.** It speaks
HTTP only: it does not import the data layer, does not know the ORM, and therefore survives the
rewrite unchanged. If it has to be edited to go green, the new code has not solved the problem.

### 2.1 The database

Locally:

```bash
docker run -d --rm --name volcanic-test-pg \
  -e POSTGRES_PASSWORD=volcanic -e POSTGRES_USER=volcanic -e POSTGRES_DB=volcanic \
  -p 55432:5432 postgres:16-alpine
```

In CI, the same image as a `services:` block. **Do not add `testcontainers`**: the suite must run
against any `DATABASE_URL`, including a database an operator already has.

### 2.2 Environment

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | `postgres://volcanic:volcanic@127.0.0.1:55432/volcanic` | the only thing that changes between local and CI |
| `DB_POOL_MAX` | `1` | makes connection reuse **deterministic** instead of probabilistic. This is the value that runs in CI |
| `PORT` | `2241` | |
| `NODE_ENV` | `test` | not `memory`: that value selects the embedded engine |
| `LOG_LEVEL` | `silent` | |
| `JWT_SECRET`, `JWT_REFRESH_SECRET`, `MFA_DB_SECRET` | test values, at least 32 characters | the secret guard refuses to boot otherwise |
| `AUTH_RATELIMIT_MAX` | `100000` | the rate limit is tested by its own suite |
| `AUTH_MODE` | `BEARER` | the harness authenticates with a header; cookie mode, the default, would refuse a session there and require `COOKIE_SECRET` |

A second scenario runs with `DB_POOL_MAX=4` and concurrent requests. It is valuable and it is
**not** the CI gate: with more than one connection the failure is probabilistic, and a flaky gate
teaches people to ignore red.

### 2.3 What the harness must do

1. Drop and recreate the control plane schema, so every run starts from a known state.
2. Boot the **real application**, the same `start()` a consumer calls, with the control plane on
   Postgres and tenancy `schema` (the container variants get their own file later).
3. Create two tenants through the public API, `acme` and `globex`, each with its own
   administrator, each confirmed and able to log in. **No raw `UPDATE` to fix the seed**: v4 tests
   patched `confirmed` by hand (`test/e2e-mt/harness.ts:95-96`) and that hid defect D-08.
4. Write one row of recognisable data inside each tenant (`ACME PRIVATE ROW`, `GLOBEX PRIVATE ROW`).
5. Expose a helper that runs an arbitrary read **on a connection taken from the same pool the
   application uses**, which is how the leak becomes observable.
6. Tear down: close the server, close the pool, drop the schemas.

**Forbidden in this suite**: calling anything like `resetSearchPath()`. In v4 that helper exists
in the PGlite harness and it *is* the workaround for the defect; its presence would make the test
prove nothing.

### 2.4 The tests, written as properties

| # | Given | When | Then |
|---|---|---|---|
| 1 | an authenticated request to tenant `acme` completed | a read is issued on a connection from the pool | it sees the control plane, **not** `acme` |
| 2 | the same | `GET /tenants` is called | it lists the registry rows, not rows from a `tenant` table copied inside `acme` |
| 3 | a user that exists **only** inside `acme` | its token is presented to a `scope: 'control'` route | 401 or 403, never a successful read |
| 4 | an impersonation into `globex` completed | the next request runs | it is not pointed at `globex` |
| 5 | a token signed for `acme` | the tenant header names `globex` | the request is refused, not served on either |
| 6 | `DB_POOL_MAX=4` | N interleaved requests to `acme` and `globex` in parallel | no response contains the other tenant's data |
| 7 | a tenant just created through the API | its administrator logs in | it works, with no manual fix-up |

Tests 1, 2, 4 and 5 **must fail on the v4 code**. Test 3 fails too as soon as a shared user store
exists. If any of them passes before the fix, it is checking a configuration and must be rewritten.

---

## 3. What every other suite must gain in v5

| Area | Test that must exist |
|---|---|
| capability matrix (T-1.4) | one per unsupported combination: the process exits 1 with the expected message. Use the injectable `onFatal` pattern of `lib/util/secret.ts` so the test process survives |
| configuration merge (T-1.1) | declaring one key inside `tenants` does not erase its siblings |
| Magic Query (T-2.4) | the same battery on Postgres and SQLite: identical results where the capability exists, 400 with the right `code` where it does not |
| tenant context (T-3.1) | no emitted SQL contains `set search_path` outside a transaction |
| tracking (T-3.5) | the `change` row lands **inside the tenant container**; with the write made impossible, strict mode returns 500 and `strict: false` returns 200 |
| scheduled jobs (T-3.4) | a job declared "for every tenant" runs once per tenant with the right handle, and one failing tenant does not stop the others |
| migrations (T-5.3) | a fleet of at least 20 containers, one run interrupted mid-way, resumed, and ending idempotent; a partial failure exits non-zero naming the failed containers |
| destruction (T-6.3) | every failure code of `docs/API_V5.md` §6.2, plus: a failed export means nothing is destroyed |

---

## 4. Coverage

Measured with `c8` over `lib/**`, `index.ts` and the data-layer entry point, with the monocart
backend, and enforced by `scripts/check-coverage.mjs`:

```bash
npm run coverage         # measures and enforces the floors declared in .c8rc.json
npm run coverage:report  # measures only
```

**Why not plain `c8`, and why not its own `--check-coverage`.** Two defects, both found on
16 September 2026 (T-10.27), made the number say something other than what it measured.

1. Under `tsx` the same module can be compiled twice in one process, once as CommonJS and once
   as ESM, and the two scripts carry the same URL. istanbul does not sum two file coverages
   whose structure differs, it keeps the last one: `lib/manifest/generator.ts` measured **94.98%
   alone with its own spec and 42.58% in the full suite**, same code, same tests. Monocart merges
   the V8 ranges before remapping and reports 93.8% for that file in the full suite. It also
   counts **executable** lines, where plain `c8` counts every physical line of the file (479 for
   that one, which is its length, comments and type declarations included).
2. c8's `--check-coverage` under monocart compares covered lines against the *statement* count:
   a run whose report says 85.06% of lines is enforced as 1435/1755 = 81.77%. The floors are
   therefore checked by `scripts/check-coverage.mjs`, which reads the same
   `coverage/coverage-summary.json` the report prints.

**The floors** (`.c8rc.json`): statements 82, lines 82, branches 88, functions 80, against a
suite that reaches 85.15%, 85.06%, 91.49% and 83.23% without `DATABASE_URL`. They sit just under
what the suite reaches, so they fail a change that *removes* coverage and say nothing else.

**The rule for v5** (definition of done, point 5): every **new or rewritten** file of the data
layer and of the tenant path stays **above 85% of lines**. The reference numbers of the v4
survey (`tenants.ts` 28.4%, `schedules.ts` 38.4%, `userManager.ts` 43.2%, `query.ts` 45.5%,
`tracker.ts` 66.4%, `manifest.ts` and `isAdmin.ts` 0%) say where the holes were, but they were
measured on physical lines and do not compare with the numbers above.

---

## 5. CI

The pipeline gains one job and one rule.

1. **New job `test-pg`**: `services: postgres:16-alpine`, runs `npm run test:e2e:mt:pg` with
   `DB_POOL_MAX=1`.
2. **It is blocking**, on pull requests, on the protected branch and on the `v*` tag that
   publishes. If isolation is not proven, nothing is published.
   **It is expected to be red from the day it lands until phase 3 closes**: the bench is
   written before the code it judges, and it fails on the missing data layer. Do not silence
   it with `continue-on-error`, and do not "fix" it by editing the tests. Its red is the
   honest statement that the rewrite is not finished.
3. `tsconfig.json` no longer excludes `test`, so `npm run type-check` covers the suites too
   (defect D-25).
4. **New rule `check:session-state`** (`npm run check:session-state`, inside `check-all` and
   in the `verify` job): no `SET search_path` outside a transaction, anywhere in the sources.
   It is the cheap half of T-3.1 point 3, so the statement cannot be *written*; the other
   half sits on the driver (`lib/database/adapters/postgres/guard.ts`) and refuses it at the
   wire, so it cannot be *emitted* either: not by the framework, not by a consumer's raw
   SQL. Three files may name it: the check, the guard, and `test/db/session-state.spec.ts`,
   which proves both. Adding a fourth is admitting the rule does not hold there.

Everything else stays: lint, type-check, `depcruise`, build, `publint`,
`@arethetypeswrong/cli`, then the test matrix.
