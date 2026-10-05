# Tuning: measuring instead of guessing

```sh
npm run tune                      # measure, write tuning.json, print what it would change
npm run tune -- --write-config    # also apply it, after a backup and a diff
npm run tune -- --target-ms 250   # the password-hashing budget to aim at
npm run tune -- --force           # measure anyway on a machine that is not fit for it
```

## Why this exists

Appendix A of `EVO_FRAMEWORK.md` carries the numbers that size the password work factor, the
pools, the LRU bound on containers and the page ceiling. The line under them says not to use
them, because they came from a shared laptop.

A number the document itself calls unreliable is not a measurement, it is a placeholder — and
every default derived from it is a guess wearing a figure. So: measure on the machine that will
run it, and write the answers down **with their provenance**.

## Provenance is the point

`tuning.json` records, next to every number: the host, the CPU, the core count, the memory, the
Node version, the load average at the time, the date, how many runs it took and the spread
across them.

That list is what appendix A was missing. A number without provenance is indistinguishable from
a number somebody invented, which is exactly how appendix A ended up where it is.

`tuning.json` is **not committed** by default, and that is deliberate: a laptop's measurements
committed to the repository is precisely the mistake being corrected here. Commit one when it
came from a machine that resembles production, and let its provenance say which machine that
was.

## What it measures, and what each answer decides

| Measured | Decides |
|---|---|
| bcrypt at each work factor from 12 up | `BCRYPT_COST` — the right cost is the one that spends the chosen budget on the machine that will run it, not a 12 copied from somewhere |
| one scrypt derivation at `N = 32768` | whether MFA key derivation is affordable on the login path. In v4 the same call was **synchronous** and 82 ms of it sat on the event loop at every MFA login |
| `max_connections` and `superuser_reserved_connections`, against the configured pools | `DB_POOL_MAX` and `TENANT_CONTAINERS_MAX_OPEN`. A framework that plans to use every connection plans to be the reason nobody can log in to fix it |
| a page of rows as `_pageSize` grows | `VOLCANIC_MAX_PAGE_SIZE` — the cost a single caller can ask the server to pay |
| one cached response, and the store that holds it | `options.cache.maxEntries`, which bounds a count while memory is spent in bytes |
| the limiter's overhead, its per-address table, and the work behind each limit | `AUTH_RATELIMIT_MAX` / `AUTH_RATELIMIT_WINDOW`, and the 404 limit in `index.ts` |

**Median, not mean, with the spread beside it.** A mean is moved by one slow run, and one slow
run is what a laptop produces. A median of 200 ms at 5% spread and a median of 200 ms at 90%
spread are not the same measurement, and only one of them is worth deriving a default from.

Where a median lands under a millisecond — the page-size rows usually do — the spread is
scheduling noise and says nothing. Read the medians there and ignore the percentage.

## Results on this machine, 18 September 2026

Run with `npm run tune -- --force`, because the machine was above the load gate the bench itself
enforces. That is the first thing these numbers declare about themselves.

| Provenance | |
|---|---|
| Host | `kerkyra-2.local`, a development laptop |
| CPU | Apple M1 Pro, 10 cores, 16 GB |
| Node | v24.11.0, darwin arm64 |
| Load average at the run | 3.52 over 10 cores, above the 0.4 per core gate |
| Repetitions | 5 runs for bcrypt and scrypt, 7 for the cache and limiter batches, 9 for the pages |

**What makes them uncertain, stated rather than implied.** This is a shared development machine
with an editor, a browser and a language server running on it, not a dedicated host, and the run
was forced past the bench's own refusal. The medians below are an upper bound for a quiet machine
and a lower bound for a contended one. They are good enough to size a default, which is a
question of orders of magnitude, and not good enough to publish as a benchmark. A production host
should re-run the bench and, where it disagrees, write its own numbers here with its own
provenance. `connections` was skipped in this run: without `DATABASE_URL` the connection budget
has no real server to be measured against.

### The cache

