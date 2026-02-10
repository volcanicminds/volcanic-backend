/* eslint-disable @typescript-eslint/no-explicit-any */
import { getParams, getData } from '../util/common.js'
import type { AuthenticatedUser, AuthenticatedToken, Role, TransferManagement } from '../../types/global.js'

const { embedded_auth = true } = global.config?.options || {}

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

  const { multi_tenant } = global.config?.options || {}

  if (multi_tenant?.enabled) {
    let tenantSlug: string | undefined

    if (multi_tenant.resolver === 'subdomain') {
      const host = req.headers.host || ''
      const parts = host.split('.')
      if (parts.length >= 2) {
        // FIXME: Improve subdomain extraction strategy. Currently assumes [slug].[domain].[tld] or [slug].localhost
        if (parts[0] !== 'www') {
          tenantSlug = parts[0]
        }
      }
    } else if (multi_tenant.resolver === 'header') {
      tenantSlug = req.headers[multi_tenant?.header_key || 'x-tenant-id'] as string
    } else if (multi_tenant.resolver === 'query') {
      tenantSlug = (req.query as any)[multi_tenant?.query_key || 'tid']
    }

    if (!tenantSlug) {
      return reply.code(400).send({ statusCode: 400, error: 'Tenant ID missing', message: 'Tenant ID is required' })
    }

    if (!global.repository?.tenants) {
      log.error('Multi-tenant enabled but global.repository.tenants not found')
      return reply.code(500).send({ statusCode: 500, error: 'Internal Server Error' })
    }

    const tenant = await global.repository.tenants.findOneBy({ slug: tenantSlug })

    if (!tenant) {
      return reply
        .code(404)
        .send({ statusCode: 404, error: 'Tenant Not Found', message: `Tenant '${tenantSlug}' not found` })
    }

    if (tenant.status !== 'active') {
      return reply.code(403).send({ statusCode: 403, error: 'Tenant Inactive', message: 'Tenant is not active' })
    }

    // Tenant Context Setup
    const runner = global.connection.createQueryRunner()
    await runner.connect()

    // Validate schema name safety
    if (!/^[a-z0-9_]+$/i.test(tenant.schema)) {
      await runner.release()
      return reply.code(400).send({ statusCode: 400, error: 'Invalid Schema Name' })
    }

    await runner.query(`SET search_path TO "${tenant.schema}", "public"`)

    req.runner = runner
    req.tenant = tenant
  }

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

  if (embedded_auth) {
    req.roles = () => [roles.public.code]
    req.hasRole = (r: Role) => req.roles().includes(r?.code)

    const cfg = req.routeOptions?.config || req.routeConfig || {}
    const AUTH_MODE = process.env.AUTH_MODE || 'BEARER'

    let bearerToken: string | undefined

    if (AUTH_MODE === 'COOKIE') {
      const cookieToken = req.cookies['auth_token']
      if (cookieToken) {
        const unsigned = req.unsignCookie(cookieToken)
        if (unsigned.valid && unsigned.value) {
          bearerToken = unsigned.value
        }
      }
    } else {
      const auth = req.headers?.authorization || ''
      const [prefix, token] = auth.split(' ')
      if (prefix === 'Bearer' && token != null) {
        bearerToken = token
      }
    }

    if (bearerToken) {
      try {
        const tokenData = reply.server.jwt.verify(bearerToken)

        // Validate Tenant Access
        const { multi_tenant } = global.config?.options || {}
        if (multi_tenant?.enabled && req.tenant && tokenData.tid) {
          if (tokenData.tid !== req.tenant.id) {
            return reply.status(403).send({
              statusCode: 403,
              code: 'TENANT_MISMATCH',
              message: 'Token does not belong to this tenant'
            })
          }
        }

        // MFA Gatekeeper Check
        if (tokenData.role === 'pre-auth-mfa') {
          const currentUrl = req.routeOptions.url || req.raw.url
          const isAllowed = MFA_SETUP_WHITELIST.some((url) => currentUrl.endsWith(url))

          if (!isAllowed) {
            if (log.w) log.warn(`Security Block: User attempted to access ${currentUrl} with pre-auth MFA token`)
            return reply.status(403).send({
              statusCode: 403,
              code: 'MFA_REQUIRED',
              message: 'MFA verification or setup required to access this resource'
            })
          }
        }

        const subjectId = tokenData?.sub

        if (!subjectId) {
          throw new Error('Invalid token subject')
        }

        let user: null | AuthenticatedUser = null
        let token: null | AuthenticatedToken = null

        if (req.server['userManager']?.isImplemented()) {
          user = await req.server['userManager'].retrieveUserByExternalId(subjectId)
          if (user) {
            const isValid = await req.server['userManager'].isValidUser(user)
            if (!isValid) {
              return reply
                .status(403)
                .send({ statusCode: 403, code: 'USER_NOT_VALID', message: 'User is not valid or blocked' })
            }
            req.user = user
          }
        }

        if (!user && req.server['tokenManager']?.isImplemented()) {
          token = await req.server['tokenManager'].retrieveTokenByExternalId(subjectId)
          if (token) {
            const isValid = await req.server['tokenManager'].isValidToken(token)
            if (!isValid) {
              return reply
                .status(403)
                .send({ statusCode: 403, code: 'TOKEN_NOT_VALID', message: 'Token is not valid or blocked' })
            }
            req.token = token
          }
        }

        if (!req.user && !req.token) {
          return reply.status(404).send({ statusCode: 404, code: 'SUBJECT_NOT_FOUND', message: 'Subject not found' })
        }

        const freshNormalizedRoles = normalizeRoles(req.user?.roles || req.token?.roles)
        req.roles = () => freshNormalizedRoles
      } catch (error) {
        const isRoutePublic = (cfg.requiredRoles || []).some((role: Role) => role.code === roles.public.code)
        if (!isRoutePublic) {
          return reply.status(401).send({
            statusCode: 401,
            code: 'UNAUTHORIZED',
            message: (error as any)?.message || 'Invalid or expired token'
          })
        }
      }
    }

    if (cfg.requiredRoles?.length > 0) {
      const { method = '', url = '', requiredRoles } = cfg
      const authorizedRoles: string[] = req.roles()
      const hasPermission = requiredRoles.some((r) => authorizedRoles.includes(r.code))

      if (!hasPermission) {
        if (log.w) log.warn(`Forbidden: ${req.user?.email || 'anonymous'} cannot call ${method.toUpperCase()} ${url}`)
        return reply.status(403).send({ statusCode: 403, code: 'FORBIDDEN', message: 'Authorization denied' })
      }
    }
  }
}


