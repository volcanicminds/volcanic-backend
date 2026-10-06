/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-6.3: destroying a customer's data, in two phases.
//
// This is the one operation the framework cannot undo, so the tests are almost entirely about
// what it REFUSES. A destruction that works is one line; a destruction that cannot be
// triggered by a stale token, a mistyped slug, a borrowed permission, a missing second factor
// or a failed export is the whole feature.
//
import { expect } from 'expect'
import fastify from 'fastify'
import { destructionRequest, destroyData, restore } from '../../lib/api/tenants/controller/tenants.js'
import { hashToken } from '../../lib/database/managers/destruction.js'
import { challengeMac } from '../../lib/database/managers/authFlow.js'
import { getData, getParams } from '../../lib/util/common.js'
import { fakeGovernanceLog } from './fixtures/governanceLog.js'

;(global as any).log = {}

const ACME: any = { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme', schemaVersion: '0001_init' }
const ACTOR: any = { id: 'sys-1', externalId: 'sys-ext-1', email: 'root@system.test', mfaEnabled: true, mfaLastUsedCounter: null }

function fakes(over: any = {}) {
  const requests = new Map<string, any>()
  const dropped: string[] = []
  const exported: any[] = []
  const steps: string[] = []
  const deliveries: any[] = []
  const marked: string[] = []
  const idps = [
    { tenantId: ACME.id, key: 'entra' },
    { tenantId: ACME.id, key: 'okta' },
    { tenantId: 'id-other', key: 'entra' }
  ]

  return {
    requests,
    dropped,
    exported,
    steps,
    idps,
    deliveries,
    marked,
    governanceLogManager: fakeGovernanceLog(),
    destructionManager: {
      isImplemented: () => true,
      openRequest: async (_c: any, data: any) => {
        // Mirrors the real manager: the token is hashed and dropped, never carried into the
        // stored row. A fake that keeps it would let the assertion below pass on code that
        // stores the token.
        const { token, code, ...rest } = data
        const record = {
          id: `req-${requests.size + 1}`,
          ...rest,
          tokenHash: hashToken(token),
          codeHash: code ? challengeMac(token, code) : null,
          codeAttempts: 0,
          consumedAt: null,
          createdAt: new Date()
        }
        requests.set(record.id, record)
        return record
      },
      findLiveRequest: async (_c: any, tenantId: string, token: string) =>
        [...requests.values()].find(
          (r) =>
            r.tenantId === tenantId &&
            r.tokenHash === hashToken(token) &&
            !r.consumedAt &&
            new Date(r.expiresAt).getTime() > Date.now()
        ) ?? null,
      checkCode: async (_c: any, id: string, input: any) => {
        const r = requests.get(id)
        if (!r || r.consumedAt || !r.codeHash || r.tokenHash !== hashToken(input.token) || r.codeAttempts >= input.maxAttempts) {
          return { ok: false, remaining: 0 }
        }
        r.codeAttempts += 1
        return { ok: r.codeHash === challengeMac(input.token, input.code), remaining: input.maxAttempts - r.codeAttempts }
      },
      consumeRequest: async (_c: any, id: string, exportRef: string) => {
        const r = requests.get(id)
        if (!r || r.consumedAt) return null
        r.consumedAt = new Date()
        r.exportRef = exportRef
        return r
      }
    },
    tenantManager: {
      isImplemented: () => true,
      getTenant: async (_c: any, id: string) => {
        if (over.missingTenant || id !== ACME.id) return null
        return over.destroyedTenant || marked.includes(id) ? { ...ACME, status: 'destroyed' } : ACME
      },
      markTenantDestroyed: async (_c: any, id: string) => {
        steps.push('markTenantDestroyed')
        marked.push(id)
        return true
      },
      // Mirrors the real manager: a destroyed row is left alone, and the answer is "unchanged".
      restoreTenant: async (_c: any, id: string) =>
        !over.missingTenant && id === ACME.id && !(over.destroyedTenant || marked.includes(id))
    },
    provider: {
      inspectContainer: async () => ({
        locator: ACME.locator,
        sizeBytes: 4096,
        rowCounts: { user: 3, widget: 17 },
        schemaVersion: '0001_init'
      }),
      exportContainer: async () => {
        if (over.exportFails) throw new Error('pg_dump is not available')
        const result = { path: '/tmp/acme-0001_init.sql', bytes: over.emptyExport ? 0 : 2048, schemaVersion: '0001_init' }
        exported.push(result)
        return result
      },
      dropContainer: async (locator: string) => {
        steps.push('dropContainer')
        dropped.push(locator)
      }
    },
    identityProviderManager: {
      isImplemented: () => !over.noIdentityProviders,
      removeAll: async (_c: any, tenantId: string) => {
        steps.push('removeAll')
        const before = idps.length
        idps.splice(0, idps.length, ...idps.filter((p) => p.tenantId !== tenantId))
        return before - idps.length
      }
    },
    challengeDeliveryManager: {
      isImplemented: () => over.delivery !== false,
      deliver: async (message: any) => {
        if (over.deliveryFails) throw new Error('SMTP refused')
        deliveries.push(message)
      }
    },
    mfaManager: {
      isImplemented: () => true,
      // A verifier answers with a DELTA: how many steps away from now the accepted code was,
      // which is zero for a code typed in its own window. The fixture used to answer `42`, a
      // number no verifier returns, and that is what let the replay check pass while comparing
      // the wrong two things (T-10.21).
      verify: async (code: string) => (code === '123456' ? 0 : null)
    },
    systemUserManager: {
      isImplemented: () => true,
      retrieveMfaSecret: async () => (over.noSecret ? null : 'JBSWY3DPEHPK3PXP'),
      recordMfaCounter: async (_c: any, _id: string, counter: number) => {
        ACTOR.mfaLastUsedCounter = counter
        return true
      }
    }
  }
}

async function build(over: any = {}) {
  ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' }, export_directory: '/tmp' } }
  ;(global as any).authFlows = { limits: { otpMaxAttempts: 5 } }
  const f = fakes(over)

  const server: any = fastify()
  for (const [name, value] of Object.entries(f)) {
    if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof Map)) server.decorate(name, value)
  }
  // A build that cannot destroy: either the manager is absent or the data layer cannot drop a
  // container. Both are the deployment's shape, not the caller's mistake.
  if (over.noDestructionManager) {
    server.destructionManager.isImplemented = () => false
  }
  if (over.noDropSupport) {
    delete (server.provider as any).dropContainer
    delete (server.provider as any).inspectContainer
  }
  server.decorate('migrations', { version: async () => '0001_init' })

  server.addHook('onRequest', async (req: any) => {
    req.data = () => getData(req)
    req.parameters = () => getParams(req)
    req.control = { kind: 'control' }
    if (over.anonymousActor !== true) req.systemUser = over.actor ?? ACTOR
  })

  server.post('/tenants/:id/destruction-request', { config: { tenantContext: false } }, destructionRequest)
  server.delete('/tenants/:id/data', { config: { tenantContext: false } }, destroyData)
  server.post('/tenants/:id/restore', { config: { tenantContext: false } }, restore)
  await server.ready()
  return { server, ...f }
}

