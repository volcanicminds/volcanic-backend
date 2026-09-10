/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: what managing a platform identity refuses.
//
// Three refusals that no test had ever fired. Two of them guard the last door out — an
// instance whose only administrator blocked or deleted itself is not recoverable from the
// inside — and the third keeps the two role catalogues from leaking into each other, which is
// the whole reason T-4.1 split them.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { create, update, remove, block } from '../../lib/api/system/controller/systemUser.js'
import { loadSystem } from '../../lib/loader/roles.js'
import { getData, getParams } from '../../lib/util/common.js'

;(global as any).log = {}

const ROOT: any = { id: 'sys-1', externalId: 'sys-ext-1', email: 'root@system.test', roles: ['system:admin'] }
const OTHER: any = { id: 'sys-2', externalId: 'sys-ext-2', email: 'auditor@system.test', roles: ['system:auditor'] }

let savedSystemRoles: any

async function build(over: any = {}) {
  ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }

  const created: any[] = []
  const updated: any[] = []
  const removed: string[] = []
  const blocked: any[] = []

  const server: any = fastify()
  server.decorate('systemUserManager', {
    isImplemented: () => over.systemUsers !== false,
    retrieveSystemUserById: async (_c: any, id: string) => [ROOT, OTHER].find((u) => u.id === id) ?? null,
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
    blockSystemUser: async (_c: any, id: string, reason: string) => {
      blocked.push({ id, reason })
      return true
    }
  })

  server.addHook('onRequest', async (req: any) => {
    req.data = () => getData(req)
    req.parameters = () => getParams(req)
    req.control = { kind: 'control' }
    req.systemUser = ROOT
  })

  server.post('/system/users', { config: { tenantContext: false } }, create)
  server.put('/system/users/:id', { config: { tenantContext: false } }, update)
  server.delete('/system/users/:id', { config: { tenantContext: false } }, remove)
  server.post('/system/users/:id/block', { config: { tenantContext: false } }, block)

  await server.ready()
  return { server, created, updated, removed, blocked }
}

describe('system users · what it refuses (T-9.5)', () => {
  before(async () => {
    savedSystemRoles = (global as any).systemRoles
    ;(global as any).systemRoles = await loadSystem()
  })

  after(() => {
    ;(global as any).systemRoles = savedSystemRoles
    ;(global as any).config = undefined
  })

  it('refuses a tenant role on a platform identity, and names the offending one', async () => {
    // `admin` is a real role — in the OTHER catalogue. Granting it here would create an
    // identity whose role code means one thing where it is stored and another where it is
    // read, which is the confusion T-4.1 exists to remove.
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
