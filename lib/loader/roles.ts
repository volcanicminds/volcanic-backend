import { Role, Roles } from '../../types/global'
// import { roles as configRoles } from '../config/roles'

const glob = require('glob')
// const path = require('path')

export function load() {
  const roles: Roles = {}

  const patterns = [`${__dirname}/../config/roles.{ts,js}`, `${process.cwd()}/src/config/roles.{ts,js}`]
  patterns.forEach((pattern) => {
    log.d && log.debug('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const configRoles = require(f)

      configRoles.forEach((role: Role) => {
        roles[role.code] = role
      })
    })
  })
  log.i && log.info('Roles loaded: ' + Object.keys(roles).join(', '))
  return roles
}
