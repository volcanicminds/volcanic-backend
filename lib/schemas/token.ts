export const tokenCreateBodySchema = {
  $id: 'tokenCreateBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    expiresIn: { type: 'string', default: undefined },
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
    token: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } }
  }
}
