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

Measured with `c8`, over `lib/**`, `index.ts` and the data-layer entry point:

```bash
npx c8@10 --reporter=text-summary \
  --include='lib/**' --include='index.ts' --include='db.ts' --all \
  npm test
```

**The rule for v5** (definition of done, point 5): every **new or rewritten** file of the data
layer and of the tenant path stays **above 85% of lines**. Files not touched keep the
no-regression rule against the reference of the survey: lines 79.7%, branches 72.1%.

Reference numbers from the survey, to know where the holes were: `tenants.ts` 28.4%,
`schedules.ts` 38.4%, `userManager.ts` 43.2%, `query.ts` 45.5%, `tracker.ts` 66.4%,
`manifest.ts` and `isAdmin.ts` 0%.

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

Everything else stays: lint, type-check, `depcruise`, build, `publint`,
`@arethetypeswrong/cli`, then the test matrix.
