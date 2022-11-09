import { getParams, getData } from '../util/common'

module.exports = async (req, reply) => {
  req.start = new Date()
  req.data = () => getData(req)
  req.pars = () => getParams(req)
  if (req.user) {
    req.user.getRoles = () => req.user?.roles?.map(({ code }) => code) || []
  }

  // demo
  if (global.npmDebugServerStarted) {
    req.user = {
      id: 123,
      name: 'Jerry',
      roles: [roles.admin, roles.public, roles.mechanic]
    }
    log.debug('Inject demo user ' + JSON.stringify(req.user))
  }
}
