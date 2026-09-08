/* eslint-disable @typescript-eslint/no-explicit-any */
import { getParams, getData } from '../util/common.js'
import { httpError } from '../util/httpError.js'
import type { AuthenticatedUser, AuthenticatedToken, Role, TransferManagement } from '../../types/global.js'
import { dataContext, isTenancyEnabled } from '../util/tenancy.js'
import { bearerTokenOf } from '../util/bearer.js'
import { SYSTEM_PUBLIC } from '../loader/roles.js'

const MFA_SETUP_WHITELIST = ['/auth/mfa/setup', '/auth/mfa/enable', '/auth/mfa/verify', '/auth/logout']

const normalizeRoles = (rolesArray: any[] | undefined): string[] => {
  if (!rolesArray || rolesArray.length === 0) {
    return [roles.public.code]
  }
  const firstElement = rolesArray[0]
  if (typeof firstElement === 'string') {
    return rolesArray as string[]
  }
  if (typeof firstElement === 'object' && firstElement !== null && 'code' in firstElement) {
    return rolesArray.map((role: Role) => role.code)
  }
  return [roles.public.code]
}

export default async (req, reply) => {
  if (log.i) req.startedAt = new Date()

  req.data = () => getData(req)
  req.parameters = () => getParams(req)

  if (global.transferPath) {
    const url = req.url.split('?')[0]
    const isExact = url === global.transferPath
    const isSubPath = url.startsWith(global.transferPath + '/')

    if (isExact || isSubPath) {
      if (req.server['transferManager']) {
        const tm = req.server['transferManager'] as TransferManagement
        const isValidTransferRequest = tm.isImplemented() && (await tm.isValid(req))

        if (isValidTransferRequest) {
          req.roles = () => [roles.public.code]
          req.hasRole = () => true
          return
        }
      }
    }
  }

  const { embedded_auth = true } = global.config?.options || {}

  if (embedded_auth) {
    req.roles = () => [roles.public.code]
    req.hasRole = (r: Role) => req.roles().includes(r?.code)

    const cfg = req.routeOptions?.config || req.routeConfig || {}

    // Whose identity this route answers to (T-4.1).
    //
    // Only where the two planes actually differ: a deployment WITHOUT tenants has one
    // container and one identity space, so its control-scope routes (`/health`,
    // `/admin/manifest`) keep authenticating the application's own users, exactly as before.
    // Demanding a platform identity there would demand a system user the deployment never
    // creates. With tenants declared the split is real, and a control route answers to a
    // system user or to nobody.
    const controlIdentity = cfg.tenantContext === false && isTenancyEnabled()

    // Same reader as the tenant resolution that already ran (lib/util/bearer.ts): this hook
    // identifies the subject, that one decided the container, and both must be looking at
    // the same credential.
    const bearerToken = bearerTokenOf(req)

    if (bearerToken) {
      try {
        const tokenData = reply.server.jwt.verify(bearerToken)

        // No tenant check here. In v4 this was the anti-spoofing gate and it never fired:
        // it ran AFTER the tenant hook had already chosen the container from the header,
        // and it compared a `tid` against a field the user entity did not have (D-03).
        // In v5 the comparison happens before anything is opened, in lib/loader/tenant.ts,
        // so by this line `req.tenantInfo` is already the tenant the token proves. Checking
        // it twice would mean two answers to one question.

        // docs/AUTHORIZATION_V5.md §2.2, the other half of the gate: the tenant side is
        // refused during resolution, this is the control side. A token carrying `tid` on a
        // platform route is not "an admin who is admin enough", it is an identity from
        // another plane, and there is no path where it becomes one.
        if (controlIdentity && tokenData.scp !== 'control') {
          if (log.w) log.warn(`Security Block: a tenant token was presented on the control route ${req.url}`)
          return reply.status(403).send(httpError(403, 'A tenant token cannot act on the platform', 'SCOPE_MISMATCH'))
        }

        // MFA Gatekeeper Check
        if (tokenData.role === 'pre-auth-mfa') {
          const currentUrl = req.routeOptions.url || req.raw.url
          const isAllowed = MFA_SETUP_WHITELIST.some((url) => currentUrl.endsWith(url))

          if (!isAllowed) {
            if (log.w) log.warn(`Security Block: User attempted to access ${currentUrl} with pre-auth MFA token`)
            return reply
              .status(403)
              .send(httpError(403, 'MFA verification or setup required to access this resource', 'MFA_REQUIRED'))
          }
        }

        const subjectId = tokenData?.sub

        if (!subjectId) {
          throw new Error('Invalid token subject')
        }

        // An impersonated session is checked against the RECORD, not against the signature
        // (T-4.2, docs/AUTHORIZATION_V5.md §6). A JWT that is still cryptographically valid
        // is not a session that is still allowed: revoking must take effect now, not in
        // thirty minutes, or "revoke" is a word for "stop issuing new ones".
        if (tokenData.imp) {
          const im = req.server['impersonationManager']
          if (!im?.isImplemented?.()) {
            return reply.status(503).send(httpError(503, 'Impersonation is not available in this build', 'IMPERSONATION_NOT_AVAILABLE'))
          }

          // The lookup costs one control-plane read per impersonated request. That is the
          // price of a session that can actually be stopped, and impersonated traffic is
          // rare by construction.
          const session = await im.getImpersonation(req.control, tokenData.imp)
          if (!session) {
            if (log.w) log.warn(`Impersonation ${tokenData.imp} is revoked or expired: refusing ${req.method} ${req.url}`)
            return reply.status(403).send(httpError(403, 'This impersonation session is over', 'IMPERSONATION_ENDED'))
          }
          if (session.tenantId !== req.tenantInfo?.id) {
            return reply.status(403).send(httpError(403, 'This impersonation session belongs to another tenant', 'TENANT_MISMATCH'))
          }

          req.impersonation = session
          // Every request made under it is logged with the record id, so the trail is not
          // only "a session was opened" but "these are the things it did".
          if (log.i) log.info(`Impersonation ${session.id}: ${req.method} ${req.url}`)
        }

        // The platform's own identity, read from the control plane through its own manager:
        // a system user is not reachable from inside a container, and the compiler says so.
        if (controlIdentity) {
          const sm = req.server['systemUserManager']
          if (!sm?.isImplemented()) {
            return reply.status(503).send(httpError(503, 'Platform identities are not available in this build', 'SYSTEM_USERS_NOT_AVAILABLE'))
          }

          const systemUser = await sm.retrieveSystemUserByExternalId(req.control, subjectId)
          if (!systemUser) {
            return reply.status(404).send(httpError(404, 'Subject not found', 'SUBJECT_NOT_FOUND'))
          }
          if (systemUser.blocked) {
            return reply.status(403).send(httpError(403, 'User is not valid or blocked', 'USER_NOT_VALID'))
          }

          req.systemUser = systemUser
          const systemRoleCodes = normalizeRoles(systemUser.roles)
          req.roles = () => systemRoleCodes
          return finishRoleGate(req, reply, cfg)
        }

        let user: null | AuthenticatedUser = null
        let token: null | AuthenticatedToken = null

        if (req.server['userManager']?.isImplemented()) {
          user = await req.server['userManager'].retrieveUserByExternalId(dataContext(req), subjectId)
          if (user) {
            const isValid = await req.server['userManager'].isValidUser(user)
            if (!isValid) {
              return reply.status(403).send(httpError(403, 'User is not valid or blocked', 'USER_NOT_VALID'))
            }
            req.user = user
          }
        }

        if (!user && req.server['tokenManager']?.isImplemented()) {
          token = await req.server['tokenManager'].retrieveTokenByExternalId(dataContext(req), subjectId)
          if (token) {
            const isValid = await req.server['tokenManager'].isValidToken(token)
            if (!isValid) {
              return reply.status(403).send(httpError(403, 'Token is not valid or blocked', 'TOKEN_NOT_VALID'))
            }
            req.token = token
          }
        }

        if (!req.user && !req.token) {
          return reply.status(404).send(httpError(404, 'Subject not found', 'SUBJECT_NOT_FOUND'))
        }

        const freshNormalizedRoles = normalizeRoles(req.user?.roles || req.token?.roles)
        req.roles = () => freshNormalizedRoles
      } catch (error) {
        const isRoutePublic = (cfg.requiredRoles || []).some(
          (role: Role) => role.code === roles.public.code || role.code === SYSTEM_PUBLIC
        )
        if (!isRoutePublic) {
          return reply.status(401).send(httpError(401, (error as any)?.message || 'Invalid or expired token', 'UNAUTHORIZED'))
        }
      }
    }

    return finishRoleGate(req, reply, cfg)
  }
}

