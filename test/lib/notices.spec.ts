/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The administrators' notices: the sources checked at boot, and the two routes of each plane
// on an in-memory store of seen marks. The SQL store is in test/db/notices.spec.ts, the routes
// on Postgres in test/e2e-mt-pg/notices.e2e.spec.ts.
//
import { expect } from 'expect'
import { checked, find, noticeSourcesOf, seen } from '../../lib/util/notices.js'
import type { Notice, NoticeReader, NoticeSource } from '../../types/global.js'

const bag = globalThis as any
const warnings: string[] = []
// Set before each test of the describes that read it: a root hook runs once for the whole run, and
// a spec loaded later may set its own `log` in between.
const captureWarnings = () => {
  bag.log = { w: true, warn: (message: string) => warnings.push(message) }
}

const CONTROL = { kind: 'control' }
const TENANT = { kind: 'tenant' }

/** The marks keyed as the table's primary key: notice, reader, scope. */
function memoryMarks() {
  const rows = new Set<string>()
  const key = (reader: NoticeReader, notice: string) => `${reader.scope}|${reader.id}|${notice}`
  const calls: any[] = []
  return {
    rows,
    calls,
    isImplemented: () => true,
    seenOf: async (ctx: any, reader: NoticeReader, notices: readonly string[]) => {
      calls.push(['seenOf', ctx, reader])
      return notices.filter((notice) => rows.has(key(reader, notice)))
    },
    markSeen: async (ctx: any, reader: NoticeReader, notices: readonly string[]) => {
      calls.push(['markSeen', ctx, reader, [...notices]])
      for (const notice of notices) rows.add(key(reader, notice))
    },
    forgetCleared: async (ctx: any, reader: NoticeReader, sources: readonly string[], current: readonly string[]) => {
      calls.push(['forgetCleared', ctx, reader, [...sources]])
      let deleted = 0
      for (const row of [...rows]) {
        const [scope, id, notice] = row.split('|')
        const ofSource = sources.some((source) => notice.startsWith(`${source}:`))
        if (scope === reader.scope && id === reader.id && ofSource && !current.includes(notice)) {
          rows.delete(row)
          deleted++
        }
      }
      return deleted
    }
  }
}

function fakeReply() {
  const sent: any = { code: 200, body: undefined }
  const reply: any = {
    status(code: number) {
      sent.code = code
      return reply
    },
    send(body?: any) {
      sent.body = body
      return reply
    },
    sent
  }
  return reply
}

function fakeRequest(input: { sources?: NoticeSource[]; marks?: any; user?: any; systemUser?: any; control?: boolean; body?: any }) {
  return {
    control: CONTROL,
    tenant: TENANT,
    routeOptions: { config: input.control ? { tenantContext: false } : {} },
    user: input.user,
    systemUser: input.systemUser,
    body: input.body,
    server: { noticeSources: noticeSourcesOf(input.sources ?? []), noticeManager: input.marks ?? memoryMarks() }
  } as any
}

const source = (name: string, notices: Notice[] | (() => Promise<Notice[]>), planes: any = ['tenant', 'control']): NoticeSource => ({
  name,
  planes,
  notices: typeof notices === 'function' ? notices : async () => notices
})

const withTenancy = async (fn: () => Promise<void>) => {
  const before = bag.config
  bag.config = { options: { tenants: { strategy: 'schema' } } }
  try {
    await fn()
  } finally {
    bag.config = before
  }
}

