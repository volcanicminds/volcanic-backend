/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The governance log over HTTP on real Postgres: every governance route leaves its
// row, an export and a destruction write their intent before the effect and their outcome after,
// the rows of a tenant stay once its container is gone, and only a holder of `governance-log`
// reads them. What the rows say is checked from outside too, with plain `pg`.
//
import fs from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import { advisoryKey } from '../../lib/database/adapters/postgres/index.js'
import { runnerFor } from '../../lib/loader/schedules.js'
import * as retention from '../../lib/schedules/exportRetention.job.js'
import { setup, teardown, inject, app, systemToken, createTenant, login, staled, sql, bearer, ACME, GLOBEX } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const TWIN = { slug: 'acme-twin', locator: 'tenant_acme_twin' }
// Where an import would land if an operator were let through; dropped after, should a defect let one through.
const OPS_COPY = { slug: 'acme-ops', locator: 'tenant_acme_ops' }
// The profile an export has to name; the operator's is the one that restores.
const OPERATOR = { profile: 'operator' }

const ACTIONS = [
  'tenant.created',
  'tenant.updated',
  'tenant.suspended',
  'tenant.restored',
  'tenant.deleted',
  'tenant.exported',
  'tenant.downloaded',
  'tenant.export_expired',
  'tenant.imported',
  'tenant.moved',
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
  // The outcome of a download is written when the stream ends, after the answer: waited for, not assumed.
  const settled = async (where: string, count: number) => {
    for (let i = 0; i < 50 && (await rows(where)).length < count; i++) await new Promise((resolve) => setTimeout(resolve, 20))
    return rows(where)
  }
  const asAdmin = async () => bearer(await login(ACME.slug, ACME.adminEmail, ACME.adminPassword), ACME.slug)
  // The packages of Acme's two slots, as the tests below leave them.
  let ownPackage: string
  let operatorPackage: string

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
    for (const locator of [TWIN.locator, OPS_COPY.locator]) await sql().query(`drop schema if exists "${locator}" cascade`)
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
    const res = await call('POST', `/tenants/${acmeId}/exports`, OPERATOR)
    expect(res.statusCode).toBe(200)
    const [intent, success] = await rows(`where action = 'tenant.exported'`)
    expect(intent).toMatchObject({ outcome: 'intent', tenant_id: acmeId, intent_id: null, actor_kind: 'system_user', detail: { profile: 'operator', slot: 'control' } })
    expect(success).toMatchObject({ outcome: 'success', tenant_id: acmeId, intent_id: intent.id, actor_kind: 'system_user' })
    // The path stays in the log, for whoever looks the package up on the machine; the response names only the package.
    const { package: name, manifestSha256, bytes } = body(res)
    expect(success.detail).toMatchObject({ path: path.join(exports, name), package: name, manifestSha256, bytes, slot: 'control', replaced: [] })
    expect(body(res).path).toBeUndefined()
  })

  it('writes the restore of a package and the move of a tenant, with the package and its hash', async () => {
    const { package: name, manifestSha256 } = body(await call('POST', `/tenants/${acmeId}/exports`, OPERATOR))
    const restored = await call('POST', '/tenants/import', { package: name, ...TWIN, founderPassword: 'Twin-pw-1234567' })
    expect(restored.statusCode).toBe(201)
    const twinId = body(restored).id
    const [imported] = await rows(`where action = 'tenant.imported'`)
    expect(imported).toMatchObject({ outcome: 'success', tenant_id: twinId, detail: { sourceTenantId: acmeId, package: name, manifestSha256 } })
    expect(JSON.stringify(imported)).not.toContain('Twin-pw-1234567')

    const out = body(await call('POST', `/tenants/${twinId}/exports`, OPERATOR))
    expect((await call('POST', `/tenants/${twinId}/move`, { destination: 'eu-west-2', package: out.package })).statusCode).toBe(200)
    const [moved] = await rows(`where action = 'tenant.moved'`)
    expect(moved).toMatchObject({
      outcome: 'success',
      tenant_id: twinId,
      detail: { destination: 'eu-west-2', package: out.package, manifestSha256: out.manifestSha256 }
    })
  })

  it("lets the tenant's admin export and download its own tenant, not the operator's package, and records each download (T-17.11)", async () => {
    const headers = await asAdmin()
    // The tenant is the token's: a body naming another one changes nothing.
    const own = await inject({ method: 'POST', url: '/exports', headers, payload: { tenantId: globexId } })
    expect([own.statusCode, own.statusCode === 200 || own.body]).toEqual([200, true])
    expect(body(own)).toMatchObject({ tenant: { id: acmeId, slug: ACME.slug }, profile: 'client' })
    ownPackage = body(own).package
    const fetched = await inject({ method: 'GET', url: `/exports/${ownPackage}?tenantId=${globexId}`, headers })
    expect([fetched.statusCode, fetched.statusCode === 200 || fetched.body]).toEqual([200, true])
    expect(fetched.rawPayload.includes(Buffer.from('envelope.json'))).toBe(false)

    operatorPackage = body(await call('POST', `/tenants/${acmeId}/exports`, OPERATOR)).package
    expect((await inject({ method: 'GET', url: `/exports/${operatorPackage}`, headers })).statusCode).toBe(404)
    const whole = await call('GET', `/tenants/${acmeId}/exports/${operatorPackage}`)
    expect(whole.statusCode).toBe(200)

    const adminId = String((await sql().query(`select id from "${ACME.locator}"."user" where email = $1`, [ACME.adminEmail])).rows[0].id)
    const founder = (await sql().query(`select id from public.system_user where email = 'super@system.test'`)).rows[0].id
    const [exported] = await rows(`where action = 'tenant.exported' and actor_kind = 'user'`)
    expect(exported).toMatchObject({ outcome: 'intent', tenant_id: acmeId, actor_id: adminId, detail: { profile: 'client', slot: 'tenant' } })

    const downloads = await settled(`where action = 'tenant.downloaded'`, 4)
    const of = (kind: string) => downloads.filter((r: any) => r.actor_kind === kind)
    expect(of('user')).toMatchObject([
      { outcome: 'intent', tenant_id: acmeId, actor_id: adminId, detail: { package: ownPackage, manifestSha256: body(own).manifestSha256, profile: 'client' } },
      { outcome: 'success', tenant_id: acmeId, actor_id: adminId, detail: { package: ownPackage, bytes: fetched.rawPayload.length } }
    ])
    expect(of('system_user')).toMatchObject([
      { outcome: 'intent', actor_id: founder, detail: { package: operatorPackage, profile: 'operator' } },
      { outcome: 'success', actor_id: founder, detail: { bytes: whole.rawPayload.length } }
    ])
    expect(of('user')[1].intent_id).toBe(of('user')[0].id)
  })

  it('refuses a tenant role other than admin, and a session not confirmed lately, on both planes (T-17.11)', async () => {
    const headers = await asAdmin()
    const member = { email: 'member@acme.test', password: 'Member-pw-12345' }
    expect((await inject({ method: 'POST', url: '/users', headers, payload: member })).statusCode).toBe(200)
    await sql().query(`update "${ACME.locator}"."user" set confirmed = true where email = $1`, [member.email])
    const user = await login(ACME.slug, member.email, member.password)
    const stale = staled(headers.authorization.slice('Bearer '.length)).token

    for (const [method, url] of [
      ['POST', '/exports'],
      ['GET', `/exports/${ownPackage}`]
    ]) {
      const refused = await inject({ method, url, headers: bearer(user, ACME.slug) })
      expect([refused.statusCode, body(refused).code]).toEqual([403, 'FORBIDDEN'])
      const unconfirmed = await inject({ method, url, headers: bearer(stale, ACME.slug) })
      expect([unconfirmed.statusCode, body(unconfirmed).code]).toEqual([403, 'STEP_UP_REQUIRED'])
    }
    const staleSystem = staled(system).token
    for (const [method, url, payload] of [
      ['POST', `/tenants/${acmeId}/exports`, OPERATOR],
      ['GET', `/tenants/${acmeId}/exports/${operatorPackage}`, undefined]
    ] as const) {
      const res = await call(method, url, payload, staleSystem)
      expect([res.statusCode, body(res).code]).toEqual([403, 'STEP_UP_REQUIRED'])
    }
  })

  it('gives the export, the download, the import and the move to system:admin alone, not to an operator holding tenants (T-17.11)', async () => {
    const email = 'ops3@system.test'
    const password = 'Ops3-pw-12345678'
    expect((await call('POST', '/system/users', { email, password, roles: ['system:operator'] })).statusCode).toBe(201)
    const operator = await operatorLogin(email, password)
    // The same operator reads the tenant: what is refused is these four routes, not the operator.
    expect((await call('GET', `/tenants/${acmeId}`, undefined, operator)).statusCode).toBe(200)
    for (const [method, url, payload] of [
      ['POST', `/tenants/${acmeId}/exports`, OPERATOR],
      ['GET', `/tenants/${acmeId}/exports/${operatorPackage}`, undefined],
      ['POST', '/tenants/import', { package: operatorPackage, ...OPS_COPY, founderPassword: 'Copy-pw-12345678' }],
      ['POST', `/tenants/${acmeId}/move`, { destination: 'eu-west-3', package: operatorPackage }]
    ] as const) {
      const res = await call(method, url, payload, operator)
      expect([res.statusCode, body(res).code]).toEqual([403, 'FORBIDDEN'])
    }
  })

  it('answers 409 while another session holds the slot, on the advisory lock of Postgres (T-17.11)', async () => {
    const headers = await asAdmin()
    const holder = await sql().connect()
    try {
      await holder.query('select pg_advisory_lock($1)', [advisoryKey(`export:${acmeId}:tenant`)])
      const res = await inject({ method: 'POST', url: '/exports', headers })
      expect([res.statusCode, body(res).code]).toEqual([409, 'EXPORT_IN_PROGRESS'])
    } finally {
      await holder.query('select pg_advisory_unlock_all()')
      holder.release()
    }
  })

  it('stops the tenant plane at its quota with Retry-After, and never the operator (T-17.11)', async () => {
    const used = (await rows(`where action = 'tenant.exported' and outcome = 'intent' and actor_kind = 'user'`)).length
    process.env.TENANT_EXPORT_MAX = String(used + 1)
    try {
      const headers = await asAdmin()
      const allowed = await inject({ method: 'POST', url: '/exports', headers })
      expect(allowed.statusCode).toBe(200)
      ownPackage = body(allowed).package
      const refused = await inject({ method: 'POST', url: '/exports', headers })
      expect([refused.statusCode, body(refused).code]).toEqual([429, 'EXPORT_QUOTA_EXCEEDED'])
      expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0)
      const operator = await call('POST', `/tenants/${acmeId}/exports`, OPERATOR)
      expect(operator.statusCode).toBe(200)
      operatorPackage = body(operator).package
    } finally {
      delete process.env.TENANT_EXPORT_MAX
    }
  })

  it('expires the packages of the slots older than the retention through the real job, an event each (T-17.11)', async () => {
    const file = path.join(exports, ownPackage, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...manifest, createdAt: new Date(Date.now() - 8 * 86_400_000).toISOString() }))
    process.env.TENANT_EXPORT_RETENTION_DAYS = '7'
    try {
      await runnerFor(app(), 'exportRetention', retention.schedule, retention.job, new AbortController().signal)()
    } finally {
      delete process.env.TENANT_EXPORT_RETENTION_DAYS
    }
    expect(fs.existsSync(path.join(exports, ownPackage))).toBe(false)
    expect(fs.existsSync(path.join(exports, operatorPackage))).toBe(true)
    const [intent, success] = await rows(`where action = 'tenant.export_expired'`)
    expect(intent).toMatchObject({
      outcome: 'intent',
      tenant_id: acmeId,
      actor_id: null,
      actor_kind: null,
      ip: null,
      detail: { package: ownPackage, slot: 'tenant' }
    })
    expect(success).toMatchObject({ outcome: 'success', intent_id: intent.id, detail: { package: ownPackage } })
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
