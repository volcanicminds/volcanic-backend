//
// The administrators' notices as they leave the server, and the marks a reader sends back. A notice
// carries no text: the console composes it from `notice.<source>.<kind>` and `data`.
//
export const noticeListSchema = {
  $id: 'noticeListSchema',
  type: 'object',
  required: ['notices', 'failed'],
  properties: {
    notices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['source', 'id', 'kind', 'level', 'seen'],
        properties: {
          source: { type: 'string' },
          // `<source>:<id>`, the value `POST .../seen` takes back.
          id: { type: 'string' },
          kind: { type: 'string' },
          level: { type: 'string', enum: ['info', 'warning'] },
          at: { type: 'string', format: 'date-time' },
          data: { type: 'object', additionalProperties: true },
          seen: { type: 'boolean' }
        }
      }
    },
    // The sources that could not answer: their notices are missing, not cleared.
    failed: { type: 'array', items: { type: 'string' } }
  }
}

export const noticeSeenBodySchema = {
  $id: 'noticeSeenBodySchema',
  type: 'object',
  required: ['ids'],
  additionalProperties: false,
  properties: {
    ids: {
      type: 'array',
      minItems: 1,
      maxItems: 100,
      items: { type: 'string', maxLength: 512, pattern: '^[A-Za-z0-9_-]+:.+$' }
    }
  }
}
