/* eslint-disable @typescript-eslint/no-explicit-any */
// Fixture controller for the per-route cache e2e. `counter` increments a
// module-level counter on every real invocation and echoes it both in the body
// and a custom `v-count` header — so a cached (replayed) response keeps the same
// value/header, while a fresh one (after invalidation/expiry) advances it.
let n = 0

export async function counter(_req: any, reply: any) {
  n += 1
  reply.header('v-count', String(n))
  return { n }
}

export async function bump(_req: any, _reply: any) {
  return { ok: true }
}

export async function limited(_req: any, _reply: any) {
  return { ok: true }
}

// Always fails (2xx-only guard): increments its own counter so a test can assert
// that a non-2xx response is never cached (each call runs the handler again).
let f = 0
export async function failing(_req: any, reply: any) {
  f += 1
  return reply.code(500).send({ f })
}
