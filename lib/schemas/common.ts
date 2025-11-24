export const getQueryParamsSchema = {
  $id: 'getQueryParamsSchema',
  type: 'object',
  nullable: true,
  properties: {
    page: {
      type: 'number',
      description: 'Page **number** (default 1)'
    },
    pageSize: {
      type: 'number',
      description: 'Page **size** (default 25)'
    },
    sort: {
      type: 'array',
      description:
        'Sorting **order** (default ascending).<br/>\
        Otherwise, use the postfix `:desc` or `:asc` (like `&sort=myfield:desc`)',
      items: { type: 'string' }
    }
  }
}

export const onlyIdSchema = {
  $id: 'onlyIdSchema',
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string', description: 'Entity id' }
  },
  required: ['id']
}

export const onlyCodeSchema = {
  $id: 'onlyCodeSchema',
  type: 'object',
  nullable: true,
  properties: {
    code: { type: 'string', description: 'Code' }
  },
  required: ['code']
}

export const onlyPasswordSchema = {
  $id: 'onlyPasswordSchema',
  type: 'object',
  nullable: true,
  properties: {
    password: { type: 'string', description: 'Password' }
  },
  required: ['password']
}

export const blockBodySchema = {
  $id: 'blockBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    reason: { type: 'string', description: 'Reason' }
  }
}

export const defaultResponse = {
  $id: 'defaultResponse',
  type: 'object',
  description: 'Default response',
  nullable: true,
  properties: {
    ok: { type: 'boolean' }
  }
}
