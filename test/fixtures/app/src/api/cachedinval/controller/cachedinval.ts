/* eslint-disable @typescript-eslint/no-explicit-any */
// Fixture controller for FILE-LEVEL invalidation-only inheritance: the POST below
// declares no per-route `cache` and inherits `config.cache = { enabled: false,
// invalidates: ['cachedfile'] }` — so it is never cached itself, but flushes the
// 'cachedfile' key-group on a successful (2xx) response.
export async function bump(_req: any, _reply: any) {
  return { ok: true }
}
