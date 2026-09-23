import type { ControlHandle, DataHandle, SettingManagement, Tenant } from '../../types/global.js'

//
// Who may create an account in a tenant (F49).
//
// Two levels, each with its own data. The control plane decides the SET of modes a tenant may use:
// for every tenant through its own setting (or, without one, the deployment's configuration), for a
// single tenant through `config.account_creation.allowed` on the registry row, which REPLACES the
// global set for that tenant. The tenant's administrator picks one mode inside the set, stored in
// the tenant's own container. The effective mode is that pick while it stays in the set; otherwise
// the global default while it is in the set; otherwise the most closed mode of the set. A set
// narrowed after the pick therefore applies at once, without touching the tenant's data, and never
// opens more than it allows.
//
// It applies to both doors a person can create an account through: `/auth/register` and the
// just-in-time provisioning of an identity provider (F40).
//

/** From the most closed to the most open. The order is what "the most closed of the set" reads. */
export const ACCOUNT_CREATION_MODES = ['invite', 'approval', 'open'] as const
export type AccountCreationMode = (typeof ACCOUNT_CREATION_MODES)[number]

export interface AccountCreationRule {
  allowed: AccountCreationMode[]
  default: AccountCreationMode
}

export interface AccountCreationState {
  /** The set this tenant may choose from. */
  allowed: AccountCreationMode[]
  /** Who wrote the set: the tenant's registry row, the control plane's setting, the deployment. */
  allowedFrom: 'tenant' | 'control' | 'deployment'
  /** The global default, which applies while the tenant has chosen nothing inside the set. */
  default: AccountCreationMode
  /** What the tenant's administrator chose, even when it no longer is in the set. */
  choice: AccountCreationMode | null
  /** What applies now. */
  mode: AccountCreationMode
}

/** The setting of the control container that holds the rule for every tenant. */
export const CONTROL_KEY = 'account_creation'
/** The setting of a tenant's container that holds its administrator's choice. */
export const TENANT_KEY = 'account_creation.mode'

const FACTORY: AccountCreationRule = { allowed: [...ACCOUNT_CREATION_MODES], default: 'invite' }

export const isMode = (value: unknown): value is AccountCreationMode =>
  typeof value === 'string' && (ACCOUNT_CREATION_MODES as readonly string[]).includes(value)

const ordered = (modes: AccountCreationMode[]): AccountCreationMode[] =>
  ACCOUNT_CREATION_MODES.filter((m) => modes.includes(m))

export type Verdict<T> = { ok: true; value: T } | { ok: false; message: string }

/** A list of modes as written: non-empty, known modes only, duplicates collapsed, in their order. */
export function checkModes(value: unknown): Verdict<AccountCreationMode[]> {
  const list =
    typeof value === 'string'
      ? value
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
      : value
  if (!Array.isArray(list) || list.length === 0) {
    return { ok: false, message: `the allowed modes must be a non-empty list of ${ACCOUNT_CREATION_MODES.join(', ')}` }
  }
  const unknown = list.filter((m) => !isMode(m))
  if (unknown.length) {
    return {
      ok: false,
      message: `'${unknown.map(String).join("', '")}' is not a mode: write ${ACCOUNT_CREATION_MODES.join(', ')}`
    }
  }
  return { ok: true, value: ordered(list as AccountCreationMode[]) }
}

/** A rule as written by the deployment or by the control plane: the set, and a default inside it. */
export function checkRule(value: unknown): Verdict<AccountCreationRule> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, message: 'the rule must be { allowed: string[], default: string }' }
  }
  const { allowed, default: initial, ...rest } = value as Record<string, unknown>
  const extra = Object.keys(rest)
  if (extra.length) return { ok: false, message: `unknown keys: ${extra.join(', ')}` }
  const modes = checkModes(allowed)
  if (!modes.ok) return modes
  if (!isMode(initial)) return { ok: false, message: `default must be one of ${ACCOUNT_CREATION_MODES.join(', ')}` }
  if (!modes.value.includes(initial))
    return { ok: false, message: `default '${initial}' is not among the allowed modes` }
  return { ok: true, value: { allowed: modes.value, default: initial } }
}

