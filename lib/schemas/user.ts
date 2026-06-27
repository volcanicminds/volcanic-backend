export const currentUserBodySchema = {
  $id: 'currentUserBodySchema',
  type: 'object',
  nullable: true,
  // Self-service profile edit only. `additionalProperties: false` rejects any other
  // field (roles, blocked, confirmed, password, externalId, mfa*) so a user cannot
  // mass-assign their way to privilege escalation. The controller also whitelists
  // these same fields as the real security boundary (defense in depth).
  additionalProperties: false,
  properties: {
    username: { type: 'string' },
    firstName: { type: 'string' },
    lastName: { type: 'string' }
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
    updatedAt: { type: 'string' },
    mfaEnabled: { type: 'boolean' }
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
