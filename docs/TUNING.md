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
