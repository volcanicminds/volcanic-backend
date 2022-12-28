import { getParams, getData } from '../util/common'
import { AuthenticatedUser, Role } from '../../types/global'

module.exports = async (req, reply) => {
  // request enrichment
  log.i && (req.startedAt = new Date())
  req.data = () => getData(req)
  req.parameters = () => getParams(req)
  req.roles = () => (req.user ? req.user.roles : [roles.public])
  req.hasRole = (r: Role) => (req.user ? req.user.roles : [roles.public]).some((role) => role === r?.code)

  // authorization check
  const auth = req.headers?.authorization || ''
  const [prefix, token] = auth.split(' ')
  const isRoutePublic = (req.routeConfig.requiredRoles || []).some((role: Role) => role.code === roles.public.code)

  if (prefix === 'Bearer' && token != null) {
    let user: AuthenticatedUser = {} as AuthenticatedUser
    try {
      const tokenData = reply.server.jwt.verify(token)
      user = await req.server['userManager'].retrieveUserByExternalId(tokenData?.sub)
      if (!user) {
        return reply.status(404).send({ statusCode: 404, code: 'USER_NOT_FOUND', message: 'User not found' })
      }
      const isValid = await req.server['userManager'].isValidUser(user)
      if (!isValid) {
        return reply.status(404).send({ statusCode: 404, code: 'USER_NOT_VALID', message: 'User not valid' })
      }

      // ok, we have the full user here
      req.user = user
    } catch (error) {
      if (!isRoutePublic) {
        throw error
      }
    }
  }

  if (req.routeConfig.requiredRoles?.length > 0) {
    const { method = '', url = '', requiredRoles } = req.routeConfig
    const userRoles: string[] = req.user?.roles?.map((code) => code) || [roles.public?.code || 'public']
    const resolvedRoles = userRoles.length > 0 ? requiredRoles.filter((r) => userRoles.includes(r.code)) : []

    if (!resolvedRoles.length) {
      log.w && log.warn(`Not allowed to call ${method.toUpperCase()} ${url}`)
      return reply
        .status(403)
        .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to call this route' })
    }
  }
}
