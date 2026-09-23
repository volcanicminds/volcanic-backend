import type {
  AuthPlane,
  ControlHandle,
  IdentityProviderManagement,
  OidcProviderSettings,
  ResolvedAuthFlows,
  ResolvedIdentityProvider
} from '../../types/global.js'

//
// Identity providers (F38, T-12.25, T-12.26): where their settings come from and what shape they
// must have.
//
// Two sources. The deployment declares providers per plane in `authFlows.ts`, with the client secret
// as the NAME of an environment variable, read once at boot and kept in this module: never on a
// global, never in a log line, never in the frozen flows a debugger or a dump could print. A tenant
// brings its own through the control routes, stored in the registry with the secret encrypted by the
// data layer. On the tenant plane a tenant's own provider wins over a deployment one of the same key:
// the realistic case is "this customer logs in with its Entra ID", and it is the platform operator,
// not the customer, who writes that row.
//
// The shape is checked where it is written, the same rules for both sources, and never by calling
// the provider: a registry write that waited on somebody else's network would be a write that fails
// for reasons nobody can see.
//

/** A provider key: lowercase, it names a route segment and a column value. */
export const PROVIDER_KEY = /^[a-z0-9][a-z0-9_-]{0,62}$/

/** The settings a provider may carry. Anything else is refused, a secret above all: `config` is stored in clear. */
const SETTINGS = new Set<keyof OidcProviderSettings>([
  'issuer',
  'clientId',
  'redirectUri',
  'scopes',
  'tokenAuthMethod',
  'linkByEmail',
  'emailDomains',
  'jit',
  'mfa'
])

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim().length > 0)

function url(value: unknown): URL | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * What is wrong with a provider's settings, one sentence per problem, empty when nothing is. The
 * deployment's extra keys (`type`, `clientSecretEnv`) are the caller's to allow.
 */
export function providerShapeProblems(settings: unknown, options: { plane: AuthPlane; allow?: readonly string[] }): string[] {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return ['the settings must be an object']
  const s = settings as Record<string, unknown>
  const problems: string[] = []

  const extra = Object.keys(s).filter((key) => !SETTINGS.has(key as keyof OidcProviderSettings) && !options.allow?.includes(key))
  if (extra.length) problems.push(`unknown settings ${extra.join(', ')}: a client secret travels apart from them, and nothing else is read`)

  const issuer = url(s.issuer)
  if (!issuer || issuer.protocol !== 'https:') problems.push('issuer must be an https URL')
  if (typeof s.clientId !== 'string' || !s.clientId.trim()) problems.push('clientId is required')
  // Explicit and absolute: derived from the Host header, it would be whatever the caller wrote there.
  const redirect = url(s.redirectUri)
  if (!redirect || (redirect.protocol !== 'https:' && redirect.protocol !== 'http:')) problems.push('redirectUri must be an absolute http(s) URL')

  if (s.scopes !== undefined && !isStringList(s.scopes)) problems.push('scopes must be a list of strings')
  if (s.tokenAuthMethod !== undefined && !['client_secret_basic', 'client_secret_post'].includes(String(s.tokenAuthMethod))) {
    problems.push("tokenAuthMethod must be 'client_secret_basic' or 'client_secret_post'")
  }
  if (s.linkByEmail !== undefined && typeof s.linkByEmail !== 'boolean') problems.push('linkByEmail must be a boolean')
  if (s.emailDomains !== undefined && !isStringList(s.emailDomains)) problems.push('emailDomains must be a list of domains')
  // F40: linking by email without a list of domains would link any address the provider vouches for.
  if (s.linkByEmail === true && !(isStringList(s.emailDomains) && s.emailDomains.length > 0)) {
    problems.push('linkByEmail needs emailDomains: the domains whose addresses may be linked')
  }

  if (s.jit !== undefined) {
    const jit = s.jit as { enabled?: unknown; roles?: unknown }
    if (!jit || typeof jit !== 'object' || typeof jit.enabled !== 'boolean' || !isStringList(jit.roles ?? [])) {
      problems.push('jit must be { enabled: boolean, roles: string[] }')
    } else if (jit.enabled && options.plane === 'control') {
      // Platform identities are provisioned, never created by a login (F40).
      problems.push('jit is not available on the control plane')
    } else if ((jit.roles as string[] | undefined)?.includes(global.roles?.admin?.code || 'admin')) {
      problems.push('jit.roles cannot include the admin role')
    }
  }

  if (s.mfa !== undefined) {
    const mfa = s.mfa as { trust?: unknown; values?: unknown }
    if (!mfa || typeof mfa !== 'object' || !['amr', 'acr'].includes(String(mfa.trust)) || !isStringList(mfa.values) || !mfa.values.length) {
      problems.push("mfa must be { trust: 'amr' | 'acr', values: string[] } with at least one value")
    }
  }
  return problems
}

/** A provider ready for a login: its settings, where they came from, and the secret when it has one. */
export type ResolvedProvider = ResolvedIdentityProvider

let deploymentSecrets: ReadonlyMap<string, string> = new Map()

const secretKey = (plane: AuthPlane, key: string) => `${plane}:${key}`

/**
 * Reads the deployment's client secrets once, at boot, after the validation refused an empty one.
 * Later changes to the environment are not seen: a secret rotates with a restart, as a key does.
 */
export function captureDeploymentSecrets(flows: ResolvedAuthFlows, env: NodeJS.ProcessEnv): number {
  const secrets = new Map<string, string>()
  for (const plane of ['tenant', 'control'] as const) {
    for (const [key, provider] of Object.entries(flows[plane].providers ?? {})) {
      const value = env[provider.clientSecretEnv]?.trim()
      if (value) secrets.set(secretKey(plane, key), value)
    }
  }
  deploymentSecrets = secrets
  return secrets.size
}

/**
 * The provider a login on this plane names by `key`. On the tenant plane of a multi-tenant
 * deployment the tenant's own active provider comes first, then the deployment's; a disabled one
 * of the tenant hides the deployment's of the same key, because the operator switched that key off.
 */
export async function resolveProvider(input: {
  plane: AuthPlane
  key: string
  flows: ResolvedAuthFlows
  tenantId: string | null
  control: ControlHandle | null
  identityProviders?: IdentityProviderManagement
}): Promise<ResolvedProvider | null> {
  const { plane, key, flows, tenantId, control, identityProviders } = input
  if (!PROVIDER_KEY.test(key)) return null

  if (plane === 'tenant' && tenantId && control && identityProviders?.isImplemented?.()) {
    const own = await identityProviders.get(control, tenantId, key)
    if (own) {
      if (own.status !== 'active') return null
      return { key, type: own.type, source: 'tenant', settings: own.config, clientSecret: own.clientSecret }
    }
  }

  const declared = flows[plane].providers?.[key]
  if (!declared) return null
  const { type, clientSecretEnv, ...settings } = declared
  void clientSecretEnv
  return { key, type, source: 'deployment', settings, clientSecret: deploymentSecrets.get(secretKey(plane, key)) ?? null }
}
