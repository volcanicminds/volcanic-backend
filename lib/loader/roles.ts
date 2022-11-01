import { roles as configRoles } from '../config/roles'

export function load() {
  const roles: {
    [key in RoleKey]?: Role
  } = {}

  configRoles.forEach((role) => {
    roles[role.code as RoleKey] = role
  })

  return { ...roles } as Roles
}
