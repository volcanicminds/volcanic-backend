import { getParams, getData } from '../util/common'
import { Role } from '../../types/global'

module.exports = async (req, reply) => {
  // request enrichment
  log.i && (req.startedAt = new Date())
  req.data = () => getData(req)
  req.pars = () => getParams(req)

  // authorization
  const auth = req.headers?.authorization || ''
  const [prefix, token] = auth.split(' ')
  if (prefix === 'Bearer' && token != null) {
    const { sub: userId, name, iat, exp } = reply.server.jwt.verify(token)

    // demo
    if (global.npmDebugServerStarted) {
      req.user = {
        id: userId || 123,
        name: 'Jerry',
        email: 'jerry@george.com',
        password: 'pippolippo',
        // roles: [roles.admin, roles.public]
        roles: [roles.public]
      }
      log.debug('Inject demo user ' + req.user.id)
    }

    if (req.routeConfig.requiredRoles?.length > 0) {
      const { method, url, requiredRoles } = req.routeConfig
      const userRoles: string[] = req.user?.roles?.map(({ code }) => code) || []
      const resolvedRole = userRoles.length > 0 ? requiredRoles.filter((r) => userRoles.includes(r.code)) : []

      if (!resolvedRole.length) {
        log.w && log.warn(`Not allowed to call ${method.toUpperCase()} ${url}`)
        return reply
          .code(403)
          .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to call this route' })
      }
    }

    // recall UserManager find / enrichment
    if (req.user) {
      req.user.getRoles = () => (req.user.roles || []).map((role: Role) => role?.code) || []
      req.user.hasRole = (r: Role) => (req.user.roles || []).some((role: Role) => role?.code === r?.code)
    }
  }
}
