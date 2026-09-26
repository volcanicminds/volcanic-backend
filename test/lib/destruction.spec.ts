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
import { destructionRequest, destroyData } from '../../lib/api/tenants/controller/tenants.js'
import { hashToken } from '../../lib/database/managers/destruction.js'
import { getData, getParams } from '../../lib/util/common.js'

;(global as any).log = {}

const ACME: any = { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme', schemaVersion: '0001_init' }
const ACTOR: any = { id: 'sys-1', email: 'root@system.test', mfaEnabled: true, mfaLastUsedCounter: null }

function fakes(over: any = {}) {
  const requests = new Map<string, any>()
  const dropped: string[] = []
  const exported: any[] = []
  const steps: string[] = []
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
    destructionManager: {
      isImplemented: () => true,
      openRequest: async (_c: any, data: any) => {
        // Mirrors the real manager: the token is hashed and dropped, never carried into the
        // stored row. A fake that keeps it would let the assertion below pass on code that
        // stores the token.
        const { token, ...rest } = data
        const record = {
          id: `req-${requests.size + 1}`,
          ...rest,
          tokenHash: hashToken(token),
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
      getTenant: async (_c: any, id: string) => (over.missingTenant ? null : id === ACME.id ? ACME : null),
      softDeleteTenant: async () => true
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
    expect(steps).toEqual(['removeAll', 'dropContainer'])
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
    const { server, token } = await open()
    expect((await destroy(server, { token, slug: 'acme', otp: '123456' })).statusCode).toBe(200)

    const again = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(again.statusCode).toBe(403)
    expect(JSON.parse(again.body).code).toBe('DESTRUCTION_TOKEN_INVALID')
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

  it('refuses an operator with no second factor, and says what to do', async () => {
    ACTOR.mfaEnabled = false
    const { server, token, dropped } = await open()

    const res = await destroy(server, { token, slug: 'acme', otp: '123456' })
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).message).toMatch(/mfa\/setup/)
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
