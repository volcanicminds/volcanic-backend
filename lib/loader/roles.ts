export const configRoles: Role[] = [
  {
    code: 'public',
    name: 'Public',
    description: 'Public role'
  },
  {
    code: 'admin',
    name: 'Admin',
    description: 'Admin role'
  },
  {
    code: 'backoffice',
    name: 'Backoffice',
    description: 'Backoffice role'
  }
]

export function load() {
  const roles: {
    [key in RoleKey]?: Role
  } = {}

  configRoles.forEach((role) => {
    roles[role.code as RoleKey] = role
  })

  return { ...roles } as Roles
}
