# Coverage: what is measured, and what the number is for

Run it:

```sh
npm run coverage        # measures and enforces the floor
npm run coverage:report # measures and writes coverage/, without enforcing
```

It runs in CI, in the `test` job. Before T-10.27 it did not, and nobody noticed that it had been
failing on its own thresholds.

## How it is measured

`c8` with the **monocart** backend (`experimental-monocart` in `.c8rc.json`), and the floors
enforced by `scripts/check-coverage.mjs`. Both choices are there because the default path
measured something else:

- under `tsx` a module can be compiled twice in the same process, once as CommonJS and once as
  ESM, with the same URL on both scripts. istanbul keeps the last of two file coverages whose
  structure differs instead of summing them, so `lib/manifest/generator.ts` read 94.98% alone
  with its own spec and 42.58% in the full suite. Monocart merges the V8 ranges first, and reads
  93.8% in the full suite;
- monocart counts **executable** lines; plain `c8` counts every physical line, comments and type
  declarations included, which is why the same file was 479 lines there and 111 here;
- c8's own `--check-coverage` under monocart divides covered lines by the *statement* count, so
  it enforced 81.77% on a run that reported 85.06%. The script compares the floors against the
  same `coverage/coverage-summary.json` the report prints.

## The number is a floor, not a target

The thresholds in `.c8rc.json` sit just under what the suite reaches today. That is
deliberate: they exist so a change that *removes* coverage fails, and for nothing else. A
percentage used as a goal buys tests that execute lines without demonstrating anything, which
is the most expensive way to not have tests.

What actually says the framework is tested is the other check, `npm run check:refusals`: every
error code the source can answer with has a test that makes it fire. That one is a statement
about behaviour, and it fails the build when a new refusal arrives without a test — a
percentage cannot notice that, because one untested `throw` is a rounding error in a
denominator.

## What is excluded, and why

Coverage measures executable decisions. These files contain none, so counting them moves the
percentage without telling anyone anything — and a large denominator of untestable lines hides
the real gaps behind it, which is the opposite of what the measurement is for.

| Excluded | Why |
|---|---|
| `lib/api/*/routes.ts` | object literals declaring method, path and schema refs. There is no branch to take. They are exercised at boot by the router, whose own behaviour is tested in `test/lib/router.spec.ts`, and end to end by the isolation bench |
| `lib/schemas/**` | JSON Schema literals. Asserting them would mean typing each one twice; what matters is that the loader registers and merges them, which `test/lib/loaders.spec.ts` covers |
| `lib/config/**` | the framework's default configuration, also literals. The behaviour that depends on them is tested where it is read (`test/lib/cors.spec.ts`, `test/lib/merge.spec.ts`) |
| `lib/util/mark.ts` | the ASCII banner printed at startup |
| `lib/middleware/pre*.ts`, `post*.ts` | empty extension points, present so a consuming project can replace them |
| `lib/database/schema/entry/**` | static modules that exist for `drizzle-kit` and are never imported at runtime |

## What is measured and still low

`index.ts` is the server bootstrap, and it is covered by `npm run test:e2e:mt:pg` — which runs
the real server in a **separate process**, so c8 sees none of it. The number under-reports it
and that is worth knowing rather than working around: the bench is what proves the bootstrap
works, and it is a stronger statement than a line count.