describe('notices · sources checked at boot', () => {
  it('accepts none, and freezes what it accepts', () => {
    expect(noticeSourcesOf(undefined)).toEqual([])
    const sources = noticeSourcesOf([source('rag', [])])
    expect(Object.isFrozen(sources)).toBe(true)
  })

  it('refuses a name that could hold the separator, a duplicate, no planes and no notices()', () => {
    expect(() => noticeSourcesOf([source('a:b', [])])).toThrow(/not a valid name/)
    expect(() => noticeSourcesOf([source('', [])])).toThrow(/not a valid name/)
    expect(() => noticeSourcesOf([source('rag', []), source('rag', [])])).toThrow(/given twice/)
    expect(() => noticeSourcesOf([source('rag', [], [])])).toThrow(/must declare its planes/)
    expect(() => noticeSourcesOf([source('rag', [], ['tenant', 'platform'])])).toThrow(/must declare its planes/)
    expect(() => noticeSourcesOf([{ name: 'rag', planes: ['tenant'] } as any])).toThrow(/has no notices/)
  })
})

describe('notices · an answer held to the contract', () => {
  it('keeps the fields of the contract and drops the rest', () => {
    const at = '2026-11-21T10:00:00.000Z'
    expect(checked([{ id: 'a', kind: 'k', level: 'info', at, data: { n: 1 }, text: 'x' }])).toEqual([
      { id: 'a', kind: 'k', level: 'info', at, data: { n: 1 } }
    ])
  })

  it('fails the whole answer on a notice the console could not place', () => {
    expect(() => checked({})).toThrow(/not answer a list/)
    expect(() => checked([{ kind: 'k', level: 'info' }])).toThrow(/no id/)
    expect(() => checked([{ id: 'a', kind: 'k', level: 'info' }, { id: 'a', kind: 'k', level: 'info' }])).toThrow(/twice/)
    expect(() => checked([{ id: 'a', level: 'info' }])).toThrow(/no kind/)
    expect(() => checked([{ id: 'a', kind: 'k', level: 'error' }])).toThrow(/unknown level/)
    expect(() => checked([{ id: 'a', kind: 'k', level: 'info', at: 'yesterday' }])).toThrow(/not an instant/)
    expect(() => checked([{ id: 'a', kind: 'k', level: 'info', data: [1] }])).toThrow(/not an object/)
  })
})