| Measured | Median |
|---|---|
| heap per entry, 25-row page (the default `_pageSize`) | 4,485 B for a 4,164 B payload |
| heap per entry, 100-row page (the `VOLCANIC_MAX_PAGE_SIZE` clamp) | 17,101 B for a 16,799 B payload |
| read hit, which is a delete plus a reinsert to mark it most recently used | 0.29 µs at 1,000 entries, 0.53 µs at 50,000 |
| write with an eviction | 0.36 µs at 1,000 entries, 0.34 µs at 50,000 |
| full scan of the store, the walk the 60s sweep performs | 0.08 ms at 1,000 entries, 0.70 ms at 50,000 |

**`maxEntries` stays at 1000, and the reason is now written down.** The store costs between
4.3 MB and 16.3 MB at that cap depending on the page shape, and the operations are flat from
1,000 to 50,000 entries, so the cap is a memory decision and nothing else. A 32 MB budget buys
7,500 entries at a 25-row page, and those same 7,500 entries at a 100-row page would cost about
122 MB: the cap bounds a count, and memory is spent in bytes. 1000 is the value that stays inside
the budget at both shapes measured, so it stays.

**The TTL is unchanged, and this bench is not what decides it.** 3600s without a `tenants` block
and 60s with one is a staleness policy (D-26), not a performance one: the number bounds how long
a replica may keep serving a value whose invalidation never reached it. A bench can measure the
mechanism, the expiry and the sweep, and it did. It cannot measure how stale a deployment is
willing to be.

### The rate limit

| Measured | Median |
|---|---|
| one bcrypt verification at cost 12, the work behind a refused login | 281.47 ms |
| the limiter's own overhead per request | 0.00 ms, below the resolution of a 200-request batch |
| heap per tracked address | 283 B, so the plugin's default table of 5,000 addresses is 1.35 MB |
| where the refusal lands at `max: 10` | on the 11th request, with other addresses unaffected |

**`AUTH_RATELIMIT_MAX=10` per 60s stays.** One address buys 14,400 password attempts a day and
spends 2,815 ms of CPU a minute, which is 4.7% of one core: 22 addresses saturate a core, 214
saturate this machine. The line this bench draws is a quarter of a core per address, and 10 per
minute sits well under it. Lowering it further would cost a real user a retry before it cost an
attacker anything, because the limit is per address and a botnet's budget is addresses.

**The 404 limit, 30 per 30s, stays.** The work behind it is a `reply.code(404).send()` at 0.02 ms
rather than a hash, so one address costs 1.2 ms of CPU a minute and it would take 50,000 of them
to saturate one core. That limit exists to blunt path scanning, and it is not a CPU defence.

An earlier version of this bench priced the 404 limit with a bcrypt verification and reported a
quarter of a core per address, which made a sane limit look reckless. The model was wrong, not
the limit. The cost of the work behind a limit is a parameter now, because the two limits guard
different work, and that correction is the reason the numbers above are worth reading.

## It refuses to measure a machine it cannot measure

No number is better than a plausible wrong one, because the plausible wrong one gets used. The
run stops when the load average is above 40% of the core count, or when another `tune` holds
the lock. `--force` measures anyway and says so in the output.

## Writing the configuration

Without `--write-config` nothing outside `tuning.json` is touched: the run prints what it
*would* change, next to what is set today.

With it, the values are written into `.env` and the previous file is kept beside it as
`.env.before-tune-<timestamp>`. An operator undoing this at three in the morning should not have
to reconstruct anything.

The separation is not caution for its own sake. A measurement taken on a busy machine is
plausible and wrong, and the difference is only visible by reading it — so the tool asks you to
read it.

## The floor on the work factor

`BCRYPT_COST` is configurable from v5, and it **cannot go below 12**, whatever is written:
`envInt('BCRYPT_COST', 12, { min: 12, max: 20 })` clamps it and says so in the log.

A tunable work factor is also a way to weaken every password in the database with one
environment variable, and nothing downstream would report it. The bench measures to spend the
budget well, not to find permission to spend less. The ceiling is there for the mirror image: a
typo that makes every login a thirty-second wait is a denial of service typed by an operator.

## The hot paths: prepared statements

```sh
npm run bench:paths                                    # PGlite; Postgres too with BENCH_DATABASE_URL
npm run bench:paths -- --out before.json               # where the report goes (bench-paths.json)
npm run bench:paths -- --baseline before.json          # every median against an earlier report
```

