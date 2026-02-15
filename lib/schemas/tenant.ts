export const tenantBodySchema = {
  $id: 'tenantBodySchema',
  type: 'object',
  required: ['name', 'slug', 'dbSchema'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    slug: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-z0-9_-]+$'
    },
    dbSchema: { type: 'string', minLength: 1, maxLength: 63 },
    config: { type: 'object', additionalProperties: true }
  }
}

export const tenantUpdateBodySchema = {
  $id: 'tenantUpdateBodySchema',
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    status: { type: 'string', enum: ['active', 'suspended', 'archived'] },
    config: { type: 'object' }
  }
}

export const tenantResponseSchema = {
  $id: 'tenantResponseSchema',
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    name: { type: 'string' },
    slug: { type: 'string' },
    dbSchema: { type: 'string' },
    status: { type: 'string', enum: ['active', 'suspended', 'archived'] },
    config: { type: 'object' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
}

export const tenantListResponseSchema = {
  $id: 'tenantListResponseSchema',
  type: 'array',
  items: { $ref: 'tenantResponseSchema#' }
}
