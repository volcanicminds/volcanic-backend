import { createHash, generateKeyPairSync, randomBytes, sign } from 'crypto'

//
// An OpenID provider without a network (T-12.40, anticipated by T-12.29): discovery, JWKS and the
// token endpoint answered in process through the `fetch` the OIDC authenticator can be given. It
// signs real RS256 ID tokens with a key of its own, checks PKCE on the code exchange, and spends a
// code once, so what `openid-client` validates here is what it validates against a real provider.
//
// A test plays the browser: it reads the authorization address the flow answered, "logs in" with
// `authorize`, and brings the code and the state back to the return route.
//

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export interface IdpClaims {
  sub: string
  email?: string
  email_verified?: boolean
  amr?: string[]
  acr?: string
  [claim: string]: unknown
}

interface Grant {
  clientId: string
  redirectUri: string
  challenge: string
  nonce: string
  claims: IdpClaims
  used: boolean
}

export function fakeIdp(issuer = 'https://idp.acme.test') {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' }
  const grants = new Map<string, Grant>()
  const exchanges: string[] = []

  const metadata = {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post']
  }

  function idToken(payload: Record<string, unknown>): string {
    const head = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT' })
    const body = b64(payload)
    return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')}`
  }

  async function fetch(url: string, init: RequestInit = {}): Promise<Response> {
    const at = new URL(url)
    if (at.origin !== new URL(issuer).origin) return new Response('unknown host', { status: 502 })
    if (at.pathname === '/.well-known/openid-configuration') return json(metadata)
    if (at.pathname === '/jwks') return json({ keys: [jwk] })
    if (at.pathname === '/token') {
      const form = new URLSearchParams(String(init.body ?? ''))
      const code = form.get('code') ?? ''
      exchanges.push(code)
      const grant = grants.get(code)
      if (!grant || grant.used) return json({ error: 'invalid_grant' }, 400)
      grant.used = true
      const verifier = form.get('code_verifier') ?? ''
      if (createHash('sha256').update(verifier).digest('base64url') !== grant.challenge) return json({ error: 'invalid_grant' }, 400)
      if (form.get('redirect_uri') !== grant.redirectUri) return json({ error: 'invalid_grant' }, 400)
      const now = Math.floor(Date.now() / 1000)
      return json({
        access_token: randomBytes(16).toString('hex'),
        token_type: 'Bearer',
        expires_in: 300,
        id_token: idToken({ iss: issuer, aud: grant.clientId, iat: now, exp: now + 300, nonce: grant.nonce, ...grant.claims })
      })
    }
    return new Response('not found', { status: 404 })
  }

  /**
   * The person logs in at the provider: a code for the authorization address a flow answered.
   * `nonce` replaces the one the flow sent, to play a provider, or an attacker, that answers another.
   */
  function authorize(address: string, claims: IdpClaims, options: { nonce?: string } = {}) {
    const params = new URL(address).searchParams
    const code = randomBytes(12).toString('base64url')
    grants.set(code, {
      clientId: params.get('client_id') ?? '',
      redirectUri: params.get('redirect_uri') ?? '',
      challenge: params.get('code_challenge') ?? '',
      nonce: options.nonce ?? params.get('nonce') ?? '',
      claims,
      used: false
    })
    return { code, state: params.get('state') ?? '', params }
  }

  return { issuer, fetch, authorize, exchanges }
}
