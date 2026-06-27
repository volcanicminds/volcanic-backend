/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (multi-tenant) — the /tenants management API (tenantContext:false, global
// public scope). Driven by a public-schema system super-admin. CRUD + soft
// delete/restore over embedded PGlite.
//
import { expect } from 'expect'
import { app, resetSearchPath, superAdminToken, ACME, GLOBEX } from './harness.js'

describe('E2E (multi-tenant) — /tenants management API', () => {
  // /tenants is tenantContext:false → queries run on public; reset before each.
  const inject = async (opts: any) => {
    await resetSearchPath()
    return app().inject(opts)
  }
  const auth = () => ({ authorization: `Bearer ${superAdminToken()}` })

  let createdId: string

  it('requires admin (401 without a token)', async () => {
    const res = await inject({ method: 'GET', url: '/tenants' })
    expect(res.statusCode).toBe(401)
  })

  it('the super-admin lists existing tenants (acme, globex)', async () => {
    const res = await inject({ method: 'GET', url: '/tenants', headers: auth() })
    expect(res.statusCode).toBe(200)
    const slugs = JSON.parse(res.body).map((t: any) => t.slug)
    expect(slugs).toContain(ACME.slug)
    expect(slugs).toContain(GLOBEX.slug)
  })

  it('creates a new tenant (201) and provisions its schema', async () => {
    const res = await inject({
      method: 'POST',
      url: '/tenants',
      headers: auth(),
      payload: { name: 'Initech', slug: 'initech', dbSchema: 'tenant_initech' }
    })
    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.slug).toBe('initech')
    expect(body.id).toBeTruthy()
    createdId = body.id
  })

  it('reads the new tenant by id', async () => {
    const res = await inject({ method: 'GET', url: `/tenants/${createdId}`, headers: auth() })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).slug).toBe('initech')
  })

  it('updates the tenant name', async () => {
    const res = await inject({
      method: 'PUT',
      url: `/tenants/${createdId}`,
      headers: auth(),
      payload: { name: 'Initech Renamed' }
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).name).toBe('Initech Renamed')
  })

  it('soft-deletes the tenant (excluded from the list)', async () => {
    const del = await inject({ method: 'DELETE', url: `/tenants/${createdId}`, headers: auth() })
    expect(del.statusCode).toBe(200)
    const list = await inject({ method: 'GET', url: '/tenants', headers: auth() })
    expect(JSON.parse(list.body).some((t: any) => t.id === createdId)).toBe(false)
  })

  it('restores the soft-deleted tenant', async () => {
    const res = await inject({ method: 'POST', url: `/tenants/${createdId}/restore`, headers: auth() })
    expect(res.statusCode).toBe(200)
    const list = await inject({ method: 'GET', url: '/tenants', headers: auth() })
    expect(JSON.parse(list.body).some((t: any) => t.id === createdId)).toBe(true)
  })
})
