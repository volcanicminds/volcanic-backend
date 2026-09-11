/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Where the request's credential is, how it is read, and how a session is written.
//
// One module, because the readers and the writers must agree: the tenant is resolved from
// the token (T-3.2) before the authentication hook runs, the hook then reads the same token
// to identify the subject, and the login writes it where both will look. In v4 the tenant
// hook did not read the token at all, and the check that pretended to compare them was dead
// code (D-03). Two readers of one credential is fine; two ways of finding it is how they
// drift apart.
//
// T-10.37: two channels, one kind of credential each.
//
// `AUTH_MODE=COOKIE`, the default, keeps the browser session in a signed httpOnly cookie that
// no script of the page can read, and leaves the `Authorization` header to the integration
// tokens (`/token`), which are issued to programs, not to browsers. The v4 rule was "one
// source per configuration", and it made the two exclusive: in cookie mode the header was not
// read at all, so turning the cookie on broke every integration. The rule is now "one source
// per kind of credential", and it is enforced by the authentication hook, not only described
// here: a session token presented in the header of a cookie deployment is refused.
//
// `AUTH_MODE=BEARER` is the explicit choice for clients that cannot hold a cookie: every
// credential travels in the header and is returned in the body, as before.
//
// Each plane has its own pair of cookies. A browser of a platform operator holds the control
// session and, while impersonating, a tenant session at the same time: one cookie for both
// would make opening an impersonation the same act as losing the session that can end it.
//
import type { FastifyReply, FastifyRequest } from 'fastify'

export type AuthMode = 'COOKIE' | 'BEARER'
export type Plane = 'tenant' | 'control'
export type Channel = 'cookie' | 'header'

export interface Credential {
  token: string
  channel: Channel
}

/** The claim that makes a refresh token unusable as an access token, and the reverse. */
export const REFRESH_TYP = 'refresh'

export const SESSION_COOKIES: Record<Plane, { access: string; refresh: string; refreshRoute: string }> = {
  tenant: { access: 'auth_token', refresh: 'refresh_token', refreshRoute: '/auth/refresh-token' },
  control: { access: 'control_token', refresh: 'control_refresh_token', refreshRoute: '/system/auth/refresh-token' }
}

/**
 * The configured mode. Unset means `COOKIE`; anything that is not one of the two modes is
 * refused, because v4 read any other value as `BEARER` and `AUTH_MODE=cookie` silently
 * meant the opposite of what it said. `index.ts` calls this before registering anything, so
 * a bad value stops the boot instead of the first request.
 */
export function authMode(): AuthMode {
  const raw = process.env.AUTH_MODE
  if (raw === undefined || raw.trim() === '') return 'COOKIE'
  const mode = raw.trim().toUpperCase()
  if (mode === 'COOKIE' || mode === 'BEARER') return mode
  throw new Error(`AUTH_MODE='${raw}' is not an authentication mode: write COOKIE or BEARER`)
}

export function isCookieMode(): boolean {
  return authMode() === 'COOKIE'
}

function headerToken(req: FastifyRequest): string | undefined {
  const auth = (req.headers?.authorization as string) || ''
  const [prefix, token] = auth.split(' ')
  return prefix === 'Bearer' && token ? token : undefined
}

function signedCookie(req: FastifyRequest, name: string): string | undefined {
  const raw = (req as any).cookies?.[name]
  if (!raw || typeof (req as any).unsignCookie !== 'function') return undefined
  const unsigned = (req as any).unsignCookie(raw)
  return unsigned?.valid && unsigned.value ? unsigned.value : undefined
}

/**
 * The raw, still unverified access credential of a request on `plane`, and the channel it
 * came from, or undefined.
 *
 * In cookie mode the header is read first when it is present: it is the explicit credential
 * of a program, the cookie is the ambient one of a browser, and a program that sends a
 * header means it. Which kinds of token each channel may carry is decided by the
 * authentication hook, which is the one place that knows what the subject turned out to be.
 */
export function credentialOf(req: FastifyRequest, plane: Plane = 'tenant'): Credential | undefined {
  const header = headerToken(req)
  if (header) return { token: header, channel: 'header' }
  if (!isCookieMode()) return undefined

  const cookie = signedCookie(req, SESSION_COOKIES[plane].access)
  return cookie ? { token: cookie, channel: 'cookie' } : undefined
}

/** The refresh token held in the cookie of `plane`, unverified. Cookie mode only. */
export function refreshCookieOf(req: FastifyRequest, plane: Plane): string | undefined {
  return isCookieMode() ? signedCookie(req, SESSION_COOKIES[plane].refresh) : undefined
}

/** The access token held in the cookie of `plane`, unverified, whatever the header says. */
export function accessCookieOf(req: FastifyRequest, plane: Plane): string | undefined {
  return isCookieMode() ? signedCookie(req, SESSION_COOKIES[plane].access) : undefined
}

