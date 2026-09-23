import { createHash } from 'crypto'
import type {
  AuthContext,
  AuthInput,
  AuthResult,
  AuthReturnInput,
  Authenticator,
  ExternalAuthResult,
  OidcProviderSettings,
  ResolvedIdentityProvider
} from '../../../types/global.js'
import { resolveExternal } from '../external.js'

//
// OpenID Connect as an identifier (F39 to F42, T-12.28 to T-12.30).
//
// Three moments. `initiate` builds the address of the provider with PKCE `S256` and a `nonce`,
// always, and hands the verifier and the nonce to the engine, which keeps them encrypted in the flow
// row and answers the `state` that carries the routing. `complete` receives the browser's return on
// `/auth/flow/return/oidc`: it exchanges the code with the three checks (state, verifier, nonce),
// validates the ID token, and leaves the claims in the row; it issues nothing. `verify`, on the next
// step, cashes those claims with the flow credential that only the browser that started holds, and
// resolves who they are here (F40, F49). A login CSRF therefore lands in the attacker's own row.
//
// `openid-client` is an optional peer, loaded on first use (F42): a deployment that never lists
// `oidc` never loads it, and one that lists it without installing it is refused at boot. Its types
// stay inside this file, so the framework's public types never name it.
//

type Library = typeof import('openid-client')
type Configuration = import('openid-client').Configuration
type Fetch = (url: string, init: RequestInit) => Promise<Response>

const ID = 'oidc'
/** The pseudo-method a trusted second factor of the provider satisfies (F41). */
export const IDP_MFA = 'idp-mfa'

const DISCOVERY_TTL_MS = 60 * 60 * 1000
const DISCOVERY_TIMEOUT_S = 10
const DEFAULT_SCOPES = ['openid', 'email', 'profile']

let library: Promise<Library> | null = null
let fetchOverride: Fetch | null = null
const configurations = new Map<string, { at: number; config: Promise<Configuration> }>()

function load(): Promise<Library> {
  library ??= import('openid-client').catch((error: unknown) => {
    library = null
    throw new Error(`The openid-client library cannot be imported (${(error as Error)?.message}): npm i openid-client@^6`)
  })
  return library
}

/**
 * Where the provider's documents are fetched from. For the tests, and for a deployment that must
 * reach its provider through a proxy; null goes back to the platform's `fetch`. The discovery cache
 * is emptied, since a configuration keeps the fetch it was discovered with.
 */
export function useOidcFetch(fetchImpl: Fetch | null): void {
  fetchOverride = fetchImpl
  configurations.clear()
}

const fail = (reason: string, extra: { recoverable?: boolean } = {}): AuthResult => ({ outcome: 'fail', reason: reason as Uppercase<string>, ...extra })

const digest = (value: string) => createHash('sha256').update(value).digest('base64url')

/**
 * The discovered configuration of a provider, cached per issuer, client and secret for an hour. A
 * rotated secret is a new key, so it never reuses the old client; a failed discovery is not kept.
 */
async function configurationOf(provider: ResolvedIdentityProvider): Promise<Configuration> {
  const oidc = await load()
  const s = provider.settings
  const method = s.tokenAuthMethod ?? 'client_secret_basic'
  const key = [s.issuer, s.clientId, method, provider.clientSecret ? digest(provider.clientSecret) : '-'].join('|')
  const hit = configurations.get(key)
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return await hit.config

  // Without a secret the client is public, and PKCE is what binds the code to this flow.
  const auth = !provider.clientSecret
    ? oidc.None()
    : method === 'client_secret_post'
      ? oidc.ClientSecretPost(provider.clientSecret)
      : oidc.ClientSecretBasic(provider.clientSecret)
  const options: Record<string | symbol, unknown> = { timeout: DISCOVERY_TIMEOUT_S }
  if (fetchOverride) options[oidc.customFetch] = fetchOverride
  const config = oidc.discovery(new URL(s.issuer), s.clientId, undefined, auth, options).then((found) => {
    if (fetchOverride) found[oidc.customFetch] = fetchOverride
    return found
  })
  configurations.set(key, { at: Date.now(), config })
  config.catch(() => configurations.delete(key))
  return await config
}

/**
 * A path of the client, or null when none was asked for, or false when what was asked for is not a
 * path: an absolute URL, a scheme-relative `//host`, a backslash a browser reads as a slash. Only a
 * path is kept, so the 303 of the return cannot be pointed away from the configured console.
 */
export function returnPathOf(value: unknown): string | null | false {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 512) return false
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return false
  if ([...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) return false
  const base = 'https://return.invalid'
  try {
    return new URL(value, base).origin === base ? value : false
  } catch {
    return false
  }
}

/** Whether the provider's own second factor counts here (F41): only where it is declared, and the claim carries it. */
export function idpSecondFactor(settings: OidcProviderSettings, result: ExternalAuthResult): boolean {
  const trust = settings.mfa
  if (!trust?.values?.length) return false
  if (trust.trust === 'amr') return (result.amr ?? []).some((value) => trust.values.includes(value))
  if (trust.trust === 'acr') return typeof result.acr === 'string' && trust.values.includes(result.acr)
  return false
}

