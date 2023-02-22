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

export const blockBodySchema = {
  $id: 'blockBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    reason: { type: 'string' }
  }
}
