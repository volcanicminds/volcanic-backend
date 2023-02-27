export const tokenBodySchema = {
  $id: 'tokenBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    requiredRoles: { type: 'array', items: { type: 'string' } }
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
