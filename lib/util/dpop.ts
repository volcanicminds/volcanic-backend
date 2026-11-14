//
// Integration tokens bound to a key (RFC 9449, DPoP).
//
// A machine that pairs (docs/API_V5.md §4.2) sends the public half of a key pair it generated, and
// the bearer it gets carries the key's thumbprint in `cnf.jkt`, signed with the rest. From then on
// the bearer authenticates nothing by itself: each request carries it under the `DPoP` scheme with
// a proof, a JWT the private key signs over the method, the URL, the time and a hash of the bearer.
// A bearer copied out of a log, a proxy or a backup proves nothing without the key, and a proof
// is spent by its first request.
//
import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'

/** The public keys a proof may be signed with, each with the one algorithm it signs under. */
export type PublicJwk = { kty: 'OKP'; crv: 'Ed25519'; x: string } | { kty: 'EC'; crv: 'P-256'; x: string; y: string }

const ALGORITHM = { OKP: 'EdDSA', EC: 'ES256' } as const

/** How far a proof's `iat` may sit from this server's clock, either way: a machine's clock drifts. */
export const DPOP_WINDOW_S = 60

const B64URL = /^[A-Za-z0-9_-]+$/
const isB64url = (value: unknown, bytes: number): value is string =>
  typeof value === 'string' && B64URL.test(value) && Buffer.from(value, 'base64url').length === bytes

/**
 * The public key a client sent, reduced to its required members, or null. A key with a private
 * member (`d`) is refused rather than trimmed: a client that sends its private key has leaked it.
 */
export function publicJwkOf(raw: unknown): PublicJwk | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const jwk = raw as Record<string, unknown>
  if ('d' in jwk) return null
  if (jwk.kty === 'OKP' && jwk.crv === 'Ed25519' && isB64url(jwk.x, 32)) return { kty: 'OKP', crv: 'Ed25519', x: jwk.x }
  if (jwk.kty === 'EC' && jwk.crv === 'P-256' && isB64url(jwk.x, 32) && isB64url(jwk.y, 32)) {
    const key = { kty: 'EC' as const, crv: 'P-256' as const, x: jwk.x, y: jwk.y }
    // A point off the curve fails here, not at the first request.
    try {
      createPublicKey({ key, format: 'jwk' })
    } catch {
      return null
    }
    return key
  }
  return null
}

/** RFC 7638: the SHA-256 of the required members in lexicographic order, base64url. */
export function jwkThumbprint(jwk: PublicJwk): string {
  const canonical = jwk.kty === 'OKP' ? { crv: jwk.crv, kty: jwk.kty, x: jwk.x } : { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }
  return createHash('sha256').update(JSON.stringify(canonical)).digest('base64url')
}

/** Why a proof was refused. One code for all: the reason is in the message. */
export class DpopError extends Error {
  readonly authCode = 'DPOP_PROOF_INVALID'
  constructor(message: string) {
    super(message)
    this.name = 'DpopError'
  }
}

/**
 * The proofs already spent, until their window closes. Per process: behind several instances a
 * proof can be replayed once on each of the others within the window, which is what a shared store
 * would remove. Only proofs that verified are written, so only a key holder can fill it.
 */
const spent = new Map<string, number>()
let purged = 0

function spend(key: string, until: number, now: number): boolean {
  // At most once a second: a scan at every request would grow with the traffic it serves.
  if (now - purged > 1000) {
    purged = now
    for (const [k, end] of spent) if (end < now) spent.delete(k)
  }
  const end = spent.get(key)
  if (end !== undefined && end >= now) return false
  spent.set(key, until)
  return true
}

/**
 * A request's path as the URL parser reads an `htu`'s, or null for one that is not a path. Appended
 * to an origin, not resolved against one: a path beginning `//` stays a path.
 */
const parsedPath = (path: string): string | null => {
  if (!path.startsWith('/')) return null
  try {
    return new URL(`http://localhost${path}`).pathname
  } catch {
    return null
  }
}

const json = (part: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/**
 * Checks the proof of a request bound to `jkt`, and throws `DpopError` if it is not one. The URL
 * is compared on its path alone, since behind a proxy the server does not see the origin the
 * client used; `request.path` is the path as the client called it, a proxy's stripped prefix
 * included. The two must be equal once the same parser has read both, so neither an encoding nor
 * a dot segment tells them apart, and a proof for one route never passes on another. The query is
 * not part of `htu` (RFC 9449 §4.2).
 */
export function verifyProof(
  proof: unknown,
  request: { method: string; path: string; token: string; jkt: string },
  now = Date.now()
): void {
  if (typeof proof !== 'string' || !proof) throw new DpopError('This token is bound to a key: the request needs a DPoP proof')
  const parts = proof.split('.')
  if (parts.length !== 3) throw new DpopError('The DPoP proof is not a JWT')
  const [head, body, signature] = parts
  const header = json(head)
  const claims = json(body)
  if (!header || !claims) throw new DpopError('The DPoP proof is not a JWT')
  if (header.typ !== 'dpop+jwt') throw new DpopError('The DPoP proof is not typed dpop+jwt')

  const jwk = publicJwkOf(header.jwk)
  if (!jwk) throw new DpopError('The DPoP proof carries no public key this server accepts (Ed25519, or P-256)')
  if (header.alg !== ALGORITHM[jwk.kty]) throw new DpopError(`The DPoP proof's key signs with ${ALGORITHM[jwk.kty]}, not ${String(header.alg)}`)
  if (jwkThumbprint(jwk) !== request.jkt) throw new DpopError('The DPoP proof is signed with a key this token is not bound to')

  const key: KeyObject = createPublicKey({ key: jwk, format: 'jwk' })
  const signed = Buffer.from(`${head}.${body}`)
  const raw = Buffer.from(signature, 'base64url')
  const valid = jwk.kty === 'OKP' ? verify(null, signed, key, raw) : verify('sha256', signed, { key, dsaEncoding: 'ieee-p1363' }, raw)
  if (!valid) throw new DpopError('The DPoP proof does not verify with its key')

  if (claims.htm !== request.method.toUpperCase()) throw new DpopError('The DPoP proof was signed for another method')
  let path: string
  try {
    path = new URL(String(claims.htu)).pathname
  } catch {
    throw new DpopError('The DPoP proof names no URL')
  }
  if (path !== parsedPath(request.path)) throw new DpopError('The DPoP proof was signed for another URL')
  if (claims.ath !== createHash('sha256').update(request.token).digest('base64url')) {
    throw new DpopError('The DPoP proof was signed for another token')
  }
  const iat = claims.iat
  if (typeof iat !== 'number' || Math.abs(now / 1000 - iat) > DPOP_WINDOW_S) {
    throw new DpopError(`The DPoP proof is older or newer than ${DPOP_WINDOW_S} s: check the machine's clock`)
  }
  if (typeof claims.jti !== 'string' || !claims.jti || claims.jti.length > 256) throw new DpopError('The DPoP proof has no jti')
  if (!spend(`${request.jkt}:${claims.jti}`, (iat + DPOP_WINDOW_S) * 1000, now)) throw new DpopError('This DPoP proof was used already')
}
