/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Machine tokens, and the same apex rule that guards users.
//
// A token carries roles and those roles are what authorizes its requests (see
// `hooks/onRequest`), so a `tokens` capability holder able to mint an admin token holds
// `admin` by another route: the capability is granted to manage machine credentials, and it
// would become a way to grant yourself everything.
//
// The other property worth pinning is what create writes: the row, and nothing after the
// signature. The bearer goes back in the answer and is not stored anywhere.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwt from '@fastify/jwt'
import { create, update, remove, findOne, block, unblock, reissue } from '../../lib/api/token/controller/token.js'
import { fakeGovernanceLog } from './fixtures/governanceLog.js'

;(global as any).log = {}

// A real signer, registered with a session lifetime as index.ts registers it: what a bearer must
// not inherit is the library's behaviour, so a fake of the library cannot pin it.
const signer = fastify()
before(async () => {
  await signer.register(jwt, { secret: 'token-apex-test-secret-at-least-32-chars', sign: { expiresIn: '1h' } })
  await signer.ready()
})
after(() => signer.close())
const claimsOf = (token: string) => {
  const { iat: _iat, ...claims } = signer.jwt.decode(token) as any
  return claims
}

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
    sent
  }
  return reply
}

function request(opts: any = {}) {
  const calls: any[] = []
  const callerRoles: string[] = opts.callerRoles ?? ['admin']
  const governance = fakeGovernanceLog()

  const req: any = {
    data: () => opts.data ?? {},
    parameters: () => ({ id: opts.targetId ?? EXISTING.id }),
    control: { kind: 'control' },
    ...(opts.systemUser ? { systemUser: opts.systemUser } : { user: { id: 'u-admin' } }),
    tenantInfo: opts.tenantInfo,
    routeOptions: { config: { tenantContext: false } },
    hasRole: (r: any) => callerRoles.includes(r?.code),
    roles: () => callerRoles,
    server: {
      get jwt() {
        return signer.jwt
      },
      governanceLogManager: governance,
      tokenManager: {
        isImplemented: () => true,
        retrieveTokenById: async (_c: any, id: string) =>
          opts.missing ? null : id === EXISTING.id ? { ...EXISTING, ...opts.existing } : null,
        resetExternalId: async (_c: any, id: string) => {
          calls.push(['resetExternalId', id])
          return 't-ext-rotated'
        },
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

  return { req, calls, reply: fakeReply(), governance }
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
    const { req, calls, reply } = request({ data: { name: 'ci', expiresAt: null, requiredRoles: ['editor'] } })

    await create(req, reply)
    expect(calls[0][1].roles).toEqual(['editor', 'public'])
  })

  it('drops a role the catalogue does not have, instead of storing a code nothing resolves', async () => {
    // A role that resolves to nothing at authorization time is worse than an absent one: it
    // reads like a grant and behaves like a gap.
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { name: 'ci', expiresAt: null, requiredRoles: ['editor', 'invented'] } })

    await create(req, reply)
    expect(calls[0][1].roles).toEqual(['editor', 'public'])
  })

  it('refuses to mint an admin token for a caller who is not an admin', async () => {
    ;(global as any).config = { options: { allow_multiple_admin: true } }
    const { req, calls, reply } = request({ callerRoles: ['editor'], data: { name: 'ci', expiresAt: null, requiredRoles: ['admin'] } })

    await create(req, reply)
    expect(reply.sent.code).toBe(403)
    expect(reply.sent.body.code).toBe('TOKEN_ROLE_FORBIDDEN')
    expect(calls.length).toBe(0)
  })

  it('refuses it for an admin caller too when the deployment declares a single apex', async () => {
    ;(global as any).config = { options: { allow_multiple_admin: false } }
    const { req, calls, reply } = request({ callerRoles: ['admin'], data: { name: 'ci', expiresAt: null, requiredRoles: ['admin'] } })

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

  it("changes a token's name, description and roles alone, the roles by the rule of a creation", async () => {
    // The manager writes every key it is given: a body that reached it whole could unblock, revive,
    // extend or re-key a token on a route meant for its labels.
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({
      data: {
        name: 'renamed',
        description: 'nightly',
        roles: ['editor', 'invented', 'system:auditor'],
        blocked: false,
        deletedAt: null,
        externalId: 'chosen',
        expiresAt: '2099-01-01T00:00:00.000Z',
        id: 'other'
      }
    })
    await update(req, reply)
    expect(calls).toEqual([['updateTokenById', EXISTING.id, { name: 'renamed', description: 'nightly', roles: ['editor', 'public'] }]])

    // Without `roles` in the body the roles are not touched, `public` included.
    const renamed = request({ data: { name: 'renamed' } })
    await update(renamed.req, renamed.reply)
    expect(renamed.calls).toEqual([['updateTokenById', EXISTING.id, { name: 'renamed' }]])
  })

  it('writes the row, signs the bearer for it, and returns the bearer without storing it', async () => {
    // The bearer exists in the answer and nowhere else: a write after the signature would put
    // a working credential in a table every `tokens` reader can list.
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { name: 'ci', expiresAt: null } })

    const created: any = await create(req, reply)
    expect(calls.map((c) => c[0])).toEqual(['createToken'])
    expect(claimsOf(created.token)).toEqual({ sub: 't-ext-new', typ: 'integration' })
    expect(created.externalId).toBe('t-ext-new')
  })

  it('refuses a missing, unreadable or past expiry, before writing anything', async () => {
    // A missing `expiresAt` is not `null`: a permanent credential is written down, never assumed.
    ;(global as any).config = { options: {} }
    for (const expiresAt of [undefined, 'not a date', new Date(Date.now() - 1000).toISOString()]) {
      const { req, calls, reply } = request({ data: { name: 'ci', expiresAt } })

      await create(req, reply)
      expect(reply.sent.code).toBe(400)
      expect(reply.sent.body.code).toBe('TOKEN_EXPIRY_INVALID')
      expect(calls.length).toBe(0)
    }
  })

  it('signs the expiry of the row into the bearer, and no session lifetime into a permanent one', async () => {
    ;(global as any).config = { options: {} }
    const at = new Date(Date.now() + 3600_000)
    const dated = request({ data: { name: 'ci', expiresAt: at.toISOString() } })

    const signedDated: any = await create(dated.req, dated.reply)
    expect(dated.calls[0][1].expiresAt).toEqual(at)
    // The row's instant, not the signer's hour from now.
    expect(claimsOf(signedDated.token).exp).toBe(Math.floor(at.getTime() / 1000))

    const permanent = request({ data: { name: 'ci', expiresAt: null } })
    const signedPermanent: any = await create(permanent.req, permanent.reply)
    expect(permanent.calls[0][1].expiresAt).toBeNull()
    expect(claimsOf(signedPermanent.token)).not.toHaveProperty('exp')
  })

  it('signs the tenant the row lives in into the bearer, and no tenant without tenants', async () => {
    // Without `tid` the tenant of a machine's request would come from a header next to a token,
    // which the resolution refuses to believe for every other token (docs/AUTHORIZATION_V5.md §5).
    ;(global as any).config = { options: {} }
    const inTenant = request({ data: { name: 'ci', expiresAt: null }, tenantInfo: { id: 'tenant-acme', slug: 'acme' } })
    const tenantBearer: any = await create(inTenant.req, inTenant.reply)
    expect(claimsOf(tenantBearer.token)).toEqual({ sub: 't-ext-new', typ: 'integration', tid: 'tenant-acme' })

    const single = request({ data: { name: 'ci', expiresAt: new Date(Date.now() + 3600_000).toISOString() } })
    const singleBearer: any = await create(single.req, single.reply)
    expect(claimsOf(singleBearer.token)).not.toHaveProperty('tid')
  })

  it('reports a row it could not write, instead of signing a bearer for nothing', async () => {
    ;(global as any).config = { options: {} }
    const { req, calls, reply } = request({ data: { name: 'ci', expiresAt: null }, createFails: true })

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

  it('reissues a bearer for the same row under a new externalId, with its expiry and its tenant (T-17.7)', async () => {
    // The old bearer carries the old externalId in `sub`: once the row has a new one, nothing
    // resolves it any more. The order is the property: rotated first, then signed.
    ;(global as any).config = { options: {} }
    const at = new Date(Date.now() + 3600_000)
    const { req, calls, reply } = request({ existing: { expiresAt: at.toISOString() }, tenantInfo: { id: 'tenant-acme', slug: 'acme' } })

    const reissued: any = await reissue(req, reply)
    expect(calls).toEqual([['resetExternalId', EXISTING.id]])
    expect(reply.sent.code).toBe(200)
    expect(claimsOf(reissued.token)).toEqual({
      sub: 't-ext-rotated',
      typ: 'integration',
      tid: 'tenant-acme',
      exp: Math.floor(at.getTime() / 1000)
    })
    expect(reissued).toMatchObject({ id: EXISTING.id, name: 'ci', externalId: 't-ext-rotated' })
  })

  it('refuses to reissue a token that is gone or expired, and rotates nothing (T-17.7)', async () => {
    ;(global as any).config = { options: {} }
    const missing = request({ missing: true })
    await reissue(missing.req, missing.reply)
    expect(missing.reply.sent.code).toBe(404)

    const removed = request({ existing: { deletedAt: new Date().toISOString() } })
    await reissue(removed.req, removed.reply)
    expect(removed.reply.sent.code).toBe(404)

    const expired = request({ existing: { expiresAt: new Date(Date.now() - 1000).toISOString() } })
    await reissue(expired.req, expired.reply)
    expect([expired.reply.sent.code, expired.reply.sent.body.code]).toEqual([409, 'TOKEN_EXPIRED'])

    expect([...missing.calls, ...removed.calls, ...expired.calls]).toEqual([])
  })

  it('refuses the bearer of an admin token to whoever could not create one, and rotates nothing (T-17.7)', async () => {
    // A `tokens` holder who reissued an admin row would sign themselves an admin bearer: the
    // escalation Rule A closes on creation, reached through the back door.
    ;(global as any).config = { options: { allow_multiple_admin: true } }
    const editor = request({ callerRoles: ['editor'], existing: { roles: ['admin', 'public'] } })
    await reissue(editor.req, editor.reply)
    expect(editor.reply.sent.code).toBe(403)

    ;(global as any).config = { options: { allow_multiple_admin: false } }
    const single = request({ callerRoles: ['admin'], existing: { roles: ['admin'] } })
    await reissue(single.req, single.reply)
    expect(single.reply.sent.code).toBe(403)
    expect([...editor.calls, ...single.calls]).toEqual([])

    ;(global as any).config = { options: { allow_multiple_admin: true } }
    const admin = request({ callerRoles: ['admin'], existing: { roles: ['admin'] } })
    const adminBearer: any = await reissue(admin.req, admin.reply)
    expect(claimsOf(adminBearer.token)).toMatchObject({ sub: 't-ext-rotated' })
  })

  it('writes every act in the governance log, by its user, and nothing for one refused (F100)', async () => {
    ;(global as any).config = { options: { allow_multiple_admin: false } }
    const acts = async (run: (r: ReturnType<typeof request>) => Promise<unknown>, opts: any = {}) => {
      const r = request(opts)
      await run(r)
      return r.governance.rows.map(({ action, targetId, detail, actorId, actorKind, tenantId }) => ({
        action,
        targetId,
        detail,
        actorId,
        actorKind,
        tenantId
      }))
    }
    const by = { actorId: 'u-admin', actorKind: 'user', tenantId: undefined }
    const at = new Date(Date.now() + 3600_000)

    expect(await acts((r) => create(r.req, r.reply), { data: { name: 'ci', expiresAt: at.toISOString(), requiredRoles: ['editor'] } })).toEqual([
      { action: 'token.created', targetId: 't-new', detail: { roles: ['editor', 'public'], expiresAt: at.toISOString() }, ...by }
    ])
    expect(await acts((r) => update(r.req, r.reply), { data: { name: 'renamed', roles: ['editor'] } })).toEqual([
      { action: 'token.updated', targetId: EXISTING.id, detail: { requested: ['name', 'roles'], roles: ['editor', 'public'] }, ...by }
    ])
    expect(await acts((r) => reissue(r.req, r.reply))).toEqual([{ action: 'token.reissued', targetId: EXISTING.id, detail: undefined, ...by }])
    expect(await acts((r) => block(r.req, r.reply), { data: { reason: 'leaked' } })).toEqual([
      { action: 'token.blocked', targetId: EXISTING.id, detail: { reason: 'leaked' }, ...by }
    ])
    expect(await acts((r) => unblock(r.req, r.reply))).toEqual([{ action: 'token.unblocked', targetId: EXISTING.id, detail: undefined, ...by }])
    expect(await acts((r) => remove(r.req, r.reply))).toEqual([{ action: 'token.deleted', targetId: EXISTING.id, detail: undefined, ...by }])

    // Refused, missing, removed already: nothing changed, so nothing is written.
    expect(await acts((r) => update(r.req, r.reply), { data: { roles: ['admin'] } })).toEqual([])
    expect(await acts((r) => block(r.req, r.reply), { missing: true })).toEqual([])
    expect(await acts((r) => unblock(r.req, r.reply), { missing: true })).toEqual([])
    expect(await acts((r) => remove(r.req, r.reply), { existing: { deletedAt: new Date().toISOString() } })).toEqual([])
  })

  it('issues a token of the control plane with system roles only, signed for that plane, never with system:admin (F97)', async () => {
    // A platform route where tenants are declared: the request fixture's route is `scope: 'control'`.
    const savedSystemRoles = (global as any).systemRoles
    ;(global as any).config = { options: { tenants: { strategy: 'schema' } } }
    ;(global as any).systemRoles = {
      'system:admin': { code: 'system:admin' },
      'system:auditor': { code: 'system:auditor' }
    }
    try {
      const operator = { systemUser: { id: 's-admin' } }
      const issued = request({ ...operator, data: { name: 'sentinel', expiresAt: null, requiredRoles: ['system:auditor', 'editor', 'invented'] } })
      const created: any = await create(issued.req, issued.reply)
      // The tenant catalogue's `editor` names nothing here, and the control plane has no `public`.
      expect(issued.calls[0][1].roles).toEqual(['system:auditor'])
      expect(claimsOf(created.token)).toEqual({ sub: 't-ext-new', typ: 'integration', scp: 'control' })
      expect(issued.governance.rows.map((r: any) => [r.action, r.actorKind, r.actorId])).toEqual([['token.created', 'system_user', 's-admin']])

      const sovereign = request({ ...operator, data: { name: 'root', expiresAt: null, requiredRoles: ['system:admin'] } })
      await create(sovereign.req, sovereign.reply)
      expect([sovereign.reply.sent.code, sovereign.reply.sent.body.code]).toEqual([403, 'TOKEN_ROLE_FORBIDDEN'])

      const promoted = request({ ...operator, data: { roles: ['system:auditor', 'system:admin'] } })
      await update(promoted.req, promoted.reply)
      expect([promoted.reply.sent.code, promoted.reply.sent.body.code]).toEqual([403, 'TOKEN_ROLE_FORBIDDEN'])
      expect([...sovereign.calls, ...promoted.calls, ...sovereign.governance.rows, ...promoted.governance.rows]).toEqual([])

      // An update takes the same catalogue: no tenant role, no invented code, no `public`.
      const changed = request({ ...operator, data: { roles: ['system:auditor', 'editor', 'public', 'invented'] } })
      await update(changed.req, changed.reply)
      expect(changed.calls).toEqual([['updateTokenById', EXISTING.id, { roles: ['system:auditor'] }]])
    } finally {
      ;(global as any).systemRoles = savedSystemRoles
    }
  })
})
