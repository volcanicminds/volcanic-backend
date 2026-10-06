/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-15.2, the writer of the governance log (F76) and its reading route, without a database: what
// `governed`, `intend` and `settle` take from the request, what they write and when they write
// nothing. The transaction itself is held on a real control plane in test/db/governanceLog.spec.ts,
// every route over HTTP in test/e2e-mt-pg/governanceLog.e2e.spec.ts.
//
import { expect } from 'expect'
import { failureOf, fieldNames, governed, intend, settle } from '../../lib/util/governance.js'
import * as systemGovernanceLog from '../../lib/api/system/controller/systemGovernanceLog.js'
import { fakeGovernanceLog } from './fixtures/governanceLog.js'

;(global as any).log = {}

const request = (governance: any = fakeGovernanceLog()) =>
  ({
    server: { governanceLogManager: governance },
    control: { kind: 'control' },
    systemUser: { id: 'op-1' },
    ip: '203.0.113.77',
    id: 42,
    data: () => ({ tenantId: 'id-acme' })
  }) as any

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e: any) {
    return { status: e.statusCode, code: e.code }
  }
  return null
}

function fakeReply() {
  const reply: any = { sent: null, statusCode: 200, h: {} }
  reply.status = (code: number) => ((reply.statusCode = code), reply)
  reply.type = () => reply
  reply.headers = (h: any) => ((reply.h = h), reply)
  reply.send = (body: any) => ((reply.sent = body), reply)
  return reply
}

describe('governance · the writer (F76, T-15.2)', () => {
  it('answers 503 GOVERNANCE_LOG_NOT_AVAILABLE, and runs nothing, without a manager or a control plane', async () => {
    let ran = false
    const change = async () => ((ran = true), true)
    const event = () => ({ action: 'tenant.deleted' as const })
    for (const req of [
      { ...request(), server: {} },
      { ...request(), server: { governanceLogManager: { isImplemented: () => false } } },
      { ...request(), control: undefined }
    ]) {
      expect(await codeOf(governed(req, change, event))).toEqual({ status: 503, code: 'GOVERNANCE_LOG_NOT_AVAILABLE' })
      expect(await codeOf(intend(req, event()))).toEqual({ status: 503, code: 'GOVERNANCE_LOG_NOT_AVAILABLE' })
    }
    expect(ran).toBe(false)
  })

  it('takes the operator, the address and the request id from the request, never from the route', async () => {
    const governance = fakeGovernanceLog()
    await governed(request(governance), async () => ({ id: 't-1' }), (row) => ({ action: 'tenant.created', tenantId: row.id, actorId: 'forged' } as any))
    expect(governance.rows[0]).toMatchObject({ outcome: 'success', tenantId: 't-1', actorId: 'op-1', ip: '203.0.113.77', requestId: '42', intentId: null })
  })

  it('writes nothing when the change says nothing changed, and drops the event of a change that throws', async () => {
    const governance = fakeGovernanceLog()
    await governed(request(governance), async () => false, (changed) => (changed ? { action: 'system_user.blocked' } : null))
    const failing = governed(
      request(governance),
      async () => {
        throw Object.assign(new Error('no'), { code: 'BOOM' })
      },
      () => ({ action: 'system_user.blocked' })
    )
    expect(await codeOf(failing)).toEqual({ status: undefined, code: 'BOOM' })
    expect(governance.rows).toEqual([])
  })

  it('closes an intent with its id, and a lost outcome is a log line, never an error', async () => {
    const governance = fakeGovernanceLog()
    const req = request(governance)
    const intent = await intend(req, { action: 'tenant.exported', tenantId: 'id-acme' })
    await settle(req, intent, 'success', { action: 'tenant.exported', tenantId: 'id-acme' })
    expect(governance.rows.map((r) => [r.outcome, r.intentId])).toEqual([
      ['intent', null],
      ['success', intent]
    ])

    governance.record = async () => {
      throw new Error('the control plane is gone')
    }
    await settle(req, intent, 'failure', { action: 'tenant.exported' })
  })

  it('names the fields of a patch, one level into config, and never a value', () => {
    expect(fieldNames({ name: 'Acme', status: undefined, config: { mfa_policy: 'MANDATORY', theme: 'dark' } })).toEqual([
      'config.mfa_policy',
      'config.theme',
      'name'
    ])
    expect(fieldNames({ config: {} })).toEqual(['config'])
    expect(fieldNames(null)).toEqual([])
  })

  it('keeps a code or an error class of a failure, not its message', () => {
    expect(failureOf(Object.assign(new Error('postgres://user:pw@host'), { code: 'ECONNREFUSED' }))).toBe('ECONNREFUSED')
    expect(failureOf(new TypeError('postgres://user:pw@host'))).toBe('TypeError')
    expect(failureOf('nothing')).toBe('Error')
  })
})

describe('governance · the reading route (F76, T-15.2)', () => {
  it('answers 404 NOT_FOUND when the build keeps no governance log', async () => {
    for (const handler of [systemGovernanceLog.find, systemGovernanceLog.count]) {
      const reply = fakeReply()
      await handler({ ...request(), server: { governanceLogManager: { isImplemented: () => false } } }, reply)
      expect(reply.statusCode).toBe(404)
      expect(reply.sent.code).toBe('NOT_FOUND')
    }
  })

  it('hands the query to the manager on the control plane, with its paging headers', async () => {
    const asked: any[] = []
    const governance = {
      ...fakeGovernanceLog(),
      findQuery: async (ctx: any, query: any) => (asked.push([ctx.kind, query]), { records: [{ id: 'g-1' }], headers: { 'v-total': 1 } }),
      countQuery: async (ctx: any, query: any) => (asked.push([ctx.kind, query]), 1)
    }
    const found = fakeReply()
    await systemGovernanceLog.find(request(governance), found)
    expect(found.sent).toEqual([{ id: 'g-1' }])
    expect(found.h).toEqual({ 'v-total': 1 })
    const counted = fakeReply()
    await systemGovernanceLog.count(request(governance), counted)
    expect(counted.sent).toBe(1)
    expect(asked).toEqual([
      ['control', { tenantId: 'id-acme' }],
      ['control', { tenantId: 'id-acme' }]
    ])
  })
})
