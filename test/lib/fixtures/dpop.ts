//
// A machine's key pair and the DPoP proofs it signs (RFC 9449), written here from the RFC and not
// with lib/util/dpop.ts, so a mistake in the verifier is not shared by the client that tests it.
//
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto'

export interface MachineKey {
  /** The public half, as `/token/pair` takes it. */
  jwk: Record<string, string>
  /** A proof for one request: each call a new `jti`. `claims` overrides any claim, `header` any header member. */
  proof(method: string, url: string, token: string, override?: { claims?: Record<string, unknown>; header?: Record<string, unknown> }): string
}

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')

export function machineKey(kind: 'ed25519' | 'p256' = 'ed25519'): MachineKey {
  const { publicKey, privateKey }: { publicKey: KeyObject; privateKey: KeyObject } =
    kind === 'ed25519' ? generateKeyPairSync('ed25519') : generateKeyPairSync('ec', { namedCurve: 'P-256' })
  const full = publicKey.export({ format: 'jwk' }) as Record<string, string>
  const jwk: Record<string, string> = kind === 'ed25519' ? { kty: full.kty, crv: full.crv, x: full.x } : { kty: full.kty, crv: full.crv, x: full.x, y: full.y }
  return {
    jwk,
    proof(method, url, token, override = {}) {
      const header = { typ: 'dpop+jwt', alg: kind === 'ed25519' ? 'EdDSA' : 'ES256', jwk, ...override.header }
      const u = new URL(url)
      const claims = {
        jti: randomUUID(),
        htm: method,
        htu: `${u.origin}${u.pathname}`,
        iat: Math.floor(Date.now() / 1000),
        ath: createHash('sha256').update(token).digest('base64url'),
        ...override.claims
      }
      const input = `${b64(header)}.${b64(claims)}`
      const signature =
        kind === 'ed25519'
          ? sign(null, Buffer.from(input), privateKey)
          : sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' })
      return `${input}.${signature.toString('base64url')}`
    }
  }
}
