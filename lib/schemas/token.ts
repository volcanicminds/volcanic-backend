export const tokenCreateBodySchema = {
  $id: 'tokenCreateBodySchema',
  type: 'object',
  required: ['name', 'expiresAt'],
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    // `null` for a token that never expires: a machine credential without an expiry is a choice
    // the caller writes down, not a field it forgot (docs/API_V5.md §4).
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    requiredRoles: { type: 'array', items: { type: 'string' } }
  }
}

export const tokenUpdateBodySchema = {
  $id: 'tokenUpdateBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' }
  }
}

export const tokenSchema = {
  $id: 'tokenSchema',
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    _id: { type: 'string' },
    externalId: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time', nullable: true },
    roles: { type: 'array', items: { type: 'string' } }
  }
}

// The answer to a creation, and only to it: the bearer is not stored, so no other route can
// return it.
export const tokenCreatedSchema = {
  $id: 'tokenCreatedSchema',
  type: 'object',
  properties: {
    ...tokenSchema.properties,
    token: { type: 'string' }
  }
}
