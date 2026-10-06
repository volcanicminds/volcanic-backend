/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-15.2, the governance log of F76 over HTTP on real Postgres: every governance route leaves its
// row, an export and a destruction write their intent before the effect and their outcome after,
// the rows of a tenant stay once its container is gone, and only a holder of `governance-log`
// reads them. What the rows say is checked from outside too, with plain `pg`.
//
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { setup, teardown, inject, systemToken, createTenant, sql, bearer, ACME, GLOBEX } from './harness.js'

const body = (res: any) => JSON.parse(res.body)

const ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'tenant.suspended',
  'tenant.restored',
  'tenant.deleted',
  'tenant.exported',
  'tenant.destruction_requested',
  'tenant.destroyed',
  'impersonation.started',
  'impersonation.ended',
  'system_user.created',
  'system_user.updated',
  'system_user.deleted',
  'system_user.blocked',
  'system_user.unblocked',
  'system_user.mfa_reset',
  'identity_provider.created',
  'identity_provider.updated',
  'identity_provider.deleted',
  'account_creation.changed',
  'account_creation.reset'
]

describe('The governance log on real Postgres (F76, T-15.2)', function () {
  this.timeout(60000)

  // The emailed code of an operator without MFA, as a mailer would carry it.
  const mailbox: any[] = []
  let exports: string
  let system: string
  let acmeId: string
  let globexId: string

  const call = (method: string, url: string, payload?: unknown, token = system) =>
    inject({ method, url, headers: bearer(token), ...(payload === undefined ? {} : { payload }) })
  const operatorLogin = async (email: string, password: string) => {
    const res = await inject({ method: 'POST', url: '/system/auth/flow/start', payload: { method: 'password', email, password } })
    expect(res.statusCode).toBe(200)
    return body(res).token as string
  }
  const rows = async (where = '', params: unknown[] = []) =>
    (await sql().query(`select * from public.governance_log ${where} order by occurred_at, id`, params)).rows

  before(async () => {
    await setup({
      challengeDeliveryManager: {
        isImplemented: () => true,
        deliver: async (message: any) => {
          mailbox.push(message)
        }
      }
    })
    exports = await mkdtemp(path.join(os.tmpdir(), 'governance-exports-'))
    ;(global as any).config.options.export_directory = exports
    system = await systemToken()
    acmeId = (await createTenant(system, ACME)).id
    globexId = (await createTenant(system, GLOBEX)).id
  })

  after(async () => {
    await teardown()
    if (exports) await rm(exports, { recursive: true, force: true })
  })

  it('writes a row for every change of the registry, with the operator and no secret', async () => {
    expect((await call('PUT', `/tenants/${acmeId}`, { name: 'Acme Corp' })).statusCode).toBe(200)
    expect((await call('POST', `/tenants/${acmeId}/suspend`, { reason: 'unpaid' })).statusCode).toBe(200)
    expect((await call('POST', `/tenants/${acmeId}/restore`)).statusCode).toBe(200)

    const idp = `/tenants/${acmeId}/identity-providers`
    const config = { issuer: 'https://login.example.com/acme', clientId: 'client-acme', redirectUri: 'https://api.example.com/auth/flow/return/oidc' }
    expect((await call('POST', idp, { key: 'entra', type: 'oidc', config })).statusCode).toBe(201)
    expect((await call('PUT', `${idp}/entra`, { status: 'disabled' })).statusCode).toBe(200)
    expect((await call('DELETE', `${idp}/entra`)).statusCode).toBe(200)

    const operator = { email: 'ops@system.test', password: 'Ops-pw-12345678', roles: ['system:operator'] }
    const created = await call('POST', '/system/users', operator)
    expect(created.statusCode).toBe(201)
    const opId = body(created).id
    expect((await call('PUT', `/system/users/${opId}`, { firstName: 'Ops' })).statusCode).toBe(200)
    expect((await call('POST', `/system/users/${opId}/block`, { reason: 'leave' })).statusCode).toBe(200)
    expect((await call('POST', `/system/users/${opId}/unblock`)).statusCode).toBe(200)
    expect((await call('POST', `/system/users/${opId}/mfa/reset`)).statusCode).toBe(200)
    expect((await call('DELETE', `/system/users/${opId}`)).statusCode).toBe(200)

    expect((await call('PUT', '/system/account-creation', { allowed: ['invite'], default: 'invite' })).statusCode).toBe(200)
    expect((await call('DELETE', '/system/account-creation')).statusCode).toBe(200)

    const opened = await call('POST', `/tenants/${globexId}/impersonate`, { userId: GLOBEX.adminEmail, reason: 'ticket 4412' })
    expect(opened.statusCode).toBe(200)
    const { impersonationId } = body(opened)
    expect((await call('POST', '/tenants/impersonate/end', { impersonationId })).statusCode).toBe(200)
    expect((await call('DELETE', `/tenants/${globexId}`)).statusCode).toBe(200)

    const founder = (await sql().query(`select id from public.system_user where email = 'super@system.test'`)).rows[0].id
    const written = await rows(`where action <> 'tenant.created'`)
    expect(written.map((r: any) => r.action)).toEqual([
      'tenant.updated',
      'tenant.suspended',
      'tenant.restored',
      'identity_provider.created',
      'identity_provider.updated',
      'identity_provider.deleted',
      'system_user.created',
      'system_user.updated',
      'system_user.blocked',
      'system_user.unblocked',
      'system_user.mfa_reset',
      'system_user.deleted',
      'account_creation.changed',
      'account_creation.reset',
      'impersonation.started',
      'impersonation.ended',
      'tenant.deleted'
    ])
    for (const row of written) expect(row).toMatchObject({ outcome: 'success', actor_id: founder, intent_id: null })
    expect(written.find((r: any) => r.action === 'tenant.updated').detail).toEqual({ requested: ['name'] })
    expect(written.find((r: any) => r.action === 'tenant.suspended').detail).toEqual({ reason: 'unpaid' })
    expect(written.find((r: any) => r.action === 'system_user.created')).toMatchObject({ target_id: opId, detail: { roles: ['system:operator'] } })
    expect(written.find((r: any) => r.action === 'impersonation.ended')).toMatchObject({ tenant_id: globexId })
    // The operator's password and the provider's configuration never reach a row.
    expect(JSON.stringify(written)).not.toContain(operator.password)
    expect(JSON.stringify(written)).not.toContain('client-acme')
    expect((await rows(`where action = 'tenant.created'`)).map((r: any) => r.tenant_id).sort()).toEqual([acmeId, globexId].sort())
  })

  it('writes the intent of an export before it, and the outcome after', async () => {
    const res = await call('POST', `/tenants/${acmeId}/export`)
    expect(res.statusCode).toBe(200)
    const [intent, success] = await rows(`where action = 'tenant.exported'`)
    expect(intent).toMatchObject({ outcome: 'intent', tenant_id: acmeId, intent_id: null })
    expect(success).toMatchObject({ outcome: 'success', tenant_id: acmeId, intent_id: intent.id })
    expect(success.detail).toMatchObject({ path: body(res).path, bytes: body(res).bytes })
  })

  it('keeps the rows of a tenant once its container is destroyed', async () => {
    const asked = await call('POST', `/tenants/${acmeId}/destruction-request`)
    expect(asked.statusCode).toBe(200)
    const { token } = body(asked)
    const otp = mailbox.at(-1).code
    const destroyed = await call('DELETE', `/tenants/${acmeId}/data`, { token, slug: ACME.slug, otp })
    expect(destroyed.statusCode).toBe(200)

    const schemas = await sql().query(`select 1 from information_schema.schemata where schema_name = $1`, [ACME.locator])
    expect(schemas.rows).toEqual([])

    const [request] = await rows(`where action = 'tenant.destruction_requested'`)
    expect(request.detail).toMatchObject({ requestId: body(asked).requestId, factor: 'email-otp' })
    const [intent, success] = await rows(`where action = 'tenant.destroyed'`)
    expect(intent).toMatchObject({ outcome: 'intent', tenant_id: acmeId })
    expect(success).toMatchObject({ outcome: 'success', tenant_id: acmeId, intent_id: intent.id })
    expect(success.detail).toMatchObject({ requestId: body(asked).requestId })
    expect(success.detail.exportRef).toBeTruthy()

    // Everything the platform did to the tenant, from creation to destruction, still there.
    const history = (await rows('where tenant_id = $1', [acmeId])).map((r: any) => r.action)
    expect(history[0]).toBe('tenant.created')
    expect(history.at(-1)).toBe('tenant.destroyed')
    expect(new Set((await rows()).map((r: any) => r.action))).toEqual(new Set(ACTIONS))
  })

  it('answers an auditor, by tenant and by action, and refuses an operator without the capability', async () => {
    for (const [email, roles] of [
      ['audit@system.test', ['system:auditor']],
      ['ops2@system.test', ['system:operator']]
    ] as const) {
      expect((await call('POST', '/system/users', { email, password: 'Audit-pw-12345', roles })).statusCode).toBe(201)
    }
    const auditor = await operatorLogin('audit@system.test', 'Audit-pw-12345')
    const operator = await operatorLogin('ops2@system.test', 'Audit-pw-12345')

    const found = await call('GET', `/system/governance-log?tenantId=${acmeId}&action=tenant.destroyed`, undefined, auditor)
    expect(found.statusCode).toBe(200)
    expect(body(found).map((r: any) => r.outcome)).toEqual(['intent', 'success'])
    const count = await call('GET', `/system/governance-log/count?tenantId=${acmeId}`, undefined, auditor)
    expect(body(count)).toBe((await rows('where tenant_id = $1', [acmeId])).length)

    for (const url of ['/system/governance-log', '/system/governance-log/count']) {
      expect((await call('GET', url, undefined, operator)).statusCode).toBe(403)
    }
  })
})
