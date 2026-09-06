/* eslint-disable @typescript-eslint/no-explicit-any */
// The query is deliberately UNQUALIFIED (`from widget`, never `from public.widget`):
// qualifying it would hide exactly the defect this bench exists to catch.
//
// `req` is typed `any` on purpose: this fixture is written against the v5 contract
// (docs/MANAGERS_V5.md §1) before the types exist, and it must not need editing when
// they do — a test that gets adjusted to go green proves nothing.
const READ = 'select tag from widget limit 1'

async function readTag(handle: any): Promise<string | null> {
  if (!handle) return null
  const res = await handle.execute(READ)
  const rows = res?.rows ?? res
  return rows?.[0]?.tag ?? null
}

export async function tenantRead(req: any, _reply: any) {
  return { scope: 'tenant', tenant: req.tenantInfo?.slug ?? null, tag: await readTag(req.tenant) }
}

export async function controlRead(req: any, _reply: any) {
  return { scope: 'control', tenant: req.tenantInfo?.slug ?? null, tag: await readTag(req.control) }
}
