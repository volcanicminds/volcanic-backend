import type {
  AuthenticatorRegistry,
  AuthFlowLimits,
  AuthPlane,
  AuthPlaneFlows,
  DeploymentProvider,
  ResolvedAuthFlows
} from '../../types/global.js'
import { MfaPolicy } from '../config/constants.js'
import { demandsEnrolment, mfaAvailable, unavailableMandatory } from '../util/mfaPolicy.js'
import { kindsOf } from './registry.js'
import { PROVIDER_KEY, providerShapeProblems } from './providers.js'
import { IDP_MFA } from './authenticators/oidc.js'

//
// The boot refusal of the flow configuration (T-12.6).
//
// Everything here would otherwise be found at a login: a flow nobody can be chosen for, a method
// that is not registered, a code that nobody can deliver. Pure, like `unavailableMandatory`: the
// caller gathers what the build has and this answers one message per cause, each with its fix.
//

/** The method the engine enrols a subject in when `MANDATORY` meets a subject with no factor (F35). */
export const ENROLMENT_METHOD = 'totp'
export const EMAIL_OTP = 'email-otp'
export const OIDC = 'oidc'
export const OIDC_LIBRARY = 'openid-client'

const PROVIDER_FIELDS: ReadonlyArray<keyof DeploymentProvider> = ['issuer', 'clientId', 'redirectUri', 'clientSecretEnv']

export interface AuthFlowCheck {
  flows: ResolvedAuthFlows
  registry: AuthenticatorRegistry
  /** The role codes of each catalogue: `config/roles.ts` and `config/systemRoles.ts`. */
  roles: Record<AuthPlane, readonly string[]>
  implemented: { mfa: boolean; challengeDelivery: boolean; authFlow: boolean }
  /** The deployment floor, which is the tenant plane's policy at boot, and the control plane's. */
  policies: { floor: MfaPolicy; control: MfaPolicy }
  /** Whether `openid-client` imports. Only asked when a plane lists `oidc`. */
  oidcLibrary: boolean
  env: Readonly<Record<string, string | undefined>>
}

const CATALOGUE_FILE: Record<AuthPlane, string> = { tenant: 'config/roles.ts', control: 'config/systemRoles.ts' }

const isStringList = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string')

/** Every method a plane names, in `identify` and in any stage. */
function namedMethods(block: AuthPlaneFlows): Set<string> {
  const ids = new Set(block.identify)
  for (const flow of block.flows) for (const stage of flow.stages ?? []) for (const id of stage.anyOf ?? []) ids.add(id)
  return ids
}

/** Whether any plane names `id`; the boot uses it to decide whether a library is worth importing. */
export function listsMethod(flows: ResolvedAuthFlows, id: string): boolean {
  return (['tenant', 'control'] as const).some((plane) => {
    const block = flows[plane]
    return isStringList(block?.identify) && Array.isArray(block?.flows) && namedMethods(block).has(id)
  })
}

/**
 * Whether a plane can serve the floor of `policy`: under `MANDATORY` a subject without a factor
 * enrols inside the flow, and that needs the enrolment method registered on that plane.
 */
export function floorEnrollable(policy: MfaPolicy, registry: AuthenticatorRegistry | undefined, plane: AuthPlane): boolean {
  return !demandsEnrolment(policy) || Boolean(registry?.get(plane, ENROLMENT_METHOD))
}

/** Any injected manager, asked the way the MFA manager is: the Null Object answers false. */
export const isImplemented = (manager: unknown): boolean => mfaAvailable(manager)

/** A dynamic import that answers instead of throwing: a missing optional peer is a boot message. */
export async function canImport(specifier: string): Promise<boolean> {
  try {
    await import(specifier)
    return true
  } catch {
    return false
  }
}

