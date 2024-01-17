import { getParams, getData } from '../util/common'
import { AuthenticatedUser, AuthenticatedToken, Role } from '../../types/global'

module.exports = async (req, reply) => {
  // request enrichment
  log.i && (req.startedAt = new Date())
  req.data = () => getData(req)
  req.parameters = () => getParams(req)
  req.roles = () => (req.user ? req.user.roles : [roles.public])
  req.hasRole = (r: Role) => (req.user ? req.user.roles : [roles.public]).some((role) => role === r?.code)

  // authorization check
  const auth = req.headers?.authorization || ''
  const cfg = req.routeOptions?.config || req.routeConfig || {}
  const [prefix, bearerToken] = auth.split(' ')
  const isRoutePublic = (cfg.requiredRoles || []).some((role: Role) => role.code === roles.public.code)

  if (prefix === 'Bearer' && bearerToken != null) {
    let user: null | AuthenticatedUser = null
    let token: null | AuthenticatedToken = null

    try {
      const tokenData = reply.server.jwt.verify(bearerToken)
      user = await req.server['userManager'].retrieveUserByExternalId(tokenData?.sub)
      if (!user && req.server['tokenManager'].isImplemented()) {
        token = await req.server['tokenManager'].retrieveTokenByExternalId(tokenData?.sub)
      }
      if (!user && !token) {
        return reply.status(404).send({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found' })
      }
      if (user) {
        const isValid = await req.server['userManager'].isValidUser(user)
        if (!isValid) {
          return reply.status(404).send({ statusCode: 404, code: 'USER_NOT_VALID', message: 'User not valid' })
        }
        // ok, we have the full user here
        req.user = user
      }
      if (token) {
        const isValid = await req.server['tokenManager'].isValidToken(token)
        if (!isValid) {
          return reply.status(404).send({ statusCode: 404, code: 'TOKEN_NOT_VALID', message: 'Token not valid' })
        }
        // ok, we have the full user here
        req.token = token
      }
    } catch (error) {
      if (!isRoutePublic) {
        throw error
      }
    }
  }

  if (cfg.requiredRoles?.length > 0) {
    const { method = '', url = '', requiredRoles } = cfg
    const authRoles: string[] = ((req.user?.roles || req.token?.roles)?.map((code) => code) as string[]) || [
      roles.public?.code || 'public'
    ]
    const resolvedRoles = authRoles.length > 0 ? requiredRoles.filter((r) => authRoles.includes(r.code)) : []

    if (!resolvedRoles.length) {
      log.w && log.warn(`Not allowed to call ${method.toUpperCase()} ${url}`)
      return reply
        .status(403)
        .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to call this route' })
    }
  }
}
