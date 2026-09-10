//
// A consuming project's schemas, for the loader tests.
//
// `onlyIdSchema` deliberately reuses a framework `$id`: that is the override path, and what it
// must do is DEEP MERGE — keep the framework's properties, add its own, and union the
// `required` lists rather than replacing them.
//
export const onlyIdSchema = {
  $id: 'onlyIdSchema',
  type: 'object',
  required: ['tenantSlug'],
  properties: {
    tenantSlug: { type: 'string' }
  }
}

export const consumerOwnSchema = {
  $id: 'consumerOwnSchema',
  type: 'object',
  properties: { anything: { type: 'string' } }
}

// No `$id`: unreferenceable, so the loader must skip it rather than register something a
// `$ref` can never reach.
export const namelessSchema = {
  type: 'object',
  properties: { orphan: { type: 'string' } }
}
