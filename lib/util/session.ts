/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from 'crypto'

//
// The refresh credential (T-11.6, decisions F20 to F24 in EVO_FASE_11.md).
//
// The refresh token is opaque and self-describing: `vs1.<routing>.<sid>.<secret>`. Only the
// secret is a credential; the first three fields are addressing, and none of them is trusted
// until the registry says the hash of the secret matches a live row.
//
// Why not a JWT, which is what v4 and the first v5 used. A signature is worth having when the
// receiver must decide alone, and here the receiver cannot: the renewal has to read the
// session row anyway, to learn whether that generation was already spent. So the signature adds
// a second secret to manage, a second namespace that verifies as the first whenever the two
// secrets coincide (the reason `typ: 'refresh'` had to exist at all), and a set of claims that
// go stale. An opaque secret is worth nothing without the database, which is the property that
// actually matters here.
//
// Why the routing prefix, which looks like a leak of the tenant id. In multi-tenant the session
// row lives INSIDE the tenant's container and there is no global index of sessions: to read the
// row you must first choose the container, so the container has to be named by something that
// arrives with the request. The tenant id is not a secret (it travels in every access token
// already) and the prefix is verified against the tenant of the request, exactly as
// `TENANT_MISMATCH` does for the access token.
//
export const SESSION_TOKEN_VERSION = 'vs1'

/** The routing segment of a session that belongs to the platform rather than to a tenant. */
export const CONTROL_ROUTING = 'ctl'

export interface RefreshCredential {
  /** Tenant id, or `ctl` for the control plane. */
  routing: string
  sid: string
  /** The only part that is a credential. The registry stores its SHA-256 and nothing else. */
  secret: string
  /** The whole token, as it goes into the cookie or the body. */
  raw: string
}

const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

/** 32 bytes from the CSPRNG, base64url. Never derived from the subject or from the time. */
export function newSessionSecret(): string {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * The token handed to the client.
 *
 * Minting and composing are two steps because the `sid` is decided by the row: the secret is
 * generated first, the registry writes the row and gives back its `sid`, and only then is there
 * a token to compose. Doing it the other way would mean choosing an identifier in the core and
 * hoping the store agrees.
 */
export function composeRefreshCredential(routing: string, sid: string, secret: string): RefreshCredential {
  return { routing, sid, secret, raw: [SESSION_TOKEN_VERSION, routing, sid, secret].join('.') }
}

/**
 * The parts of a presented token, or null.
 *
 * Null for anything that is not exactly four well-formed segments, because this runs on a
 * string a stranger chose: a malformed token is a refusal the caller writes, never an exception
 * that becomes a 500 and tells the sender something about the inside of the process.
 */
export function parseRefreshCredential(raw: unknown): RefreshCredential | null {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > 512) return null
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [version, routing, sid, secret] = parts
  if (version !== SESSION_TOKEN_VERSION) return null
  if (!SEGMENT.test(routing) || !SEGMENT.test(sid) || !SEGMENT.test(secret)) return null
  return { routing, sid, secret, raw }
}

//
// Lifetimes.
//
// Two clocks and a tolerance, and each one answers a different question (F23, F24). Inactivity
// ends a session nobody is using; the absolute lifetime ends a session that renews for ever;
// the grace window is what keeps two tabs renewing in the same instant from looking like a
// theft. Seconds everywhere, because a duration written as `180d` in one place and as a number
// in another is two units nobody converts in the same direction.
//
export interface SessionLifetimes {
  idleSeconds: number
  absoluteSeconds: number
  graceSeconds: number
}

const DEFAULTS: SessionLifetimes = {
  idleSeconds: 30 * 24 * 60 * 60,
  absoluteSeconds: 180 * 24 * 60 * 60,
  graceSeconds: 10
}

const positive = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function block(): Record<string, unknown> {
  const sessions = (global as any)?.config?.options?.sessions
  return sessions && typeof sessions === 'object' ? (sessions as Record<string, unknown>) : {}
}

/** Configuration first, environment as the override a deployment can turn without a release. */
export function sessionLifetimes(): SessionLifetimes {
  const configured = block()
  return {
    idleSeconds: positive(process.env.SESSION_IDLE_TTL ?? configured.idleTtl, DEFAULTS.idleSeconds),
    absoluteSeconds: positive(process.env.SESSION_ABSOLUTE_TTL ?? configured.absoluteTtl, DEFAULTS.absoluteSeconds),
    // Zero is a legitimate choice here (no tolerance at all), so it is read separately.
    graceSeconds: (() => {
      const raw = process.env.SESSION_GRACE_SECONDS ?? configured.graceSeconds
      const parsed = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN
      return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : DEFAULTS.graceSeconds
    })()
  }
}

/** The two moments a session opened now would carry. */
export function sessionExpiries(from = new Date()): { idleExpiresAt: Date; absoluteExpiresAt: Date } {
  const { idleSeconds, absoluteSeconds } = sessionLifetimes()
  return {
    idleExpiresAt: new Date(from.getTime() + idleSeconds * 1000),
    absoluteExpiresAt: new Date(from.getTime() + absoluteSeconds * 1000)
  }
}

/** The idle clock a renewal pushes forward, never past the absolute one. */
export function nextIdleExpiry(absoluteExpiresAt: Date | string, from = new Date()): Date {
  const { idleSeconds } = sessionLifetimes()
  const absolute = absoluteExpiresAt instanceof Date ? absoluteExpiresAt : new Date(absoluteExpiresAt)
  const candidate = new Date(from.getTime() + idleSeconds * 1000)
  return Number.isNaN(absolute.getTime()) || candidate <= absolute ? candidate : absolute
}

/**
 * Whether this deployment keeps a session registry.
 *
 * The block can turn it off explicitly, but the real switch is the manager: without a data
 * layer there is nothing to write the row in, and F28 says that means no renewal at all rather
 * than a renewal that pretends to rotate.
 */
export function sessionRegistryEnabled(manager: { isImplemented?: () => boolean } | undefined): boolean {
  if (block().enabled === false) return false
  // `JWT_REFRESH=false` kept its meaning through the change of mechanism: it is the deployment
  // that wants sessions to end when the access token does, and nothing to renew them.
  const raw = (process.env.JWT_REFRESH || '').trim().toLowerCase()
  if (raw === 'false' || raw === '0' || raw === 'no') return false
  return typeof manager?.isImplemented === 'function' && manager.isImplemented()
}