function shapeProblem(block: unknown): string | null {
  if (!block || typeof block !== 'object') return 'is not an object with `identify` and `flows`'
  const { identify, flows, providers } = block as Partial<AuthPlaneFlows>
  if (!isStringList(identify)) return '`identify` must be a list of method ids'
  if (!Array.isArray(flows)) return '`flows` must be a list'
  if (providers !== undefined && (!providers || typeof providers !== 'object' || Array.isArray(providers))) {
    return '`providers` must be an object keyed by provider name'
  }
  for (const [i, flow] of flows.entries()) {
    if (!flow || !isStringList(flow.roles) || !Array.isArray(flow.stages)) {
      return `flow ${i + 1} must have \`roles\` (a list of role codes) and \`stages\` (a list, possibly empty)`
    }
    if (flow.identifiers !== undefined && !isStringList(flow.identifiers)) return `flow ${i + 1}: \`identifiers\` must be a list`
    for (const [j, stage] of flow.stages.entries()) {
      if (!stage || !isStringList(stage.anyOf)) return `flow ${i + 1}, stage ${j + 1}: \`anyOf\` must be a list of method ids`
    }
  }
  return null
}

function planeProblems(plane: AuthPlane, block: AuthPlaneFlows, input: AuthFlowCheck): string[] {
  const where = `authFlows.${plane}`
  const problems: string[] = []
  const { registry } = input

  const unknown = (id: string, at: string) =>
    `${where}: ${at} names '${id}', which is not an authenticator of the ${plane} plane: ` +
    'register it through start({ authenticators }) or remove it'

  if (!block.identify.length) problems.push(`${where}: \`identify\` is empty: list at least one identifier, e.g. ['password']`)
  for (const id of block.identify) {
    const authenticator = registry.get(plane, id)
    if (!authenticator) problems.push(unknown(id, '`identify`'))
    else if (!kindsOf(authenticator).includes('identifier')) {
      problems.push(`${where}: \`identify\` names '${id}', a verifier: it proves something about a known subject, move it into a stage`)
    }
  }

  const catchAll = block.flows.map((flow) => flow.roles.includes('*'))
  if (!catchAll.length || !catchAll[catchAll.length - 1]) {
    problems.push(
      `${where}: the last flow must have roles ['*'], or a subject whose roles meet no flow cannot log in: ` +
        "add { roles: ['*'], stages: [] } at the end"
    )
  }
  catchAll.slice(0, -1).forEach((isCatchAll, i) => {
    if (isCatchAll) {
      problems.push(`${where}: flow ${i + 1} has roles ['*'] and is not the last: the flows after it can never be chosen, move it to the end`)
    }
  })

  const catalogue = new Set(input.roles[plane])
  block.flows.forEach((flow, i) => {
    const at = `flow ${i + 1}`
    if (!flow.roles.length) problems.push(`${where}: ${at} has no roles: name role codes, or '*' for everyone`)
    for (const role of flow.roles) {
      if (role !== '*' && !catalogue.has(role)) {
        problems.push(`${where}: ${at} names role '${role}', which is not in the ${plane} catalogue: declare it in ${CATALOGUE_FILE[plane]}`)
      }
    }
    for (const id of flow.identifiers ?? []) {
      if (!block.identify.includes(id)) {
        problems.push(`${where}: ${at} accepts identifier '${id}', which \`identify\` does not list: add it there or drop it here`)
      }
    }
    flow.stages.forEach((stage, j) => {
      const stageAt = `${at}, stage ${j + 1}`
      if (!stage.anyOf.length) problems.push(`${where}: ${stageAt} has an empty \`anyOf\`: list at least one verifier`)
      for (const id of stage.anyOf) {
        // Not a method but a fact a provider's login may bring (F41): it is met or it is not, and it
        // can only be met where an identity provider logs people in.
        if (id === IDP_MFA) {
          if (!block.identify.includes(OIDC)) {
            problems.push(`${where}: ${stageAt} names '${IDP_MFA}', which only an '${OIDC}' login can satisfy, and \`identify\` does not list '${OIDC}'`)
          }
          continue
        }
        const authenticator = registry.get(plane, id)
        if (!authenticator) problems.push(unknown(id, stageAt))
        else if (!kindsOf(authenticator).includes('verifier')) {
          problems.push(`${where}: ${stageAt} names '${id}', an identifier: a stage after \`identify\` takes verifiers only`)
        }
      }
    })
  })

  for (const [key, provider] of Object.entries(block.providers ?? {})) {
    const missing: string[] = PROVIDER_FIELDS.filter((field) => typeof provider?.[field] !== 'string' || !String(provider[field]).trim())
    if (provider?.type !== 'oidc') missing.unshift("type: 'oidc'")
    if (missing.length) {
      problems.push(`${where}: provider '${key}' is missing ${missing.join(', ')}`)
      continue
    }
    if (!PROVIDER_KEY.test(key)) problems.push(`${where}: provider key '${key}' must be lowercase letters, digits, '-' or '_'`)
    // The same rules a tenant's provider meets at the control routes (T-12.26).
    for (const problem of providerShapeProblems(provider, { plane, allow: ['type', 'clientSecretEnv'] })) {
      problems.push(`${where}: provider '${key}': ${problem}`)
    }
    if (!input.env[provider.clientSecretEnv]?.trim()) {
      // The name is printed, the value never: there is none, and there must never be one in the file.
      problems.push(`${where}: provider '${key}' reads its client secret from ${provider.clientSecretEnv}, which is empty: set that variable`)
    }
  }

  const named = namedMethods(block)
  const required = new Set(block.flows.flatMap((flow) => flow.stages.filter((s) => !s.optional).flatMap((s) => s.anyOf)))

  if (named.has(EMAIL_OTP) && !input.implemented.challengeDelivery) {
    problems.push(`${where}: lists '${EMAIL_OTP}' and no challenge delivery is injected: pass challengeDeliveryManager to start(), wired to a mailer`)
  }
  if (required.has(ENROLMENT_METHOD) && !input.implemented.mfa) {
    problems.push(
      `${where}: requires '${ENROLMENT_METHOD}' in a stage that is not optional and this build has no MFA manager: ` +
        'inject mfaManager through start(decorators), or mark the stage optional'
    )
  }
  const policy = plane === 'tenant' ? input.policies.floor : input.policies.control
  if (!floorEnrollable(policy, registry, plane)) {
    problems.push(
      `${where}: the ${plane} policy is ${policy}, and a subject with no factor enrols in '${ENROLMENT_METHOD}', ` +
        `which is not an authenticator of the ${plane} plane: register one, or lower the policy`
    )
  }

  // F46. An optional stage alone is left out on purpose: it applies only to a subject already
  // enrolled in a method of it, and that subject meets the engine's own refusal at the step. A
  // method with `initiate` or a required stage can never close in one request.
  if (!input.implemented.authFlow) {
    const steps = [
      ...[...named].filter((id) => typeof registry.get(plane, id)?.initiate === 'function').map((id) => `'${id}' starts a challenge or a redirect`),
      ...block.flows.flatMap((flow, i) =>
        flow.stages.some((s) => !s.optional) ? [`flow ${i + 1} has a stage that is not optional`] : []
      ),
      // The floor adds a second step to every login (F35), and an enrolment inside the flow for
      // whoever has no factor yet: neither can run without the row.
      ...(demandsEnrolment(policy) ? [`the ${plane} policy is ${policy}`] : [])
    ]
    if (steps.length) {
      problems.push(
        `${where}: ${steps.join('; ')}, and no flow store is injected: load the data layer or inject authFlowManager. ` +
          'Without one, only a password login with optional stages can run'
      )
    }
  }

  if (named.has(OIDC) && !input.oidcLibrary) {
    problems.push(`${where}: lists '${OIDC}' and the ${OIDC_LIBRARY} library cannot be imported: npm i ${OIDC_LIBRARY}@^6`)
  }

  return problems
}

/** Every reason the flows of this build cannot run, one message each. Empty means the boot goes on. */
export function authFlowProblems(input: AuthFlowCheck): string[] {
  const problems: string[] = []

  const mandatory = unavailableMandatory({ floor: input.policies.floor, control: input.policies.control, implemented: input.implemented.mfa })
  if (mandatory) problems.push(mandatory)

  for (const [key, value] of Object.entries(input.flows.limits) as Array<[keyof AuthFlowLimits, number]>) {
    if (!Number.isInteger(value) || value <= 0) problems.push(`authFlows.limits.${key} must be a positive integer, got ${String(value)}`)
  }

  for (const plane of ['tenant', 'control'] as const) {
    const block = input.flows[plane]
    const shape = shapeProblem(block)
    if (shape) problems.push(`authFlows.${plane}: ${shape}`)
    else problems.push(...planeProblems(plane, block, input))
  }

  return problems
}
