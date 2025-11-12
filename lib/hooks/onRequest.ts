import { getParams, getData } from '../util/common'
import { AuthenticatedUser, AuthenticatedToken, Role } from '../../types/global'

const { embedded_auth = true } = global.config?.options || {}

const normalizeRoles = (rolesArray: any[] | undefined): string[] => {
  if (!rolesArray || rolesArray.length === 0) {
    return [roles.public.code]
  }

  // Check the type of the first element to determine the array's structure
  const firstElement = rolesArray[0]
  if (typeof firstElement === 'string') {
    return rolesArray as string[]
  }

  if (typeof firstElement === 'object' && firstElement !== null && 'code' in firstElement) {
    return rolesArray.map((role: Role) => role.code)
  }

  // Fallback for unexpected formats
  return [roles.public.code]
}

module.exports = async (req, reply) => {
  log.i && (req.startedAt = new Date())

  // Request enrichment
  req.data = () => getData(req)
  req.parameters = () => getParams(req)

  if (embedded_auth) {
    // Initialize role helpers with a default 'public' role
    req.roles = () => [roles.public.code]
    req.hasRole = (r: Role) => req.roles().includes(r?.code)

    const auth = req.headers?.authorization || ''
    const cfg = req.routeOptions?.config || req.routeConfig || {}
    const [prefix, bearerToken] = auth.split(' ')

    if (prefix === 'Bearer' && bearerToken != null) {
      try {
        const tokenData = reply.server.jwt.verify(bearerToken)
        const subjectId = tokenData?.sub

        if (!subjectId) {
          throw new Error('Invalid token subject')
        }

        let user: null | AuthenticatedUser = null
        let token: null | AuthenticatedToken = null

        // Attempt to retrieve user only if userManager is implemented
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

        // Attempt to retrieve token if user was not found and tokenManager is implemented
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

        // Re-normalize roles now that req.user or req.token is populated
        const freshNormalizedRoles = normalizeRoles(req.user?.roles || req.token?.roles)
        req.roles = () => freshNormalizedRoles
      } catch (error) {
        const isRoutePublic = (cfg.requiredRoles || []).some((role: Role) => role.code === roles.public.code)
        if (!isRoutePublic) {
          return reply
            .status(401)
            .send({ statusCode: 401, code: 'UNAUTHORIZED', message: error.message || 'Invalid or expired token' })
        }
      }
    }

    // Role-Based Access Control (RBAC) check
    if (cfg.requiredRoles?.length > 0) {
      const { method = '', url = '', requiredRoles } = cfg
      const authorizedRoles: string[] = req.roles()

      const hasPermission = requiredRoles.some((r) => authorizedRoles.includes(r.code))

      if (!hasPermission) {
        log.w && log.warn(`Forbidden: ${req.user?.email || 'anonymous'} cannot call ${method.toUpperCase()} ${url}`)
        return reply.status(403).send({ statusCode: 403, code: 'FORBIDDEN', message: 'Authorization denied' })
      }
    }
  }
}
