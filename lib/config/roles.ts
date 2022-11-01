export {}

// additional roles
declare global {
  enum RoleKey {}
  // customer = 'customer'
}

export const roles: Role[] = [
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