describe('notices · GET', () => {
  beforeEach(captureWarnings)

  it('serves every source of the plane, newest first, those without an instant last', async () => {
    const req = fakeRequest({
      user: { id: 'u1' },
      sources: [
        source('a', [
          { id: 'old', kind: 'k', level: 'info', at: '2026-11-01T00:00:00.000Z' },
          { id: 'none', kind: 'k', level: 'warning' }
        ]),
        source('b', [{ id: 'new', kind: 'k', level: 'warning', at: '2026-11-20T00:00:00.000Z', data: { n: 2 } }]),
        source('c', [{ id: 'elsewhere', kind: 'k', level: 'info' }], ['control'])
      ]
    })
    const reply = fakeReply()
    await find(req, reply, 'tenant')
    expect(reply.sent.body).toEqual({
      notices: [
        { source: 'b', id: 'b:new', kind: 'k', level: 'warning', at: '2026-11-20T00:00:00.000Z', data: { n: 2 }, seen: false },
        { source: 'a', id: 'a:old', kind: 'k', level: 'info', at: '2026-11-01T00:00:00.000Z', seen: false },
        { source: 'a', id: 'a:none', kind: 'k', level: 'warning', seen: false }
      ],
      failed: []
    })
  })

  it('names a failing source, logs it, and keeps its marks while the others answer', async () => {
    const marks = memoryMarks()
    marks.rows.add('tenant|u1|broken:x')
    marks.rows.add('tenant|u1|ok:gone')
    const req = fakeRequest({
      user: { id: 'u1' },
      marks,
      sources: [
        source('broken', async () => {
          throw new Error('down')
        }),
        source('ok', [{ id: 'here', kind: 'k', level: 'info' }]),
        source('malformed', async () => [{ id: 'm' } as any])
      ]
    })
    warnings.length = 0
    const reply = fakeReply()
    await find(req, reply, 'tenant')
    expect(reply.sent.body.failed).toEqual(['broken', 'malformed'])
    expect(reply.sent.body.notices.map((n: any) => n.id)).toEqual(['ok:here'])
    expect(warnings.join('\n')).toMatch(/'broken' failed on the tenant plane \(down\)/)
    expect(warnings.join('\n')).toMatch(/'malformed' failed/)
    // The mark of the failing source stays, the cleared one of the answering source goes.
    expect([...marks.rows]).toEqual(['tenant|u1|broken:x'])
    expect(marks.calls.find((c) => c[0] === 'forgetCleared')[3]).toEqual(['ok'])
  })

  it('flags what the reader has seen, in the tenant container', async () => {
    await withTenancy(async () => {
      const marks = memoryMarks()
      const req = fakeRequest({ user: { id: 'u1' }, marks, sources: [source('a', [{ id: '1', kind: 'k', level: 'info' }])] })
      marks.rows.add('tenant|u1|a:1')
      const reply = fakeReply()
      await find(req, reply, 'tenant')
      expect(reply.sent.body.notices[0].seen).toBe(true)
      expect(marks.calls.length).toBeGreaterThan(0)
      expect(marks.calls.every((c) => c[1] === TENANT)).toBe(true)
    })
  })

  it('answers 404 without a store of marks, and 403 to a credential that is not a person', async () => {
    const none = fakeReply()
    await find(fakeRequest({ user: { id: 'u1' }, marks: { isImplemented: () => false } }), none, 'tenant')
    expect(none.sent.code).toBe(404)

    const token = fakeReply()
    await find(fakeRequest({ user: undefined }), token, 'tenant')
    expect(token.sent.code).toBe(403)
  })

  it('reads the control plane as the system user where tenants exist, as the user where they do not', async () => {
    await withTenancy(async () => {
      const marks = memoryMarks()
      const reply = fakeReply()
      await find(fakeRequest({ control: true, systemUser: { id: 'op1' }, user: { id: 'u1' }, marks }), reply, 'control')
      expect(reply.sent.code).toBe(200)
      expect(marks.calls.length).toBe(0)
      await find(fakeRequest({ control: true, systemUser: { id: 'op1' }, marks, sources: [source('a', [])] }), fakeReply(), 'control')
      expect(marks.calls[0].slice(1)).toEqual([CONTROL, { id: 'op1', scope: 'system' }, ['a']])
    })

    const marks = memoryMarks()
    await find(fakeRequest({ control: true, user: { id: 'u1' }, marks, sources: [source('a', [])] }), fakeReply(), 'control')
    expect(marks.calls[0].slice(1)).toEqual([CONTROL, { id: 'u1', scope: 'tenant' }, ['a']])
  })
})

describe('notices · POST seen', () => {
  beforeEach(captureWarnings)

  it('marks the ids served now and ignores the others', async () => {
    const marks = memoryMarks()
    const req = fakeRequest({
      user: { id: 'u1' },
      marks,
      body: { ids: ['a:1', 'a:1', 'a:gone', 'nobody:1', 'c:1'] },
      sources: [source('a', [{ id: '1', kind: 'k', level: 'info' }]), source('c', [{ id: '1', kind: 'k', level: 'info' }], ['control'])]
    })
    const reply = fakeReply()
    await seen(req, reply, 'tenant')
    expect(reply.sent.code).toBe(204)
    expect([...marks.rows]).toEqual(['tenant|u1|a:1'])
  })

  it('writes nothing when no id is served, and does not ask a source no id names', async () => {
    let asked = 0
    const marks = memoryMarks()
    const req = fakeRequest({
      user: { id: 'u1' },
      marks,
      body: { ids: ['a:gone'] },
      sources: [
        source('a', []),
        source('b', async () => {
          asked++
          return []
        })
      ]
    })
    const reply = fakeReply()
    await seen(req, reply, 'tenant')
    expect(reply.sent.code).toBe(204)
    expect(asked).toBe(0)
    expect(marks.calls.filter((c) => c[0] === 'markSeen')).toEqual([])
  })
})