Every authenticated request reads the same few rows before its handler runs. `scripts/bench-paths.ts`
times those reads through the managers, called the way `lib/loader/tenant.ts` and
`lib/hooks/onRequest.ts` call them:

| Path | Read by |
|---|---|
| `tenant.byId` | tenant resolution from the token: `getTenant`, then the provider opening the container |
| `tenant.bySlug` | tenant resolution from the header or the subdomain, without a token |
| `user.byExternalId` | every authenticated request on a tenant |
| `token.byExternalId` | every request carrying an integration token |
| `systemUser.byExternalId` | every authenticated request on the control plane |
| `login.password` | the credential check: bcrypt is 99.9% of it, so it is the **control**, and it must not move |

The world it builds: 3 tenants with 2000 users and 200 integration tokens each, 200 rows in the
registry, 200 system users. PGlite runs in the process at concurrency 1; Postgres runs at 1
(latency) and at 10 on a pool of 10 (throughput). Each path gets 15 rounds of 1000 operations
(10 for the login), interleaved, with the first path rotating, so a slow minute lands on every
path instead of on one. It uses the same gate as `tune` (`scripts/machine.ts`).

Postgres comes from `BENCH_DATABASE_URL` and **never** from `DATABASE_URL`: the bench creates
`bench_*` schemas and drops them at the end, and refuses to start when one already exists.

### What it decided, 2 October 2026

`kerkyra-2.local` (Apple M1 Pro, 10 cores, 16 GB), Node 26.10.0, Drizzle 0.45.2, `pg` 8.22.0,
PGlite 0.5.3, a local Postgres 14.22. Microseconds per operation, median of 15 rounds, IQR
(p25 to p75 over the median) in brackets. Two runs before the change, to know the noise.

| Path | Engine | Before, run 1 | Before, run 2 | After | After / before |
|---|---|---|---|---|---|
| `tenant.byId` | PGlite | 494.4 (5.6%) | 461.2 (4.4%) | 374.6 (3.4%) | 0.76 |
| | Postgres, 1 | 251.9 (7.5%) | 264.1 (5.3%) | 160.5 (8.1%) | 0.64 |
| | Postgres, 10 | 136.8 (5.4%) | 147.0 (10.7%) | 52.1 (4.2%) | 0.38 |
| `tenant.bySlug` | PGlite | 243.6 (7.4%) | 234.5 (6.6%) | 191.3 (10.5%) | 0.79 |
| | Postgres, 1 | 123.4 (6.8%) | 130.5 (7.5%) | 73.7 (16.2%) | 0.60 |
| | Postgres, 10 | 71.0 (6.8%) | 72.1 (7.5%) | 25.1 (3.9%) | 0.35 |
| `user.byExternalId` | PGlite | 339.3 (4.5%) | 330.2 (4.1%) | 258.3 (5.9%) | 0.76 |
| | Postgres, 1 | 177.7 (6.5%) | 186.3 (12.5%) | 105.0 (5.7%) | 0.59 |
| | Postgres, 10 | 107.0 (8.3%) | 107.9 (7.7%) | 32.5 (10.6%) | 0.30 |
| `token.byExternalId` | PGlite | 245.1 (5.3%) | 235.3 (4.9%) | 189.7 (2.7%) | 0.77 |
| | Postgres, 1 | 122.8 (6.3%) | 131.7 (23.7%) | 79.6 (3.4%) | 0.65 |
| | Postgres, 10 | 69.5 (3.1%) | 69.4 (7.0%) | 24.8 (4.3%) | 0.36 |
| `systemUser.byExternalId` | PGlite | 265.6 (3.5%) | 255.8 (4.7%) | 205.8 (4.6%) | 0.78 |
| | Postgres, 1 | 139.2 (6.7%) | 143.7 (9.2%) | 82.6 (8.9%) | 0.59 |
| | Postgres, 10 | 81.0 (4.3%) | 83.5 (9.1%) | 27.8 (12.4%) | 0.34 |
| `login.password` | PGlite | 271.0 ms | 268.3 ms | 268.6 ms | 0.99 |
| | Postgres, 1 | 267.8 ms | 273.0 ms | 267.4 ms | 1.00 |
| | Postgres, 10 | 82.9 ms | 85.2 ms | 83.1 ms | 1.00 |

