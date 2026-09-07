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
    // S12: constrain to a safe SQL identifier alphabet. The name is printed into every
    // statement built for the container (T-3.1), so it is validated at the edge and again
    // before it becomes a cache key. maxLength 63 = Postgres identifier limit.
    dbSchema: { type: 'string', minLength: 1, maxLength: 63, pattern: '^[a-zA-Z0-9_]+$' },
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
