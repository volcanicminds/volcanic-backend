import { getParams, getData } from '../util/common'
import { AuthenticatedUser, Role } from '../../types/global'

module.exports = async (req, reply) => {
  // request enrichment
  log.i && (req.startedAt = new Date())
  req.data = () => getData(req)
  req.parameters = () => getParams(req)
  req.roles = () => ((req.user && req.user.roles) || []).map((role: Role) => role?.code) || []
  req.hasRole = (r: Role) => ((req.user && req.user.roles) || []).some((role: Role) => role?.code === r?.code)

  // authorization check
  const auth = req.headers?.authorization || ''
  const [prefix, token] = auth.split(' ')
  if (prefix === 'Bearer' && token != null) {
    const { sub: userId, name, iat, exp } = reply.server.jwt.verify(token)

    //TODO: demo
    if (global.npmDebugServerStarted) {
      req.user = {
        id: userId || 123,
        name: name,
        email: 'jerry@george.com',
        password: 'seinfeld',
        // roles: [roles.admin, roles.public]
        roles: [roles.public]
      } as AuthenticatedUser

      log.debug('Inject demo user ' + req.user.id)
    }

    //TODO: recall plugin UserManagement for find user or error

    if (req.routeConfig.requiredRoles?.length > 0) {
      const { method, url, requiredRoles } = req.routeConfig
      const userRoles: string[] = req.user?.roles?.map(({ code }) => code) || []
      const resolvedRoles = userRoles.length > 0 ? requiredRoles.filter((r) => userRoles.includes(r.code)) : []

      if (!resolvedRoles.length) {
        log.w && log.warn(`Not allowed to call ${method.toUpperCase()} ${url}`)
        return reply
          .code(403)
          .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to call this route' })
      }
    }
  }
}