async function providerOf(ctx: AuthContext, key: unknown): Promise<ResolvedIdentityProvider | null> {
  if (typeof key !== 'string' || !ctx.provider) return null
  const provider = await ctx.provider(key)
  return provider?.type === ID ? provider : null
}

async function initiate(ctx: AuthContext, input: AuthInput): Promise<AuthResult> {
  if (!ctx.roundTrip) return fail('AUTH_FLOW_NOT_AVAILABLE')
  const provider = await providerOf(ctx, input.provider)
  if (!provider) return fail('IDP_UNKNOWN_PROVIDER')
  const returnTo = returnPathOf(input.returnTo)
  if (returnTo === false) return fail('AUTH_INPUT_INVALID')

  let config: Configuration
  try {
    config = await configurationOf(provider)
  } catch (error) {
    if (log.w) log.warn(`OIDC discovery failed for provider ${provider.key}: ${(error as Error)?.message}`)
    return fail('IDP_UNAVAILABLE')
  }

  const oidc = await load()
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const nonce = oidc.randomNonce()
  const state = await ctx.roundTrip.begin({ provider: provider.key, codeVerifier, nonce, ...(returnTo ? { returnTo } : {}) })
  if (!state) return fail('FLOW_EXPIRED')

  const s = provider.settings
  const parameters: Record<string, string> = {
    redirect_uri: s.redirectUri,
    scope: (s.scopes?.length ? s.scopes : DEFAULT_SCOPES).join(' '),
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce
  }
  // F41: a provider trusted on `acr` is asked for the level it is trusted at.
  if (s.mfa?.trust === 'acr' && s.mfa.values.length) parameters.acr_values = s.mfa.values.join(' ')
  return { outcome: 'redirect', binding: 'redirect', url: oidc.buildAuthorizationUrl(config, parameters).href }
}

async function complete(ctx: AuthContext, input: AuthReturnInput): Promise<AuthResult> {
  const external = ctx.flow?.external
  if (!external?.provider || !external.codeVerifier || !external.nonce) return fail('IDP_RETURN_INVALID')
  // The person declined, or the provider refused: its words go to the log, never to the client.
  if (input.error) {
    if (log.w) log.warn(`OIDC return refused by provider ${external.provider}: ${input.error}`)
    return fail('IDP_DENIED')
  }
  const provider = await providerOf(ctx, external.provider)
  if (!provider) return fail('IDP_UNKNOWN_PROVIDER')

  try {
    const oidc = await load()
    const config = await configurationOf(provider)
    const current = new URL(provider.settings.redirectUri)
    for (const [key, value] of Object.entries(input)) current.searchParams.set(key, value)
    const tokens = await oidc.authorizationCodeGrant(config, current, {
      pkceCodeVerifier: external.codeVerifier,
      expectedState: input.state,
      expectedNonce: external.nonce,
      idTokenExpected: true
    })
    const claims = tokens.claims()
    if (!claims?.iss || !claims.sub) return fail('IDP_RETURN_INVALID')
    const result: ExternalAuthResult = {
      provider: provider.key,
      issuer: claims.iss,
      subject: claims.sub,
      email: typeof claims.email === 'string' ? claims.email : null,
      emailVerified: claims.email_verified === true,
      ...(Array.isArray(claims.amr) ? { amr: claims.amr.filter((v): v is string => typeof v === 'string') } : {}),
      acr: typeof claims.acr === 'string' ? claims.acr : null
    }
    return { outcome: 'success', external: result }
  } catch (error) {
    if (log.w) log.warn(`OIDC return refused for provider ${provider.key}: ${(error as Error)?.message}`)
    return fail('IDP_RETURN_INVALID')
  }
}

async function verify(ctx: AuthContext): Promise<AuthResult> {
  const flow = ctx.flow
  if (!flow) return fail('FLOW_REQUIRED')
  // The client came back before the browser did: the flow stays, the step can be asked again.
  const result = flow.externalResult
  if (!result) return fail('IDP_RETURN_PENDING', { recoverable: true })

  const key = flow.external?.provider ?? result.provider
  const provider = await providerOf(ctx, key)
  if (!provider) return fail('IDP_UNKNOWN_PROVIDER')

  const resolution = await resolveExternal(ctx, provider, result)
  if (resolution.event && ctx.record) {
    const refused = resolution.outcome === 'refused'
    await ctx.record({
      event: resolution.event,
      outcome: resolution.event === 'idp.rejected' ? 'failure' : 'success',
      code: refused ? resolution.reason : null,
      subjectId: refused ? (resolution.subjectId ?? null) : resolution.subject.externalId,
      methods: [ID],
      provider: provider.key
    })
  }
  if (resolution.outcome === 'refused') {
    if (log.w) log.warn(`OIDC login refused for provider ${provider.key}: ${resolution.cause}`)
    return fail(resolution.reason)
  }
  return { outcome: 'success', subject: resolution.subject, satisfied: idpSecondFactor(provider.settings, result) ? [IDP_MFA] : [] }
}

export const oidcAuthenticator: Authenticator = {
  id: ID,
  kind: 'identifier',
  planes: ['tenant', 'control'],
  initiate,
  verify,
  complete
}