const ask = (server: any, id = ACME.id) =>
  server.inject({ method: 'POST', url: `/tenants/${id}/destruction-request`, payload: {} })

const destroy = (server: any, payload: any, id = ACME.id) =>
  server.inject({ method: 'DELETE', url: `/tenants/${id}/data`, payload })

describe('destruction · phase 1, what would be lost (T-6.3)', () => {
  beforeEach(() => {
    ACTOR.mfaEnabled = true
    ACTOR.mfaLastUsedCounter = null
  })
  afterEach(() => {
    ;(global as any).config = undefined
  })

  it('counts what is in the container, and says the backups keep it anyway', async () => {
    const { server } = await build()
    const res = await ask(server)
    const body = JSON.parse(res.body)

    expect(res.statusCode).toBe(200)
    // An operator about to lose a customer's data should see it counted, not estimated.
    expect(body.preview.rowCounts).toEqual({ user: 3, widget: 17 })
    expect(body.preview.sizeBytes).toBe(4096)
    // The one promise this operation cannot make, made explicit in the response itself.
    expect(body.warning).toMatch(/backup/i)
    await server.close()
  })

  it('returns the token once, and stores only its hash', async () => {
    const { server, requests } = await build()
    const body = JSON.parse((await ask(server)).body)

    expect(typeof body.token).toBe('string')
    const stored = [...requests.values()][0]
    // A leaked control plane leaks nothing that can destroy anything: the only copy of the
    // token went out in this response.
    expect(stored.token).toBe(undefined)
    expect(stored.tokenHash).toBe(hashToken(body.token))
    await server.close()
  })

  it('gives it ten minutes', async () => {
    const { server } = await build()
    const body = JSON.parse((await ask(server)).body)
    const minutes = (new Date(body.expiresAt).getTime() - Date.now()) / 60000
    expect(minutes).toBeGreaterThan(9)
    expect(minutes).toBeLessThanOrEqual(10)
    await server.close()
  })

  it('refuses a caller with no platform identity', async () => {
    const { server } = await build({ anonymousActor: true })
    expect((await ask(server)).statusCode).toBe(403)
    await server.close()
  })
})

