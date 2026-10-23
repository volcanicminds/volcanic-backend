/* eslint-disable @typescript-eslint/no-explicit-any */
//
// What managing a platform identity refuses.
//
// Two refusals guard the last door out (an instance whose only administrator blocked or deleted
// itself is not recoverable from the inside), one keeps the two role catalogues from leaking into
// each other, and the apex keeps `system:admin` to the superusers: an operator who manages the
// others never grants it and never touches one who holds it.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { create, update, remove, block, unblock, resetMfa } from '../../lib/api/system/controller/systemUser.js'
import { loadSystem } from '../../lib/loader/roles.js'
import { getData, getParams } from '../../lib/util/common.js'
import { fakeGovernanceLog } from './fixtures/governanceLog.js'

;(global as any).log = {}

const ROOT: any = { id: 'sys-1', externalId: 'sys-ext-1', email: 'root@system.test', roles: ['system:admin'] }
const OTHER: any = { id: 'sys-2', externalId: 'sys-ext-2', email: 'auditor@system.test', roles: ['system:auditor'] }
// The controller does not read capabilities (the route does), so any role but the apex stands for
// an operator a project gave `system-users`.
const MANAGER: any = { id: 'sys-3', externalId: 'sys-ext-3', email: 'manager@system.test', roles: ['system:operator'] }
const PEER: any = { id: 'sys-4', externalId: 'sys-ext-4', email: 'peer@system.test', roles: ['system:admin'] }

let savedSystemRoles: any

async function build(over: any = {}) {
  ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }

  const caller = over.caller ?? ROOT
  const rows: any[] = over.users ?? [ROOT, OTHER, MANAGER, PEER]
  const counted: any[] = []
  const created: any[] = []
  const updated: any[] = []
  const removed: string[] = []
  const blocked: any[] = []
  const unblocked: string[] = []
  const reset: string[] = []

  const server: any = fastify()
  server.decorate('governanceLogManager', fakeGovernanceLog())
  server.decorate('systemUserManager', {
    isImplemented: () => over.systemUsers !== false,
    retrieveSystemUserById: async (_c: any, id: string) => rows.find((u) => u.id === id) ?? null,
    // The one query the controller counts with, answered as Postgres would.
    countQuery: async (_c: any, query: any) => {
      counted.push(query)
      return rows.filter((u) => u.roles.includes(query['roles:arrayContains']) && String(!!u.blocked) === query.blocked).length
    },
    retrieveSystemUserByEmail: async () => null,
    createSystemUser: async (_c: any, data: any) => {
      created.push(data)
      return { ...OTHER, ...data }
    },
    updateSystemUserById: async (_c: any, id: string, data: any) => {
      updated.push({ id, data })
      return { ...OTHER, ...data }
    },
    deleteSystemUser: async (_c: any, id: string) => {
      removed.push(id)
      return true
    },
    blockSystemUserById: async (_c: any, id: string, reason: string) => {
      blocked.push({ id, reason })
      return true
    },
    unblockSystemUserById: async (_c: any, id: string) => {
      unblocked.push(id)
      return true
    },
    disableMfa: async (_c: any, id: string) => {
      reset.push(id)
      return true
    }
  })

  server.addHook('onRequest', async (req: any) => {
    req.data = () => getData(req)
    req.parameters = () => getParams(req)
    req.control = { kind: 'control' }
    req.systemUser = caller
    req.roles = () => caller.roles
  })

  server.post('/system/users', { config: { tenantContext: false } }, create)
  server.put('/system/users/:id', { config: { tenantContext: false } }, update)
  server.delete('/system/users/:id', { config: { tenantContext: false } }, remove)
  server.post('/system/users/:id/block', { config: { tenantContext: false } }, block)
  server.post('/system/users/:id/unblock', { config: { tenantContext: false } }, unblock)
  server.post('/system/users/:id/mfa/reset', { config: { tenantContext: false } }, resetMfa)

  await server.ready()
  return { server, created, updated, removed, blocked, unblocked, reset, counted }
}

