//
// The access log as it leaves the server (F44): the columns of the table and nothing else. The
// serializer drops what the schema does not name, so a column added later does not reach a client
// until it is written here on purpose.
//
export const accessLogSchema = {
  $id: 'accessLogSchema',
  type: 'object',
  properties: {
    id: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    scope: { type: 'string', enum: ['tenant', 'control'] },
    event: { type: 'string' },
    outcome: { type: 'string', enum: ['success', 'failure'] },
    code: { type: 'string', nullable: true },
    subjectId: { type: 'string', nullable: true },
    methods: { type: 'array', items: { type: 'string' }, nullable: true },
    provider: { type: 'string', nullable: true },
    flowId: { type: 'string', nullable: true },
    sid: { type: 'string', nullable: true },
    ip: { type: 'string', nullable: true }
  }
}