describe('destruction · phase 2, every way it says no (T-6.3)', () => {
  it('answers 503 DESTRUCTION_NOT_AVAILABLE when the build cannot destroy', async () => {
    // 503 and not 403: the operator has the permission and typed everything right, the
    // deployment simply cannot do it. Answering 403 would send them looking for a missing
    // capability that is not the problem.
    for (const shape of [{ noDestructionManager: true }, { noDropSupport: true }]) {
      const { server } = await build(shape)

      const asked = await ask(server)
      expect(asked.statusCode).toBe(503)
      expect(JSON.parse(asked.body).code).toBe('DESTRUCTION_NOT_AVAILABLE')

      const attempted = await destroy(server, { token: 'anything', slug: 'acme', otp: '123456' })
      expect(attempted.statusCode).toBe(503)
      expect(JSON.parse(attempted.body).code).toBe('DESTRUCTION_NOT_AVAILABLE')
      await server.close()
    }
  })

  beforeEach(() => {
    ACTOR.mfaEnabled = true
    ACTOR.mfaLastUsedCounter = null
  })
  afterEach(() => {
    ;(global as any).config = undefined
  })

  const open = async (over: any = {}) => {
    const ctx = await build(over)
    const body = JSON.parse((await ask(ctx.server)).body)
    return { ...ctx, token: body.token }
  }

  it('destroys, after exporting first', async () => {
    const { server, token, dropped, exported, requests } = await open()
    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).destroyed).toBe(true)
    // The export ran, produced a file, and its reference is on the record: no export, no
    // destruction, and no record without the reference.
    expect(exported.length).toBe(1)
    expect(dropped).toEqual([ACME.locator])
    expect([...requests.values()][0].exportRef).toBe('/tmp/acme-0001_init.sql')
    await server.close()
  })

  it("removes the tenant's identity providers, its own only, before the container", async () => {
    const { server, token, idps, steps } = await open()
    expect((await destroy(server, { token, slug: 'acme', otp: '123456' })).statusCode).toBe(200)

    // Each one carries a client secret of the customer's, in the control plane, where dropping
    // the container does not reach.
    expect(idps).toEqual([{ tenantId: 'id-other', key: 'entra' }])
    expect(steps).toEqual(['removeAll', 'dropContainer', 'markTenantDestroyed'])
    await server.close()
  })

  it('destroys without an identity provider manager', async () => {
    const { server, token, idps, dropped } = await open({ noIdentityProviders: true })
    expect((await destroy(server, { token, slug: 'acme', otp: '123456' })).statusCode).toBe(200)
    expect(dropped).toEqual([ACME.locator])
    expect(idps.length).toBe(3)
    await server.close()
  })

  it('writes the record before the data goes', async () => {
    const { server, token, requests } = await open()
    await destroy(server, { token, slug: 'acme', otp: '123456' })
    const record = [...requests.values()][0]
    // Afterwards there may be nothing left to write with.
    expect(record.consumedAt).toBeTruthy()
    await server.close()
  })

  it('refuses a token that was already spent', async () => {
    const { server, token, requests, dropped } = await open()
    // Spent by a call that stopped after writing the record, on a tenant still standing.
    for (const r of requests.values()) r.consumedAt = new Date()

    const again = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(again.statusCode).toBe(403)
    expect(JSON.parse(again.body).code).toBe('DESTRUCTION_TOKEN_INVALID')
    expect(dropped).toEqual([])
    await server.close()
  })

  it('answers alreadyDestroyed to the same call made twice, and drops once', async () => {
    const { server, token, dropped, marked } = await open()
    expect((await destroy(server, { token, slug: 'acme', otp: '123456' })).statusCode).toBe(200)
    expect(marked).toEqual([ACME.id])

    const again = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(again.statusCode).toBe(200)
    expect(JSON.parse(again.body).alreadyDestroyed).toBe(true)
    expect(dropped).toEqual([ACME.locator])
    await server.close()
  })

  it('refuses to restore a destroyed tenant, or to ask for its destruction again', async () => {
    const { server } = await build({ destroyedTenant: true })
    const restored = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/restore`, payload: {} })
    // `active` would resolve requests into a container that no longer exists.
    expect(restored.statusCode).toBe(409)
    expect(JSON.parse(restored.body).code).toBe('TENANT_DESTROYED')

    const asked = await ask(server)
    expect(asked.statusCode).toBe(409)
    expect(JSON.parse(asked.body).code).toBe('TENANT_DESTROYED')
    await server.close()
  })

  it('still answers 404 to restoring a tenant that does not exist', async () => {
    const { server } = await build({ missingTenant: true })
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/restore`, payload: {} })
    expect(res.statusCode).toBe(404)
    await server.close()
  })

  it('refuses a token that expired', async () => {
    const { server, token, requests } = await open()
    for (const r of requests.values()) r.expiresAt = new Date(Date.now() - 1000)

    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(res.statusCode).toBe(403)
    await server.close()
  })

  it('refuses a token that belongs to another operator', async () => {
    const { server, token, requests } = await open()
    for (const r of requests.values()) r.systemUserId = 'sys-someone-else'

    // Handing the token to a colleague is how a two-person control becomes one person with
    // two windows open.
    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('DESTRUCTION_TOKEN_INVALID')
    await server.close()
  })

  it('refuses a slug that does not match', async () => {
    const { server, token, dropped } = await open()
    const res = await destroy(server, { token, slug: 'globex', otp: '123456' })

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).code).toBe('DESTRUCTION_SLUG_MISMATCH')
    expect(dropped).toEqual([])
    await server.close()
  })

  it('refuses a wrong code, and a replayed one', async () => {
    const { server, token, dropped } = await open()
    const wrong = await destroy(server, { token, slug: 'acme', otp: '000000' })
    expect(wrong.statusCode).toBe(403)
    expect(JSON.parse(wrong.body).code).toBe('DESTRUCTION_OTP_INVALID')
    // A TOTP has no attempt count of its own to report.
    expect(JSON.parse(wrong.body).remaining).toBeUndefined()

    // The step is spent by the first use, so the same code cannot destroy a second container.
    //
    // The value is a STEP, not a delta. The fixture said `42` and passed for the wrong reason:
    // the code compared the verifier's delta against it, and 0 was always smaller. Now that all
    // three call sites store what `lib/util/mfaCounter.ts` computes, a spent step is the step a
    // current code belongs to (T-10.21, found by destroying a container from a live console).
    ACTOR.mfaLastUsedCounter = Math.floor(Date.now() / 1000 / 30)
    const replayed = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(replayed.statusCode).toBe(403)
    expect(dropped).toEqual([])
    await server.close()
  })

  it('refuses a TOTP request once the operator has no MFA left', async () => {
    const { server, token, dropped } = await open()
    ACTOR.mfaEnabled = false

    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('DESTRUCTION_OTP_INVALID')
    expect(JSON.parse(res.body).message).toMatch(/again/)
    expect(dropped).toEqual([])
    await server.close()
  })

  it('does not destroy anything when the export fails', async () => {
    const { server, token, dropped, steps } = await open({ exportFails: true })
    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('DESTRUCTION_EXPORT_FAILED')
    // No export, no destruction. Decision 2 of EVO_PUNTI_APERTI.
    expect(dropped).toEqual([])
    expect(steps).toEqual([])
    await server.close()
  })

  it('does not export nor drop anything when the intent cannot be written (F76)', async () => {
    const { server, token, exported, dropped, steps, governanceLogManager } = await open()
    governanceLogManager.record = async () => {
      throw new Error('the control plane is gone')
    }
    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })

    expect(res.statusCode).toBe(500)
    expect(exported).toEqual([])
    expect(dropped).toEqual([])
    expect(steps).toEqual([])
    await server.close()
  })

  it('closes the intent with the failure when the export fails, naming no message', async () => {
    const { server, token, governanceLogManager } = await open({ exportFails: true })
    expect((await destroy(server, { token, slug: 'acme', otp: '123456' })).statusCode).toBe(409)

    const rows = governanceLogManager.rows.filter((r) => r.action === 'tenant.destroyed')
    expect(rows.map((r) => r.outcome)).toEqual(['intent', 'failure'])
    expect(rows[1]).toMatchObject({ intentId: rows[0].id, tenantId: ACME.id, detail: { reason: 'DESTRUCTION_EXPORT_FAILED' } })
    // The tool's message may carry a connection string: the row keeps a code.
    expect(JSON.stringify(rows)).not.toContain('pg_dump')
    await server.close()
  })

  it('closes the intent with the success, carrying the request and the export', async () => {
    const { server, token, governanceLogManager } = await open()
    expect((await destroy(server, { token, slug: 'acme', otp: '123456' })).statusCode).toBe(200)

    const [requested, intent, success] = governanceLogManager.rows
    expect(requested).toMatchObject({ action: 'tenant.destruction_requested', outcome: 'success', detail: { factor: 'totp' } })
    expect(intent).toMatchObject({ action: 'tenant.destroyed', outcome: 'intent', detail: { requestId: requested.detail?.requestId } })
    expect(success).toMatchObject({
      action: 'tenant.destroyed',
      outcome: 'success',
      intentId: intent.id,
      detail: { requestId: requested.detail?.requestId, exportRef: '/tmp/acme-0001_init.sql', identityProviders: 2 }
    })
    await server.close()
  })

  it('does not accept an empty export as an export', async () => {
    const { server, token, dropped } = await open({ emptyExport: true })
    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })

    expect(res.statusCode).toBe(409)
    expect(dropped).toEqual([])
    await server.close()
  })

  it('asks for all three parts of the body', async () => {
    const { server, token } = await open()
    for (const payload of [{ token }, { slug: 'acme' }, { token, slug: 'acme' }]) {
      const res = await destroy(server, payload)
      expect(res.statusCode).toBe(400)
    }
    await server.close()
  })

  it('answers without an error when there is nothing left to destroy', async () => {
    const { server } = await build({ missingTenant: true })
    const res = await destroy(server, { token: 'whatever', slug: 'acme', otp: '123456' })

    // Idempotent: the second caller is told so instead of being handed an error to interpret.
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).alreadyDestroyed).toBe(true)
    await server.close()
  })
})

