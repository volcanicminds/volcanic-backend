/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: machine tokens, and the same apex rule that guards users.
//
// A token carries roles and those roles are what authorizes its requests (see
// `hooks/onRequest`), so a `tokens` capability holder able to mint an admin token holds
// `admin` by another route — the capability was granted to manage machine credentials, and it
// would have become a way to grant yourself everything. The rule was written and never fired.
//
// The other property worth pinning is the ORDER inside create: the row is written, then the
// bearer is signed, then the row is updated with it. A token row without its bearer is a
// credential nobody can use and nobody can see is broken.
//
import { expect } from 'expect'
import { create, update, remove, findOne, block, unblock } from '../../lib/api/token/controller/token.js'

;(global as any).log = {}

const EXISTING: any = { id: 't1', externalId: 't-ext-1', name: 'ci', roles: ['public'] }

function fakeReply() {
  const sent: any = { code: 200, body: null }
  const reply: any = {
    status(code: number) {
      sent.code = code
      return reply
    },
    send(body: any) {
      sent.body = body
      return reply
    },
    type() {
      return reply
    },
    headers() {
      return reply
    },
    jwtSign: async (payload: any) => (payload?.sub ? `signed:${payload.sub}` : ''),
    sent
  }
  return reply
}

function request(opts: any = {}) {
  const calls: any[] = []
  const callerRoles: string[] = opts.callerRoles ?? ['admin']

  const req: any = {
    data: () => opts.data ?? {},
    parameters: () => ({ id: opts.targetId ?? EXISTING.id }),
    control: { kind: 'control' },
    routeOptions: { config: { tenantContext: false } },
    hasRole: (r: any) => callerRoles.includes(r?.code),
    roles: () => callerRoles,
    server: {
      tokenManager: {
        isImplemented: () => true,
        retrieveTokenById: async (_c: any, id: string) => (opts.missing ? null : id === EXISTING.id ? EXISTING : null),
        createToken: async (_c: any, data: any) => {
          calls.push(['createToken', data])
          return opts.createFails ? null : { id: 't-new', externalId: 't-ext-new', ...data }
        },
        updateTokenById: async (_c: any, id: string, data: any) => {
          calls.push(['updateTokenById', id, data])
          return { id, ...data }
        },
        removeTokenById: async (_c: any, id: string) => {
          calls.push(['removeTokenById', id])
          return { id }
        },
        blockTokenById: async (_c: any, id: string, reason: string) => {
          calls.push(['blockTokenById', id, reason])
        },
        unblockTokenById: async (_c: any, id: string) => {
          calls.push(['unblockTokenById', id])
        }
      }
    }
  }

  return { req, calls, reply: fakeReply() }
}

describe('tokens · roles, and the apex rule that applies to them too (T-9.5)', () => {
  let savedRoles: any

  // Saved and put back: mocha runs every spec in one process, so a catalogue this suite
  // installs is installed for everybody. Leaving it behind is how another suite starts
  // failing for a reason that is not in its own file.
  before(() => {
    savedRoles = (global as any).roles
    ;(global as any).roles = { public: { code: 'public' }, admin: { code: 'admin' }, editor: { code: 'editor' } }
  })

  after(() => {
    ;(global as any).roles = savedRoles
    ;(global as any).config = undefined
  })

  it('refuses a name-less token, before writing anything', async () => {
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { requiredRoles: ['editor'] } })

    await create(req, reply)
    expect(reply.sent.code).toBe(404)
    expect(calls.length).toBe(0)
  })

  it('always carries `public`, so a token is never a credential with no roles at all', async () => {
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { name: 'ci', requiredRoles: ['editor'] } })

    await create(req, reply)
    expect(calls[0][1].roles).toEqual(['editor', 'public'])
  })

  it('drops a role the catalogue does not have, instead of storing a code nothing resolves', async () => {
    // A role that resolves to nothing at authorization time is worse than an absent one: it
    // reads like a grant and behaves like a gap.
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { name: 'ci', requiredRoles: ['editor', 'invented'] } })

    await create(req, reply)
    expect(calls[0][1].roles).toEqual(['editor', 'public'])
  })

  it('refuses to mint an admin token for a caller who is not an admin', async () => {
    ;(global as any).config = { options: { allow_multiple_admin: true } }
    const { req, calls, reply } = request({ callerRoles: ['editor'], data: { name: 'ci', requiredRoles: ['admin'] } })

    await create(req, reply)
    expect(reply.sent.code).toBe(403)
    expect(calls.length).toBe(0)
  })

  it('refuses it for an admin caller too when the deployment declares a single apex', async () => {
    ;(global as any).config = { options: { allow_multiple_admin: false } }
    const { req, calls, reply } = request({ callerRoles: ['admin'], data: { name: 'ci', requiredRoles: ['admin'] } })

    await create(req, reply)
    expect(reply.sent.code).toBe(403)
    expect(calls.length).toBe(0)
  })

  it('applies the same rule on update, or the grant is one PUT away', async () => {
    ;(global as any).config = { options: { allow_multiple_admin: false } }
    const { req, calls, reply } = request({ callerRoles: ['admin'], data: { roles: ['admin'] } })

    await update(req, reply)
    expect(reply.sent.code).toBe(403)
    expect(calls.length).toBe(0)
  })

  it('writes the row, signs the bearer, then stores it on the row', async () => {
    // The order is the assertion. A row written without its bearer is a credential that
    // exists, cannot be used, and looks fine in a list.
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { name: 'ci' } })

    const created: any = await create(req, reply)
    expect(calls.map((c) => c[0])).toEqual(['createToken', 'updateTokenById'])
    expect(calls[1][2].token).toBe('signed:t-ext-new')
    expect(created.token).toBe('signed:t-ext-new')
  })

  it('reports a row it could not write, instead of signing a bearer for nothing', async () => {
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { name: 'ci' }, createFails: true })

    await create(req, reply)
    expect(reply.sent.code).toBe(400)
    // No update, because there is no row to update: a bearer signed here would authorize a
    // subject that does not exist.
    expect(calls.map((c) => c[0])).toEqual(['createToken'])
  })

  it('answers 404 for a token that is not there, and does not remove one either', async () => {
    ;(global as any).config = { options: {} }

    const missing = request({ missing: true })
    expect(await findOne(missing.req, missing.reply)).toBeTruthy()
    expect(missing.reply.sent.code).toBe(404)

    const removed = request({ missing: true })
    await remove(removed.req, removed.reply)
    expect(removed.reply.sent.code).toBe(403)
    expect(removed.calls.length).toBe(0)
  })

  it('blocks and unblocks, and reports what it did rather than assuming', async () => {
    ;(global as any).config = { options: {} }

    const blocked = request({ data: { reason: 'rotated' } })
    expect(await block(blocked.req, blocked.reply)).toEqual({ ok: true })
    expect(blocked.calls[0]).toEqual(['blockTokenById', EXISTING.id, 'rotated'])

    const released = request()
    expect(await unblock(released.req, released.reply)).toEqual({ ok: true })
    expect(released.calls[0]).toEqual(['unblockTokenById', EXISTING.id])
  })
})
