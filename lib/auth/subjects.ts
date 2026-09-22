/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AuthPlane, AuthSubject } from '../../types/global.js'

/** Role codes, whether a manager hands back codes or `{ code }` rows. */
export function roleCodes(roles: unknown, fallback: string[] = []): string[] {
  if (!Array.isArray(roles) || roles.length === 0) return fallback
  return roles.map((r: any) => (typeof r === 'string' ? r : r?.code)).filter((r): r is string => typeof r === 'string' && !!r)
}

/**
 * A user row of either plane as the engine sees it. `factors` is what an optional stage and the
 * MFA floor ask about: today only the TOTP flag of the row. A system user has no confirmation
 * step (it is provisioned), so it is confirmed by construction.
 */
export function toSubject(plane: AuthPlane, user: any): AuthSubject {
  const publicRole = global.roles?.public?.code || 'public'
  return {
    id: String(user.id),
    externalId: String(user.externalId),
    email: String(user.email ?? ''),
    roles: roleCodes(user.roles, plane === 'tenant' ? [publicRole] : []),
    factors: user.mfaEnabled ? ['totp'] : [],
    confirmed: plane === 'control' ? true : user.confirmed === true,
    blocked: Boolean(user.blocked)
  }
}
