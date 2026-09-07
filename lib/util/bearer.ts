/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Where the request's token is, and how it is read.
//
// One function, because two places need it and they must agree: the tenant is resolved from
// the token (T-3.2) before the authentication hook runs, and the authentication hook then
// reads the same token to identify the subject. In v4 the tenant hook did not read the token
// at all, and the check that pretended to compare them was dead code (D-03). Two readers of
// one credential is fine; two ways of finding it is how they drift apart.
//
import type { FastifyRequest } from 'fastify'

/**
 * The raw, still unverified token of a request, or undefined.
 *
 * `AUTH_MODE=COOKIE` reads the signed `auth_token` cookie, anything else the `Authorization`
 * header. Only one of the two is consulted, by configuration: accepting whichever happens to
 * be present would make the credential's source a runtime accident.
 */
export function bearerTokenOf(req: FastifyRequest): string | undefined {
  const mode = process.env.AUTH_MODE || 'BEARER'

  if (mode === 'COOKIE') {
    const cookieToken = (req as any).cookies?.['auth_token']
    if (!cookieToken) return undefined
    const unsigned = (req as any).unsignCookie(cookieToken)
    return unsigned?.valid && unsigned.value ? unsigned.value : undefined
  }

  const auth = (req.headers?.authorization as string) || ''
  const [prefix, token] = auth.split(' ')
  return prefix === 'Bearer' && token != null ? token : undefined
}
