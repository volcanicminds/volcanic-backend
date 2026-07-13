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
 * Whether an email identifies the sovereign founder (env `ADMIN_EMAIL`, case-insensitive).
 * Returns false when `ADMIN_EMAIL` is unset, so founder guards stay inert without it.
 */
export function isFounderEmail(email: unknown): boolean {
  const founder = process.env.ADMIN_EMAIL?.trim().toLowerCase()
  return !!founder && typeof email === 'string' && email.trim().toLowerCase() === founder
}