The two runs before the change differ by 8% at most; every lookup gained between 21% and 70%,
and the control stayed flat. The gain is the query builder: building and rendering the
`externalId` lookup costs 64 µs of CPU in Node, measured alone with no round trip. At
concurrency 10 the single Node thread is the bottleneck, which is why the throughput gains most.

The login is **not** prepared: its lookup is under 0.1% of a 270 ms bcrypt verification, below
any noise the bench can see.

**Unnamed, on purpose.** A named statement saves the parse on the server too. Measured against
the unnamed one: no difference on PGlite (it ignores the name), 0.69 to 0.79 on Postgres at
concurrency 1, 0.98 to 1.06 at concurrency 10. That is 16 to 35 µs of latency per lookup when
the server is idle and nothing under load, paid with session state: the statement stays on the
connection, which T-3.1 forbids, and a PgBouncer in transaction mode needs 1.21 or later with
`max_prepared_statements` above 0. `test/db/prepared.spec.ts` fails if a lookup leaves a named
statement on its connection.

**One registry read per request.** `provider.tenant()` takes the row the resolution has just
read and opens its container without reading the registry again. Against the unnamed run
above, `tenant.byId` went from 374.6 to 179.8 µs on PGlite (0.48), 160.5 to 82.8 on Postgres at
concurrency 1 (0.52) and 52.1 to 28.5 at concurrency 10 (0.55), level with `tenant.bySlug`
(178.5, 70.9, 24.2); the other paths stayed within the baseline dispersion. A scheduled
`every-tenant` job reads each row again right before its run, because the fleet list can be
minutes old: `test/lib/schedules.spec.ts` fails if it trusts the list.

## The whole request: the HTTP bench

```sh
npm run bench:http                                     # PGlite; Postgres too with BENCH_DATABASE_URL
npm run bench:http -- --tenancy single                 # without the tenants block (default: schema)
npm run bench:http -- --out before.json                # where the report goes (bench-http.json)
npm run bench:http -- --baseline before.json           # every median against an earlier report
npm run bench:http -- --smoke                          # one round of one second, what CI runs
```

`bench:paths` times the reads behind a request; `scripts/bench-http.ts` times the request around
them: the routing, the hooks, the token, the tenant resolution, the serialization, on a real
socket. The server boots the way a consumer boots it (`preload`, `startDataLayer`, `startServer`,
in `scripts/httpWorld.ts`), on a tenant provisioned through `POST /tenants` with 1000 users in it,
and the client is autocannon on a worker thread, so the load it generates does not queue behind the
server on the same event loop.

| Scenario | Request | Statements (`test/budget`) |
|---|---|---|
| `health` | `GET /health`, anonymous | 0 |
| `users.me` | `GET /users/me` as the tenant admin | 2 |
| `users.list` | `GET /users?_pageSize=25` as the tenant admin | 4 |

Each scenario gets a one-second warm-up, then 10 rounds of 3 seconds at 10 connections, with the
first scenario rotating. The report keeps, per scenario, the median of the requests per second, of
the mean latency and of the p99, with the IQR of the requests per second. The mean latency and not
the median: autocannon records whole milliseconds, and the median of a route that answers in a
fraction of one reads 0. It uses the same gate as `tune` (`scripts/machine.ts`); `--force`
measures anyway and `--smoke` implies it.

Postgres comes from `BENCH_DATABASE_URL` and **never** from `DATABASE_URL`: the bench creates
`bench_http_control` and `bench_http_t1`, drops them at the end, and refuses to start when one of
them already exists.

**No gate on time.** CI runs `--smoke` in the `test-pg` job, on PGlite and on its Postgres
service: it proves that the bench still runs and that every request answers 2xx, nothing more. A
latency depends on the machine and on what else runs on it; what a build can hold is the work, and
that is the query budget (`docs/TESTING_V5.md` §1). Read the IQR before reading a ratio.

No result is written down yet: on 5 October 2026 `kerkyra-2.local` stayed between 4 and 6 of load
over 10 cores, the gate is at 4, and the bench refused. The first baseline comes from a machine
at rest.
