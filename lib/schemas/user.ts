export const currentUserBodySchema = {
  $id: 'currentUserBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    username: { type: 'string' }
  }
}

export const userBodySchema = {
  $id: 'userBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    username: { type: 'string' },
    email: { type: 'string' },
    blocked: { type: 'boolean' },
    blockedReason: { type: 'string' },
    blockedAt: { type: 'string' },
    confirmed: { type: 'boolean' },
    confirmedAt: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } }
  }
}

export const userSchema = {
  $id: 'userSchema',
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    externalId: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    blocked: { type: 'boolean' },
    blockedReason: { type: 'string' },
    blockedAt: { type: 'string' },
    confirmed: { type: 'boolean' },
    confirmedAt: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } },
    createdAt: { type: 'string' },
    version: { type: 'number' },
    updatedAt: { type: 'string' }
  }
}

export const isAdminSchema = {
  $id: 'isAdminSchema',
  type: 'object',
  nullable: true,
  properties: {
    isAdmin: { type: 'boolean' }
  }
}

export const roleSchema = {
  $id: 'roleSchema',
  type: 'object',
  nullable: true,
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' }
  }
}
