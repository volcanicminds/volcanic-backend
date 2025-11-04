export const globalRemoveManySchema = {
  $id: 'globalRemoveManySchema',
  type: 'object',
  nullable: false,
  required: ['ids'],
  properties: {
    ids: { type: 'array', items: { type: 'string' }, minItems: 1 }
  }
}

export const globalParamsSchema = {
  $id: 'globalParamsSchema',
  type: 'object',
  nullable: false,
  required: ['id'],
  properties: {
    id: {
      type: 'string',
      description: 'Id',
      minLength: 1
    }
  }
}