/**
 * The role intersection, in one place so both identity paths end the same way.
 *
 * Extracted in T-4.1 rather than duplicated: a control-scope request resolves a different
 * subject from a different plane, but the question asked of it, "do your roles intersect
 * what this route requires", must not be a second implementation that can drift.
 */
function finishRoleGate(req, reply, cfg) {
  if (!(cfg.requiredRoles?.length > 0)) return

  const { method = '', url = '', requiredRoles } = cfg
  const authorizedRoles: string[] = req.roles()
  // A route open to `public` is open to EVERY caller: anonymous requests already pass (they
  // carry the `public` role), and an authenticated subject must never rank below anonymous.
  // Without this, a user whose roles don't include `public` (e.g. only a custom consumer
  // role) would get 403 on public routes such as /users/me or /auth/change-password.
  // A control route never carries `public`, so this branch simply never fires there.
  // `system:public` is the control plane's own spelling of the same thing: a route that has
  // to answer before anyone is authenticated (T-4.1). Two codes because there are two
  // catalogues, and one list that reads both because the question is the same.
  const isPublicRoute = requiredRoles.some((r) => r.code === roles.public.code || r.code === SYSTEM_PUBLIC)
  const hasPermission = isPublicRoute || requiredRoles.some((r) => authorizedRoles.includes(r.code))

  if (!hasPermission) {
    // 401 when there is no authenticated subject (must log in first); 403 when authenticated
    // but lacking the required role.
    const anonymous = !req.user && !req.token && !req.systemUser
    const who = req.systemUser?.email || req.user?.email || 'anonymous'
    if (log.w) log.warn(`Denied: ${who} cannot call ${method.toUpperCase()} ${url}`)
    return anonymous
      ? reply.status(401).send(httpError(401, 'Authentication required', 'UNAUTHORIZED'))
      : reply.status(403).send(httpError(403, 'Authorization denied', 'FORBIDDEN'))
  }
}