const code = (res: any) => JSON.parse(res.body).code

describe('system users · what it refuses (T-9.5)', () => {
  before(async () => {
    savedSystemRoles = (global as any).systemRoles
    ;(global as any).systemRoles = (await loadSystem()).roles
  })

  after(() => {
    ;(global as any).systemRoles = savedSystemRoles
    ;(global as any).config = undefined
  })

  it('refuses a tenant role on a platform identity, and names the offending one', async () => {
    // `admin` is a real role — in the OTHER catalogue. Granting it here would create an
    // identity whose role code means one thing where it is stored and another where it is
    // read.
    const { server, created } = await build()

    const res = await server.inject({
      method: 'POST',
      url: '/system/users',
      payload: { email: 'new@system.test', password: 'Str0ng-passw0rd!', roles: ['admin', 'system:auditor'] }
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('ROLE_NOT_IN_SCOPE')
    // Named, not just rejected: an operator with a list of five roles needs to know which one.
    expect(JSON.parse(res.body).message).toContain('admin')
    expect(created.length).toBe(0)
    await server.close()
  })

  it('refuses the same role on an update, not only on a create', async () => {
    // The check has to be on both doors. Guarding creation alone leaves the same identity one
    // PUT away from the state creation refused.
    const { server, updated } = await build()

    const res = await server.inject({
      method: 'PUT',
      url: `/system/users/${OTHER.id}`,
      payload: { roles: ['nonsense:role'] }
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('ROLE_NOT_IN_SCOPE')
    expect(updated.length).toBe(0)
    await server.close()
  })

  it('refuses to delete the identity making the request', async () => {
    // An instance whose administrator deleted itself cannot be repaired from the inside. One
    // that merely has no administrator still can.
    const { server, removed } = await build()

    const res = await server.inject({ method: 'DELETE', url: `/system/users/${ROOT.id}` })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('SELF_DELETE')
    expect(removed).toEqual([])

    // And someone else is still deletable: the guard is about the caller, not about the role.
    const other = await server.inject({ method: 'DELETE', url: `/system/users/${OTHER.id}` })
    expect(other.statusCode).toBeLessThan(400)
    expect(removed).toEqual([OTHER.id])
    await server.close()
  })

  it('refuses to block the identity making the request', async () => {
    const { server, blocked } = await build()

    const res = await server.inject({
      method: 'POST',
      url: `/system/users/${ROOT.id}/block`,
      payload: { reason: 'testing' }
    })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('SELF_BLOCK')
    expect(blocked).toEqual([])
    await server.close()
  })

  it('keeps system:admin to the superusers: an operator neither grants it nor touches one who holds it (SUPERUSER_ONLY)', async () => {
    const { server, created, updated, removed, blocked, unblocked, reset } = await build({ caller: MANAGER })
    const grant = { roles: ['system:auditor', 'system:admin'] }

    const minted = await server.inject({ method: 'POST', url: '/system/users', payload: { email: 'new@system.test', password: 'Str0ng-passw0rd!', ...grant } })
    expect([minted.statusCode, code(minted)]).toEqual([403, 'SUPERUSER_ONLY'])
    // Its own account is no way round: the grant is refused whoever the subject is.
    const self = await server.inject({ method: 'PUT', url: `/system/users/${MANAGER.id}`, payload: grant })
    expect([self.statusCode, code(self)]).toEqual([403, 'SUPERUSER_ONLY'])

    const onPeer = [
      server.inject({ method: 'PUT', url: `/system/users/${PEER.id}`, payload: { roles: ['system:auditor'] } }),
      server.inject({ method: 'DELETE', url: `/system/users/${PEER.id}` }),
      server.inject({ method: 'POST', url: `/system/users/${PEER.id}/block`, payload: { reason: 'takeover' } }),
      server.inject({ method: 'POST', url: `/system/users/${PEER.id}/unblock` }),
      server.inject({ method: 'POST', url: `/system/users/${PEER.id}/mfa/reset` })
    ]
    for (const res of await Promise.all(onPeer)) expect([res.statusCode, code(res)]).toEqual([403, 'SUPERUSER_ONLY'])
    expect({ created, updated, removed, blocked, unblocked, reset }).toEqual({ created: [], updated: [], removed: [], blocked: [], unblocked: [], reset: [] })

    // The other operators are still the manager's to manage.
    const onOther = [
      server.inject({ method: 'PUT', url: `/system/users/${OTHER.id}`, payload: { roles: ['system:operator'] } }),
      server.inject({ method: 'POST', url: `/system/users/${OTHER.id}/block`, payload: { reason: 'left' } }),
      server.inject({ method: 'POST', url: `/system/users/${OTHER.id}/unblock` }),
      server.inject({ method: 'POST', url: `/system/users/${OTHER.id}/mfa/reset` }),
      server.inject({ method: 'DELETE', url: `/system/users/${OTHER.id}` })
    ]
    for (const res of await Promise.all(onOther)) expect(res.statusCode).toBe(200)
    await server.close()
  })

  it('lets a superuser grant system:admin and act on another superuser', async () => {
    const { server, created, updated, blocked } = await build({ caller: ROOT })

    const minted = await server.inject({ method: 'POST', url: '/system/users', payload: { email: 'new@system.test', password: 'Str0ng-passw0rd!', roles: ['system:admin'] } })
    expect(minted.statusCode).toBe(201)
    const demoted = await server.inject({ method: 'PUT', url: `/system/users/${PEER.id}`, payload: { roles: ['system:auditor'] } })
    expect(demoted.statusCode).toBe(200)
    const stopped = await server.inject({ method: 'POST', url: `/system/users/${PEER.id}/block`, payload: { reason: 'left' } })
    expect(stopped.statusCode).toBe(200)
    expect([created.length, updated.length, blocked.length]).toEqual([1, 1, 1])
    await server.close()
  })

  it('never lets the last superuser who can sign in give system:admin away (LAST_SUPERUSER)', async () => {
    // The other superuser is blocked, and only a superuser could unblock it.
    const { server, updated, counted } = await build({ users: [ROOT, OTHER, { ...PEER, blocked: true }] })

    const demoted = await server.inject({ method: 'PUT', url: `/system/users/${ROOT.id}`, payload: { roles: ['system:auditor'] } })
    expect([demoted.statusCode, code(demoted)]).toEqual([409, 'LAST_SUPERUSER'])
    expect(counted).toEqual([{ 'roles:arrayContains': 'system:admin', blocked: 'false' }])
    expect(updated).toEqual([])

    // Keeping the role, changing anything else, or demoting the blocked one is not giving it away.
    for (const [id, payload] of [
      [ROOT.id, { roles: ['system:admin', 'system:auditor'] }],
      [ROOT.id, { email: 'root2@system.test' }],
      [PEER.id, { roles: ['system:auditor'] }]
    ] as const) {
      expect((await server.inject({ method: 'PUT', url: `/system/users/${id}`, payload })).statusCode).toBe(200)
    }
    expect(updated.length).toBe(3)
    await server.close()
  })

  it('answers 503 SYSTEM_USERS_NOT_AVAILABLE when the build has no platform identities', async () => {
    // A single-tenant deployment never creates a system user, so these routes have nothing to
    // manage. 503 says the deployment cannot; 404 would say the identity is missing.
    const { server } = await build({ systemUsers: false })

    const res = await server.inject({ method: 'DELETE', url: `/system/users/${OTHER.id}` })
    expect(res.statusCode).toBe(503)
    expect(JSON.parse(res.body).code).toBe('SYSTEM_USERS_NOT_AVAILABLE')
    await server.close()
  })
})