describe('destruction · the emailed code of an operator without MFA (§6.2)', () => {
  beforeEach(() => {
    ACTOR.mfaEnabled = false
    ACTOR.mfaLastUsedCounter = null
  })
  afterEach(() => {
    ACTOR.mfaEnabled = true
    ;(global as any).config = undefined
  })

  const open = async (over: any = {}) => {
    const ctx = await build(over)
    const res = await ask(ctx.server)
    return { ...ctx, res, body: JSON.parse(res.body) }
  }

  it('sends the code to the address on file, worded as a destruction, and stores it bound to the token', async () => {
    const { server, body, deliveries, requests } = await open()

    expect(body.factor).toEqual({ method: 'email-otp', destination: 'r***@s***.test' })
    expect(deliveries).toHaveLength(1)
    const [sent] = deliveries
    expect(sent).toMatchObject({
      channel: 'email',
      to: ACTOR.email,
      purpose: 'destruction',
      plane: 'control',
      tenantId: ACME.id,
      subjectId: ACTOR.externalId
    })
    expect(sent.code).toMatch(/^\d{6}$/)
    // The code is in the email and nowhere else: not in the response, not in the row.
    expect(JSON.stringify(body)).not.toContain(sent.code)
    const stored = [...requests.values()][0]
    expect(stored.codeHash).toBe(challengeMac(body.token, sent.code))
    expect(JSON.stringify(stored)).not.toContain(sent.code)
    await server.close()
  })

  it('asks an operator with MFA for the TOTP, and sends nothing', async () => {
    ACTOR.mfaEnabled = true
    const { server, body, deliveries } = await open()
    expect(body.factor).toEqual({ method: 'totp' })
    expect(deliveries).toEqual([])
    await server.close()
  })

  it('destroys with the emailed code, and not with a TOTP', async () => {
    const { server, body, deliveries, dropped } = await open()

    // The request was opened for the emailed code: a valid TOTP is not the factor it asked for.
    const totp = await destroy(server, { token: body.token, slug: 'acme', otp: '123456' })
    expect(totp.statusCode).toBe(403)
    expect(JSON.parse(totp.body).code).toBe('DESTRUCTION_OTP_INVALID')

    const res = await destroy(server, { token: body.token, slug: 'acme', otp: deliveries[0].code })
    expect(res.statusCode).toBe(200)
    expect(dropped).toEqual([ACME.locator])
    await server.close()
  })

  it('counts the wrong codes, and past the last one refuses the right one', async () => {
    const { server, body, deliveries, dropped } = await open()
    const wrong = deliveries[0].code === '000000' ? '000001' : '000000'

    const first = await destroy(server, { token: body.token, slug: 'acme', otp: wrong })
    expect(first.statusCode).toBe(403)
    expect(JSON.parse(first.body).code).toBe('DESTRUCTION_OTP_INVALID')
    expect(JSON.parse(first.body).message).toMatch(/4 attempt/)
    // The count is data, as on a login: the console words it from here, not from the message.
    expect(JSON.parse(first.body).remaining).toBe(4)
    for (let i = 0; i < 4; i++) await destroy(server, { token: body.token, slug: 'acme', otp: wrong })

    const right = await destroy(server, { token: body.token, slug: 'acme', otp: deliveries[0].code })
    expect(right.statusCode).toBe(403)
    expect(JSON.parse(right.body).message).toMatch(/again/)
    expect(JSON.parse(right.body).remaining).toBe(0)
    expect(dropped).toEqual([])
    await server.close()
  })

  it('answers 503 DESTRUCTION_FACTOR_NOT_AVAILABLE, before any token, when no code can reach the operator', async () => {
    for (const shape of [{ delivery: false }, { deliveryFails: true }]) {
      const { server, res, body, requests } = await open(shape)
      expect(res.statusCode).toBe(503)
      expect(body.code).toBe('DESTRUCTION_FACTOR_NOT_AVAILABLE')
      // A permission phase 2 could never accept is not handed out.
      expect(body.token).toBe(undefined)
      if (shape.delivery === false) expect(requests.size).toBe(0)
      await server.close()
    }
  })

  it('answers 503 as well to an operator without an address on file', async () => {
    const { email } = ACTOR
    delete ACTOR.email
    try {
      const { server, res } = await open()
      expect(res.statusCode).toBe(503)
      await server.close()
    } finally {
      ACTOR.email = email
    }
  })
})
