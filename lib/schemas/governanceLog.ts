//
// The governance log as it leaves the server (F76): the columns of the table and nothing else, like
// the access log's. A column added later does not reach a client until it is written here.
//
export const governanceLogSchema = {
  $id: 'governanceLogSchema',
  type: 'object',
  properties: {
    id: { type: 'string' },
    occurredAt: { type: 'string', format: 'date-time' },
    action: { type: 'string' },
    outcome: { type: 'string', enum: ['success', 'intent', 'failure'] },
    intentId: { type: 'string', nullable: true },
    actorId: { type: 'string', nullable: true },
    tenantId: { type: 'string', nullable: true },
    targetId: { type: 'string', nullable: true },
    detail: { type: 'object', nullable: true, additionalProperties: true },
    requestId: { type: 'string', nullable: true },
    ip: { type: 'string', nullable: true }
  }
}
