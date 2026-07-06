/* eslint-disable @typescript-eslint/no-explicit-any */
// Fixture controller for FILE-LEVEL cache inheritance: the route below declares
// no per-route `cache`, so it must inherit `config.cache` from routes.ts. `list`
// increments a module-level counter on every real invocation, so a cached
// (replayed) response keeps the same value and a fresh one advances it.
let n = 0

export async function list(_req: any, _reply: any) {
  n += 1
  return { n }
}
