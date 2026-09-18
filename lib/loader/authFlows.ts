import type { AuthFlowLimits, AuthFlowsConfig, AuthPlane, ResolvedAuthFlows } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { envInt } from '../util/env.js'
import { globSync } from 'glob'

const PLANES: readonly AuthPlane[] = ['tenant', 'control']

/** Each limit and the variable that wins over it, as the `sessions` block does. */
const LIMIT_ENV: Record<keyof AuthFlowLimits, string> = {
  flowTtl: 'AUTH_FLOW_TTL',
  otpTtl: 'AUTH_OTP_TTL',
  otpMaxAttempts: 'AUTH_OTP_MAX_ATTEMPTS',
  otpMaxSends: 'AUTH_OTP_MAX_SENDS'
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const nested of Object.values(value)) deepFreeze(nested)
  }
  return value
}

/**
 * The effective flows. A plane block the project declares replaces the framework's whole; the
 * limits are scalars and are taken key by key, the environment winning over both files. Pure
 * apart from the environment, so the replacement rule is tested without files.
 */
export function resolveAuthFlows(framework: AuthFlowsConfig, project: AuthFlowsConfig | null = null): ResolvedAuthFlows {
  const planeOf = (plane: AuthPlane) => {
    const block = project?.[plane] ?? framework[plane]
    if (!block) throw new Error(`Auth flows: the framework defaults declare no '${plane}' plane`)
    // A copy, so freezing the result never freezes a module's export behind its author's back.
    return structuredClone(block)
  }

  const limits = {} as AuthFlowLimits
  for (const key of Object.keys(LIMIT_ENV) as Array<keyof AuthFlowLimits>) {
    const declared = project?.limits?.[key] ?? framework.limits?.[key]
    limits[key] = envInt(LIMIT_ENV[key], declared as number)
  }

  return deepFreeze({ tenant: planeOf('tenant'), control: planeOf('control'), limits })
}

async function readConfig(pattern: string): Promise<AuthFlowsConfig | null> {
  const [file] = globSync(pattern, { windowsPathsNoEscape: true })
  if (!file) return null
  const module = await import(file)
  return (module.default ?? module) as AuthFlowsConfig
}

/** Found like `roles.ts`: the framework's file next to this loader, the project's under `src/config`. */
export async function load(): Promise<ResolvedAuthFlows> {
  const [frameworkPattern, projectPattern] = normalizePatterns(
    ['..', 'config', 'authFlows.{ts,js}'],
    ['src', 'config', 'authFlows.{ts,js}']
  )

  const framework = await readConfig(frameworkPattern)
  if (!framework) throw new Error(`Auth flows: the framework defaults were not found at ${frameworkPattern}`)
  const project = await readConfig(projectPattern)

  const resolved = resolveAuthFlows(framework, project)
  if (log.i) {
    const origin = PLANES.map((plane) => `${plane} from the ${project?.[plane] ? 'project' : 'framework'}`)
    log.info(`Auth flows loaded: ${origin.join(', ')}`)
  }
  return resolved
}
