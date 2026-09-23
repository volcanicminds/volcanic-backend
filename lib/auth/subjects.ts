/* eslint-disable @typescript-eslint/no-explicit-any */
import type { AuthPlane, AuthSubject, UserManagement } from '../../types/global.js'

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

/**
 * Why a tenant user may not log in, or null when it may: a row with an address and a password, the
 * address confirmed, not blocked, not waiting for an administrator (F49). Every door asks this one
 * question, so a condition added here reaches all of them. The cause is for the log only: the
 * caller answers the uniform refusal of D-17 whichever it is.
 */
export async function tenantRefusal(users: UserManagement, user: any): Promise<string | null> {
  if (!user || !(await users.isValidUser(user))) return 'AUTH_INVALID_USER'
  if (user.confirmed !== true) return 'AUTH_UNCONFIRMED'
  if (user.blocked) return 'AUTH_BLOCKED'
  if (user.approved === false) return 'AUTH_PENDING_APPROVAL'
  return null
}

export const mayLogIn = async (users: UserManagement, user: any): Promise<boolean> => (await tenantRefusal(users, user)) === null
