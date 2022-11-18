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

  // 1. verificare se public è presente
  // 2. se è presente il JWT non è mandante quindi se c'è completa utente altrimenti va comunque avanti
  // 3. se utente è presente allora richiama UserManagerment find e completa oggetto
  // 4. se utente specificato ma inesistente da errore anche se c'è ruolo public

  const isRoutePublic = (req.routeConfig.requiredRoles || []).some((role: Role) => role.code === roles.public.code)

  if (prefix === 'Bearer' && token != null) {
    const user: AuthenticatedUser = {} as AuthenticatedUser
    try {
      const tokenData = reply.server.jwt.verify(token)
      user.id = tokenData.sub
      user.name = tokenData.name
      user.email = tokenData.email

      if (global.npmDebugServerStarted) {
        user.id = user.id || 123
        user.name = user.name || 'Jerry Seinfeld'
        user.email = user.email || 'jerry@george.com'
        user.roles = [roles.public, roles.backoffice]
        log.debug('Inject demo user ' + user.id)
      }

      // ok, we have the full user here
      req.user = user
    } catch (error) {
      if (!isRoutePublic) {
        throw error
      }
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
