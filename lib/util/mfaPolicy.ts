'use strict'

//
// The effective MFA policy, plane by plane and tenant by tenant (T-10.19).
//
// One value for the whole deployment was a floor nobody could raise: a customer who wanted the
// second factor for everyone could not have it, and the platform's own operators were not covered
// at all, so `MANDATORY` obliged the users of every tenant and none of the people who can destroy
// one. Three levels now, and one rule that keeps them honest: the deployment value is the FLOOR,
// and what the control plane or a tenant declares may only tighten it. A weaker value is refused
// when it is written, never ignored when it is read.
//
import { MfaPolicy } from '../config/constants.js'

/**
 * From the weakest to the strongest.
 *
 * `OFF` means «no new enrolments», not «no second factor»: whoever already has one keeps being
 * asked for it, and only a reset by an administrator takes it away. Otherwise flipping a switch
 * would silently lower the protection of the accounts that had it.
 */
const ORDER: MfaPolicy[] = [MfaPolicy.OFF, MfaPolicy.OPTIONAL, MfaPolicy.ONE_WAY, MfaPolicy.MANDATORY]

const strength = (policy: MfaPolicy): number => ORDER.indexOf(policy)

const options = (): Record<string, unknown> => (global.config?.options ?? {}) as Record<string, unknown>

/** A written value that is not one of the four is not a policy: the caller decides what to do. */
export function parsePolicy(value: unknown): MfaPolicy | undefined {
  if (typeof value !== 'string') return undefined
  const upper = value.trim().toUpperCase()
  return ORDER.find((policy) => policy === upper)
}

/** The stricter of the two, which is how a floor is applied. */
export function strictest(a: MfaPolicy, b: MfaPolicy): MfaPolicy {
  return strength(a) >= strength(b) ? a : b
}

/** The deployment's own value: the floor under everything else. */
export function floorPolicy(): MfaPolicy {
  return parsePolicy(options().mfa_policy) ?? MfaPolicy.OPTIONAL
}

/** The platform's operators. They are the ones who can destroy a container, hence a value of their own. */
export function controlPolicy(): MfaPolicy {
  const declared = parsePolicy(options().system_mfa_policy)
  return declared ? strictest(floorPolicy(), declared) : floorPolicy()
}

/** One customer's users. Declared in the `config` of its registry row, already loaded per request. */
export function tenantPolicy(tenant?: { config?: Record<string, unknown> | null } | null): MfaPolicy {
  const declared = parsePolicy(tenant?.config?.mfa_policy)
  return declared ? strictest(floorPolicy(), declared) : floorPolicy()
}

/** Enrolling a new second factor. False only under `OFF`. */
export const allowsEnrolment = (policy: MfaPolicy): boolean => policy !== MfaPolicy.OFF

/**
 * Taking one's own factor away. Only where it is optional: under `ONE_WAY` and `MANDATORY` it was
 * already refused, and under `OFF` the way out is a reset by an administrator, not a self-service
 * switch that would undo what the policy just froze.
 */
export const allowsSelfDisable = (policy: MfaPolicy): boolean => policy === MfaPolicy.OPTIONAL

/** The one value that forces an enrolment, and therefore needs something to enrol with. */
export const demandsEnrolment = (policy: MfaPolicy): boolean => policy === MfaPolicy.MANDATORY

/**
 * Whether this build can issue a second factor at all. The Null Object answers `false` here and
 * throws on every other method, so a missing manager is a question that can be asked instead of
 * an exception that arrives three layers down as a 500.
 */
export function mfaAvailable(manager: unknown): boolean {
  const candidate = manager as { isImplemented?: () => boolean } | undefined
  return typeof candidate?.isImplemented === 'function' ? candidate.isImplemented() : Boolean(candidate)
}

/**
 * The boot refusal: a policy that demands a factor the build cannot issue locks everyone out at
 * the first login, because the login answers «enrol first» and the enrolment has nothing to enrol
 * with. Pure, so the message is testable without starting a server.
 */
export function unavailableMandatory(input: { floor: MfaPolicy; control: MfaPolicy; implemented: boolean }): string | null {
  if (input.implemented) return null

  const source =
    input.floor === MfaPolicy.MANDATORY ? 'MFA_POLICY' : input.control === MfaPolicy.MANDATORY ? 'SYSTEM_MFA_POLICY' : null
  if (!source) return null

  return (
    `${source}=MANDATORY demands a second factor and this build has no MFA manager: ` +
    'inject one through start(decorators), or lower the policy'
  )
}

export type PolicyVerdict =
  | { ok: true; policy?: MfaPolicy }
  | { ok: false; code: 'MFA_POLICY_INVALID' | 'MFA_POLICY_WEAKER'; message: string }

/**
 * The verdict on the value a tenant wants for itself: it may tighten, never loosen. Refused when
 * it is written, because a value silently ignored at read time is a policy that lies: the operator
 * would see it stored and believe it applies.
 */
export function checkTenantPolicy(value: unknown): PolicyVerdict {
  if (value === undefined || value === null) return { ok: true }

  const parsed = parsePolicy(value)
  if (!parsed) {
    return {
      ok: false,
      code: 'MFA_POLICY_INVALID',
      message: `'${String(value)}' is not an MFA policy: write one of ${ORDER.join(', ')}`
    }
  }

  const floor = floorPolicy()
  if (strength(parsed) < strength(floor)) {
    return {
      ok: false,
      code: 'MFA_POLICY_WEAKER',
      message: `A tenant may only tighten the deployment policy (${floor}), and '${parsed}' is weaker`
    }
  }

  return { ok: true, policy: parsed }
}

/**
 * Refuses at boot a policy that was written and is not one, as `AUTH_MODE` does: reading it as
 * "the default" is how `AUTH_MODE=cookie` once meant the opposite of what it said.
 */
export function assertPolicies(): void {
  for (const key of ['mfa_policy', 'system_mfa_policy']) {
    const value = options()[key]
    if (value === undefined || value === null || value === '') continue
    if (!parsePolicy(value)) {
      throw new Error(`${key}='${String(value)}' is not an MFA policy: write one of ${ORDER.join(', ')}`)
    }
  }
}
