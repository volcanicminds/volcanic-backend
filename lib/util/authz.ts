// Helpers for the admin-apex guards in the users and token controllers. Pure, so they
// unit-test without a request context. Role values may arrive as string codes
// (`['admin']`) or as `{ code }` objects; both are normalized here.

/** De-duped list of role codes from a roles value (accepts strings or `{ code }`). */
export function roleCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const codes = value
    .map((r) => (typeof r === 'string' ? r : (r as { code?: string } | null)?.code))
    .filter((c): c is string => !!c)
  return [...new Set(codes)]
}

/** Whether a roles value grants the given role code. */
export function includesRole(value: unknown, code: string): boolean {
  return roleCodes(value).includes(code)
}

/**
 * Whether a user row is the sovereign founder of ITS OWN container (T-4.3).
 *
 * v4 asked this question of the process environment: `email === process.env.ADMIN_EMAIL`.
 * On a single-tenant instance that was merely indirect; in multi-tenant it meant the same
 * address was the sovereign inside EVERY tenant, so one customer's admin inherited the
 * protections, and the powers, of another's (defect D-27). Worse, it made the answer depend
 * on how the process happened to be started rather than on anything written down.
 *
 * In v5 it is a column of the row, so the question is answered by the container the row
 * lives in, and two tenants can each have their own founder without knowing about each
 * other. `ADMIN_EMAIL` survives for exactly one job, seeding the first identity on an empty
 * plane at boot (see lib/loader/genesis.ts); after that write nothing reads it again.
 */
export function isFounder(user: unknown): boolean {
  return (user as { isFounder?: unknown } | null)?.isFounder === true
}