/**
 * The session token of a handler that verifies one by itself (the MFA verification): the
 * cookie in cookie mode, the header in bearer mode, never the other channel. Those routes are
 * open to a pre-auth token, so the hook tolerates what it refuses elsewhere, and reading
 * `credentialOf` here would let the header carry a session in cookie mode after all.
 */
export function sessionTokenOf(req: FastifyRequest, plane: Plane): string | undefined {
  return isCookieMode() ? accessCookieOf(req, plane) : headerToken(req)
}

//
// Writing.
//
// T-10.38: the cookie lives exactly as long as the token it carries. v4 wrote `maxAge: 86400`
// by hand while the JWT inside lasted `JWT_EXPIRES_IN`, fifteen days: the browser dropped the
// cookie after one, and anyone who copied its value could replay it for fourteen more. The
// lifetime is now read back from the token's own `exp`, so the only setting is the one that
// signs it, and a token that cannot expire is never written here.
//

/**
 * Where a proxy publishes this API, when it strips that prefix before forwarding
 * (`COOKIE_PATH_PREFIX=/api`). The refresh cookie is limited to the renewal route, and the
 * browser matches that path against the URL it sees, not the one this process receives.
 */
function pathPrefix(): string {
  const raw = (process.env.COOKIE_PATH_PREFIX || '').trim()
  if (!raw || raw === '/') return ''
  return ('/' + raw.replace(/^\/+|\/+$/g, '')).replace(/\/{2,}/g, '/')
}

export function refreshCookiePath(plane: Plane): string {
  return pathPrefix() + SESSION_COOKIES[plane].refreshRoute
}

function secondsLeft(reply: FastifyReply, token: string): number {
  const claims = (reply.server as any).jwt.decode(token) as { exp?: number } | null
  if (!claims?.exp) throw new Error('A session cookie must carry a token that expires')
  return Math.max(0, claims.exp - Math.floor(Date.now() / 1000))
}

function write(reply: FastifyReply, name: string, token: string, path: string) {
  reply.setCookie(name, token, {
    path,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    signed: true,
    maxAge: secondsLeft(reply, token)
  })
}

export function setAccessCookie(reply: FastifyReply, plane: Plane, token: string) {
  write(reply, SESSION_COOKIES[plane].access, token, '/')
}

export function setRefreshCookie(reply: FastifyReply, plane: Plane, refreshToken: string) {
  write(reply, SESSION_COOKIES[plane].refresh, refreshToken, refreshCookiePath(plane))
}

export function clearAccessCookie(reply: FastifyReply, plane: Plane) {
  reply.clearCookie(SESSION_COOKIES[plane].access, { path: '/' })
}

export function clearRefreshCookie(reply: FastifyReply, plane: Plane) {
  reply.clearCookie(SESSION_COOKIES[plane].refresh, { path: refreshCookiePath(plane) })
}

export function clearSessionCookies(reply: FastifyReply, plane: Plane) {
  if (!isCookieMode()) return
  clearAccessCookie(reply, plane)
  clearRefreshCookie(reply, plane)
}

/**
 * Signs a session for `claims` and hands it over the channel of the configured mode.
 *
 * The refresh token carries `typ: 'refresh'` and the access token does not: the two
 * namespaces share `JWT_SECRET` whenever `JWT_REFRESH_SECRET` is unset, and without the claim
 * either token verifies as the other. A refresh token would then open every route for its
 * whole lifetime, and an access token could renew itself forever, which would make a short
 * access token (T-10.39) a number and not a limit.
 *
 * In cookie mode the body carries `null` in place of both tokens: the fields stay, so a
 * client can tell "the session is in the cookie" from "this build has no refresh tokens".
 */
export async function issueSession(
  reply: FastifyReply,
  plane: Plane,
  claims: Record<string, unknown>
): Promise<{ token: string | null; refreshToken: string | null | undefined }> {
  const token = await reply.jwtSign(claims)
  const signer = (reply.server as any).jwt['refreshToken']
  const refreshToken: string | undefined = signer ? await signer.sign({ ...claims, typ: REFRESH_TYP }) : undefined

  if (!isCookieMode()) return { token, refreshToken }

  setAccessCookie(reply, plane, token)
  if (refreshToken) setRefreshCookie(reply, plane, refreshToken)
  else clearRefreshCookie(reply, plane)
  return { token: null, refreshToken: null }
}

/**
 * The five-minute token between the first factor and the second.
 *
 * In cookie mode it sits in the access cookie, where the MFA gate of the authentication hook
 * already confines it to the verification and setup routes, and any refresh cookie left by an
 * earlier session is dropped: a login that has not finished must not be renewable into one
 * that has.
 */
export async function issuePreAuth(reply: FastifyReply, plane: Plane, claims: Record<string, unknown>): Promise<string | null> {
  const tempToken = await reply.jwtSign({ ...claims, role: 'pre-auth-mfa' }, { expiresIn: '5m' })
  if (!isCookieMode()) return tempToken

  setAccessCookie(reply, plane, tempToken)
  clearRefreshCookie(reply, plane)
  return null
}