/**
 * `config.account_creation` of a registry row: only `allowed`, the set for that tenant. Absent is
 * valid and means the global set. The default stays global: a tenant's own starting point is its
 * administrator's choice.
 */
export function checkTenantOverride(value: unknown): Verdict<{ allowed: AccountCreationMode[] } | null> {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'object' || Array.isArray(value))
    return { ok: false, message: 'account_creation must be { allowed: string[] }' }
  const { allowed, ...rest } = value as Record<string, unknown>
  const extra = Object.keys(rest)
  if (extra.length) return { ok: false, message: `account_creation takes only 'allowed', not ${extra.join(', ')}` }
  const modes = checkModes(allowed)
  return modes.ok ? { ok: true, value: { allowed: modes.value } } : modes
}

/** The deployment's rule, the one under everything else. Refused at boot when it is not a rule. */
export function deploymentRule(): AccountCreationRule {
  const declared = (global.config?.options as { accountCreation?: unknown } | undefined)?.accountCreation
  if (declared === undefined || declared === null) return { ...FACTORY, allowed: [...FACTORY.allowed] }
  const verdict = checkRule(declared)
  if (!verdict.ok) throw new Error(`accountCreation: ${verdict.message}`)
  return verdict.value
}

/** Stops the boot on a rule that is written and is not one, as `assertPolicies` does for MFA. */
export function assertAccountCreation(): void {
  deploymentRule()
}

const available = (settings: SettingManagement | undefined): settings is SettingManagement =>
  typeof settings?.isImplemented === 'function' && settings.isImplemented()

/**
 * The rule for every tenant: the control plane's setting, or the deployment's when there is none.
 * A stored value that is no longer a rule (edited by hand, or written by an older build) is read as
 * absent and logged, rather than locking every tenant out of its own registration.
 */
export async function globalRule(
  settings: SettingManagement | undefined,
  control: ControlHandle | null | undefined
): Promise<{ rule: AccountCreationRule; from: 'control' | 'deployment' }> {
  if (available(settings) && control) {
    const stored = await settings.get(control, CONTROL_KEY)
    if (stored !== null && stored !== undefined) {
      const verdict = checkRule(stored)
      if (verdict.ok) return { rule: verdict.value, from: 'control' }
      if (log.w) log.warn(`Setting ${CONTROL_KEY} ignored: ${verdict.message}`)
    }
  }
  return { rule: deploymentRule(), from: 'deployment' }
}

/** The mode that applies, given the set, the global default and what the tenant chose. */
export function effectiveMode(
  allowed: AccountCreationMode[],
  initial: AccountCreationMode,
  choice: AccountCreationMode | null
): AccountCreationMode {
  if (choice && allowed.includes(choice)) return choice
  if (allowed.includes(initial)) return initial
  return ordered(allowed)[0] ?? 'invite'
}

/**
 * Everything the two levels say about one tenant. `control` is the control container, `handle`
 * the tenant's; they are the same container in a single-tenant deployment, where `tenant` is null
 * and the control plane's setting is never written because its routes are not mounted.
 */
export async function accountCreationOf(input: {
  settings: SettingManagement | undefined
  control: ControlHandle | null | undefined
  handle: DataHandle
  tenant: Pick<Tenant, 'config'> | null | undefined
}): Promise<AccountCreationState> {
  const { rule, from } = await globalRule(input.settings, input.control)

  let allowed = rule.allowed
  let allowedFrom: AccountCreationState['allowedFrom'] = from
  const override = checkTenantOverride((input.tenant?.config as Record<string, unknown> | undefined)?.account_creation)
  if (override.ok && override.value) {
    allowed = override.value.allowed
    allowedFrom = 'tenant'
  } else if (!override.ok && log.w) {
    log.warn(`Tenant account_creation ignored: ${override.message}`)
  }

  let choice: AccountCreationMode | null = null
  if (available(input.settings)) {
    const stored = await input.settings.get(input.handle, TENANT_KEY)
    choice = isMode(stored) ? stored : null
  }

  return { allowed, allowedFrom, default: rule.default, choice, mode: effectiveMode(allowed, rule.default, choice) }
}
