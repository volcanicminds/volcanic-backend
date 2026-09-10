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

**Median, not mean, with the spread beside it.** A mean is moved by one slow run, and one slow
run is what a laptop produces. A median of 200 ms at 5% spread and a median of 200 ms at 90%
spread are not the same measurement, and only one of them is worth deriving a default from.

Where a median lands under a millisecond — the page-size rows usually do — the spread is
scheduling noise and says nothing. Read the medians there and ignore the percentage.

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
