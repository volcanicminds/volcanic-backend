/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The package of a tenant, and the three routes that use it beyond the export: the download, the
// restore and the move. On fakes: the dump is a file the fake provider writes, and what a restore
// does to a real container is in the Postgres suites.
//
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { expect } from 'expect'
import fastify from 'fastify'
import { downloadPackage, exportContainer, importTenant, move } from '../../lib/api/tenants/controller/tenants.js'
import { getData, getParams } from '../../lib/util/common.js'
import {
  createPackage,
  keyId,
  openPackage,
  packageDir,
  packageKeys,
  sealPackage,
  tarPackage,
  verifyEnvelope,
  writeEnvelope
} from '../../lib/util/tenantPackage.js'
import * as tenantExports from '../../lib/api/exports/controller/exports.js'
import { schedule } from '../../lib/schedules/exportRetention.job.js'
import { expirePackages, exportRetention, warnExportCleanupOff } from '../../lib/util/tenantExport.js'
import { fakeGovernanceLog } from './fixtures/governanceLog.js'
import { fakeLock } from './fixtures/lock.js'

;(global as any).log = {}

const ACME: any = {
  id: 'id-acme',
  name: 'Acme',
  slug: 'acme',
  status: 'active',
  strategy: 'schema',
  engine: 'postgres',
  locator: 'tenant_acme',
  schemaVersion: '0001_init',
  config: { brand: 'blue' }
}

const made: string[] = []
const scratch = (prefix = 'vm-package-') => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  made.push(dir)
  return dir
}
// Every package here is signed, as on an instance that can restore; the tests without a key drop it.
const KEY = 'package-signing-key-for-the-tests-0123456789'
const OLD_KEY = 'a-rotated-package-signing-key-for-tests-9876'
beforeEach(() => {
  process.env.PACKAGE_SIGNING_KEY = KEY
  delete process.env.PACKAGE_VERIFY_KEYS
})
after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true })
  ;(global as any).config = undefined
  delete process.env.PACKAGE_SIGNING_KEY
  delete process.env.PACKAGE_VERIFY_KEYS
})

/** The error `verifyEnvelope` throws, or null: `toMatchObject` then matches its message against a pattern. */
const signatureRefusal = (envelope: any): any => {
  try {
    verifyEnvelope(envelope)
    return null
  } catch (error) {
    return error
  }
}

/**
 * What anybody can do to a package without the key: rewrite the dump, then seal the manifest and
 * write the envelope again, so every hash matches. Only the signature is left to refuse it.
 */
async function forge(dir: string, keepSignature: boolean) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))
  const envelope = JSON.parse(fs.readFileSync(path.join(dir, 'envelope.json'), 'utf8'))
  fs.appendFileSync(path.join(dir, 'tenant.sql'), 'grant all on schema public to public;\n')
  fs.rmSync(path.join(dir, 'manifest.json'))
  fs.rmSync(path.join(dir, 'envelope.json'))
  const { format: _f, version: _v, files: _files, ...body } = manifest
  const resealed = await sealPackage(dir, body)
  const unsigned = {
    format: envelope.format,
    version: envelope.version,
    manifestSha256: resealed.sha256,
    tenant: envelope.tenant,
    identityProviders: envelope.identityProviders
  }
  const written = keepSignature ? { ...unsigned, signature: envelope.signature } : unsigned
  fs.writeFileSync(path.join(dir, 'envelope.json'), JSON.stringify(written, null, 2))
}

const useExports = () => {
  const dir = scratch()
  ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' }, export_directory: dir } }
  return dir
}

async function sealed(files: Record<string, string> = { 'tenant.sql': 'create table x();\n' }, packages: any[] = [], profile: any = 'operator') {
  const { name, dir } = createPackage(ACME, '0001_init')
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  const seal = await sealPackage(dir, {
    createdAt: new Date().toISOString(),
    tenant: { name: ACME.name, slug: ACME.slug },
    profile,
    schemaVersion: '0001_init',
    strategy: 'schema',
    engine: 'postgres',
    dump: { file: 'tenant.sql', schema: 'vm_package', rowCounts: { user: 1 } },
    packages
  })
  writeEnvelope(dir, { manifestSha256: seal.sha256, tenant: ACME, identityProviders: [] })
  return { name, dir, seal }
}

describe('the package of a tenant (T-17.1, T-17.5)', () => {
  beforeEach(() => useExports())

  it('opens a package as it was sealed, and names no path nor id in the manifest', async () => {
    const { dir, seal } = await sealed()
    const opened = await openPackage(dir)
    expect(opened.sha256).toBe(seal.sha256)
    expect(opened.manifest.files).toEqual([{ path: 'tenant.sql', bytes: 18, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }])
    const manifest = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')
    expect(manifest).not.toContain(ACME.id)
    expect(manifest).not.toContain(ACME.locator)
    expect(manifest).not.toContain(dir)
  })

  it('refuses a file changed after the seal, with RESTORE_PACKAGE_INVALID', async () => {
    const { dir } = await sealed()
    fs.writeFileSync(path.join(dir, 'tenant.sql'), 'create table y();\n')
    await expect(openPackage(dir)).rejects.toMatchObject({ code: 'RESTORE_PACKAGE_INVALID', message: /tenant.sql is not the file/ })
  })

  it('refuses a file the manifest does not list, and a link', async () => {
    const extra = await sealed()
    fs.writeFileSync(path.join(extra.dir, 'more.sql'), 'drop table x;')
    await expect(openPackage(extra.dir)).rejects.toThrow(/more.sql is not in the manifest/)

    const linked = await sealed()
    fs.symlinkSync('/etc/hosts', path.join(linked.dir, 'hosts'))
    await expect(openPackage(linked.dir)).rejects.toThrow(/hosts is a link/)
  })

  it('refuses an envelope that belongs to another manifest', async () => {
    const one = await sealed()
    const other = await sealed({ 'tenant.sql': 'another dump\n' })
    fs.copyFileSync(path.join(other.dir, 'envelope.json'), path.join(one.dir, 'envelope.json'))
    await expect(openPackage(one.dir)).rejects.toThrow(/envelope.json does not belong to this manifest/)
  })

  it('refuses a part the manifest points outside the package, or at a file it does not hold', async () => {
    // The part's path goes to a lifecycle's `restore` as its source: a manifest that named
    // `../../<other tenant>` would copy another tenant's folder into this one.
    const files = { 'tenant.sql': 'create table x();\n', 'tenant.notes/a.txt': 'note\n' }
    const part = (file: string, name = 'notes') => [{ name, file, unpack: false, description: null }]
    await expect(openPackage((await sealed(files, part('tenant.notes'))).dir)).resolves.toBeTruthy()

    for (const [file, name] of [['../../outside', 'notes'], ['tenant.notes/../..', 'notes'], ['tenant.sql', 'notes'], ['tenant.rag', 'rag'], ['tenant.x', '../x']]) {
      await expect(openPackage((await sealed(files, part(file, name))).dir)).rejects.toMatchObject({
        code: 'RESTORE_PACKAGE_INVALID',
        message: /is not a file of this package/
      })
    }
  })

  it('refuses a manifest that names no profile, and a package that does not say whether it unpacks (T-17.10)', async () => {
    for (const profile of ['client', 'operator']) await expect(openPackage((await sealed(undefined, [], profile)).dir)).resolves.toBeTruthy()
    for (const profile of [null, 'admin']) {
      await expect(openPackage((await sealed(undefined, [], profile)).dir)).rejects.toMatchObject({
        code: 'RESTORE_PACKAGE_INVALID',
        message: /names no profile/
      })
    }
    for (const unpack of [undefined, 'yes', 1]) {
      await expect(openPackage((await sealed(undefined, [{ name: 'vault', file: null, unpack, description: null }])).dir)).rejects.toMatchObject({
        code: 'RESTORE_PACKAGE_INVALID',
        message: /vault does not say whether it unpacks/
      })
    }
  })

  it('signs the envelope with the platform key, and verifies it with that key or a previous one', async () => {
    const { dir } = await sealed()
    const envelope = JSON.parse(fs.readFileSync(path.join(dir, 'envelope.json'), 'utf8'))
    expect(envelope.signature).toEqual({
      alg: 'HMAC-SHA256',
      kid: keyId(KEY),
      value: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    expect(JSON.stringify(envelope)).not.toContain(KEY)
    expect(() => verifyEnvelope(envelope)).not.toThrow()

    // Rotated: the old key only verifies, and still opens what it signed.
    process.env.PACKAGE_SIGNING_KEY = 'a-new-package-signing-key-for-the-tests-555'
    process.env.PACKAGE_VERIFY_KEYS = `${OLD_KEY}, ${KEY}`
    expect(() => verifyEnvelope(envelope)).not.toThrow()
    expect(packageKeys().verifying).toEqual(['a-new-package-signing-key-for-the-tests-555', OLD_KEY, KEY])

    // A key this instance does not hold, and no key at all.
    delete process.env.PACKAGE_VERIFY_KEYS
    expect(signatureRefusal(envelope)).toMatchObject({
      code: 'RESTORE_SIGNATURE_INVALID',
      message: /is not in PACKAGE_SIGNING_KEY/
    })
    delete process.env.PACKAGE_SIGNING_KEY
    expect(packageKeys()).toEqual({ signing: null, verifying: [] })
  })

  it('refuses an envelope changed after the signature, one without it, and a short or garbled one', async () => {
    const { dir } = await sealed()
    const envelope = JSON.parse(fs.readFileSync(path.join(dir, 'envelope.json'), 'utf8'))
    const refused = (e: any, message: RegExp) =>
      expect(signatureRefusal(e)).toMatchObject({ code: 'RESTORE_SIGNATURE_INVALID', message })

    refused({ ...envelope, tenant: { ...envelope.tenant, slug: 'other' } }, /does not match/)
    refused({ ...envelope, manifestSha256: '0'.repeat(64) }, /does not match/)
    refused({ ...envelope, signature: { ...envelope.signature, value: 'ab' } }, /does not match/)
    refused({ ...envelope, signature: { ...envelope.signature, value: 'not hex at all' } }, /does not match/)
    const { signature: _s, ...unsigned } = envelope
    refused(unsigned, /carries no signature/)
    refused({ ...envelope, signature: { ...envelope.signature, alg: 'none' } }, /carries no signature/)

    // Without a key the envelope is written unsigned, and says so.
    delete process.env.PACKAGE_SIGNING_KEY
    const bare = await sealed()
    expect(JSON.parse(fs.readFileSync(path.join(bare.dir, 'envelope.json'), 'utf8'))).not.toHaveProperty('signature')
  })

  it('looks a package up by a file name only', async () => {
    const { name, dir } = await sealed()
    expect(packageDir(name)).toBe(dir)
    expect(packageDir(`../${name}`)).toBeNull()
    expect(packageDir(`${name}/tenant.sql`)).toBeNull()
    expect(packageDir('')).toBeNull()
    expect(packageDir(undefined)).toBeNull()
  })

  it('writes a tar that tar reads back, byte for byte', async () => {
    const { name, dir } = await sealed({ 'tenant.sql': 'x'.repeat(1500), 'tenant.rag': 'index' })
    const out = scratch('vm-untar-')
    const file = path.join(out, 'package.tar')
    const chunks: Buffer[] = []
    for await (const chunk of tarPackage(dir, name, () => true)) chunks.push(chunk as Buffer)
    fs.writeFileSync(file, Buffer.concat(chunks))
    execFileSync('tar', ['-xf', file, '-C', out])
    for (const rel of ['tenant.sql', 'tenant.rag', 'manifest.json', 'envelope.json']) {
      expect(fs.readFileSync(path.join(out, name, rel))).toEqual(fs.readFileSync(path.join(dir, rel)))
    }
  })
})

//
// The routes, on fakes that keep what they were asked.
//
function build(over: any = {}) {
  const exports = useExports()
  const governance = fakeGovernanceLog()
  const lock = fakeLock()
  const steps: string[] = []
  const rows: any[] = [ACME]
  const idps: any[] = [{ tenantId: ACME.id, key: 'entra', type: 'oidc', status: 'active', config: { issuer: 'https://login.example.com' } }]

  const server: any = fastify()
  server.decorate('governanceLogManager', governance)
  server.decorate('tenantManager', {
    isImplemented: () => true,
    getTenant: async (_c: any, id: string) => rows.find((r) => r.id === id) ?? null,
    getTenantBySlug: async (_c: any, slug: string) => rows.find((r) => r.slug === slug && r.status !== 'destroyed') ?? null,
    createTenant: async (_c: any, data: any) => {
      if (over.rowFails) throw new Error('the registry is gone')
      steps.push(`row ${data.slug} ${data.locator}`)
      const row = { ...data, id: `id-${data.slug}`, status: 'active' }
      rows.push(row)
      return row
    },
    markTenantMoved: async (_c: any, id: string, destination: string) => {
      const row = rows.find((r) => r.id === id)
      if (!row) return false
      Object.assign(row, { status: 'moved', movedTo: destination })
      return true
    }
  })
  server.decorate('provider', {
    strategy: over.strategy ?? 'schema',
    exportContainer: async (_t: any, request: any) => {
      // As the provider does: on the scratch copy, after the scrub and before the rows are counted.
      if (!over.skipsPack) await request.pack?.({ kind: 'tenant', locator: 'vm_scratch' })
      fs.writeFileSync(request.target, 'create table widget();\n')
      return { path: request.target, bytes: 24, schemaVersion: '0001_init', schema: 'vm_package', rowCounts: { user: 2, token: 1 } }
    },
    ...(over.canRestore === false
      ? {}
      : {
          restoreContainer: async (locator: string, source: any) => {
            if (over.containerTaken) return null
            steps.push(`restore ${locator} ${path.basename(source.dump)} ${source.schema}`)
            return { tokenIds: ['tok-1'], founderId: over.noFounder ? null : 'u-founder' }
          }
        }),
    forLocator: async (locator: string) => ({ kind: 'tenant', locator }),
    dropContainer: async (locator: string) => void steps.push(`drop ${locator}`),
    withLock: lock.withLock
  })
  server.decorate('migrations', {
    apply: async () => (steps.push('migrate'), '0002_more'),
    version: async () => '0001_init',
    expected: () => over.expected ?? '0002_more'
  })
  server.decorate('userManager', {
    isImplemented: () => true,
    resetPassword: async (_c: any, user: any, password: string) => (steps.push(`password ${user.id} ${password}`), true)
  })
  server.decorate('tokenManager', {
    isImplemented: () => true,
    resetExternalId: async (_c: any, id: string) => (steps.push(`token ${id}`), 'new-ext')
  })
  server.decorate('identityProviderManager', {
    isImplemented: () => true,
    list: async (_c: any, tenantId: string) => idps.filter((p) => p.tenantId === tenantId),
    create: async (_c: any, data: any) => {
      steps.push(`idp ${data.key} ${data.status} ${data.clientSecret ?? 'no secret'}`)
      return data
    }
  })
  server.decorate('authFlowManager', { isImplemented: () => true })
  if (over.lifecycles) server.decorate('tenantLifecycles', over.lifecycles(steps))

  server.addHook('onRequest', async (req: any) => {
    req.data = () => getData(req)
    req.parameters = () => getParams(req)
    req.control = { kind: 'control' }
    // The tenant plane's routes are Acme's admin's, as the token says, whatever the request carries.
    if (req.url.startsWith('/exports')) {
      req.user = { id: 'u-admin' }
      req.tenant = { tenantId: over.tenantId ?? ACME.id }
    } else req.systemUser = { id: 'sys-1', email: 'root@system.test' }
  })
  const control = { config: { tenantContext: false } }
  server.post('/tenants/:id/exports', control, exportContainer)
  server.get('/tenants/:id/exports/:package', control, downloadPackage)
  server.post('/tenants/import', control, importTenant)
  server.post('/tenants/:id/move', control, move)
  server.post('/exports', tenantExports.create)
  server.get('/exports/:package', tenantExports.download)
  return { server, governance, steps, rows, exports, lock }
}

const exported = async (server: any, profile = 'operator') => {
  const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/exports`, payload: { profile } })
  expect(res.statusCode).toBe(200)
  return JSON.parse(res.body).package as string
}

const restore = (server: any, payload: any) => server.inject({ method: 'POST', url: '/tenants/import', payload })

describe('tenants · the download of a package (T-17.2)', () => {
  afterEach(() => (ACME.status = 'active'))

  it('sends a client package without the envelope and an operator package with it, whatever the query asks (T-17.10)', async () => {
    const { server, exports } = build()
    const name = await exported(server, 'client')
    // On the server the envelope is there for both: the download reads it to know the tenant.
    expect(fs.existsSync(path.join(exports, name, 'envelope.json'))).toBe(true)

    for (const query of ['', '?profile=operator']) {
      const client = await server.inject({ method: 'GET', url: `/tenants/${ACME.id}/exports/${name}${query}` })
      expect(client.statusCode).toBe(200)
      expect(client.headers['content-type']).toBe('application/x-tar')
      expect(client.headers['content-disposition']).toBe(`attachment; filename="${name}.tar"`)
      expect(client.rawPayload.includes(Buffer.from('envelope.json'))).toBe(false)
      expect(client.rawPayload.includes(Buffer.from(ACME.id))).toBe(false)
    }

    const whole = await exported(server, 'operator')
    const operator = await server.inject({ method: 'GET', url: `/tenants/${ACME.id}/exports/${whole}?profile=client` })
    expect(operator.statusCode).toBe(200)
    expect(operator.headers['content-disposition']).toBe(`attachment; filename="${whole}.operator.tar"`)
    expect(operator.rawPayload.includes(Buffer.from('envelope.json'))).toBe(true)
    await server.close()
  })

  it("answers 404 for another tenant's package and for a name that is not one", async () => {
    const { server } = build()
    const name = await exported(server)
    expect((await server.inject({ method: 'GET', url: `/tenants/id-other/exports/${name}` })).statusCode).toBe(404)
    expect((await server.inject({ method: 'GET', url: `/tenants/${ACME.id}/exports/..%2F${name}` })).statusCode).toBe(404)
    await server.close()
  })

  it('refuses to send a package that no longer matches its manifest', async () => {
    const { server, exports } = build()
    const name = await exported(server)
    fs.appendFileSync(path.join(exports, name, 'tenant.sql'), 'drop table widget;\n')
    const res = await server.inject({ method: 'GET', url: `/tenants/${ACME.id}/exports/${name}` })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).code).toBe('RESTORE_PACKAGE_INVALID')
    await server.close()
  })
})

describe('tenants · the export in a profile (T-17.10)', () => {
  it('refuses an export without a profile, or with another, before anything is written', async () => {
    const { server, governance, exports } = build()
    for (const payload of [undefined, {}, { profile: 'admin' }]) {
      const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/exports`, payload })
      expect([res.statusCode, JSON.parse(res.body).code]).toEqual([400, 'EXPORT_PROFILE_REQUIRED'])
    }
    expect(fs.readdirSync(exports)).toEqual([])
    expect(governance.rows).toEqual([])
    await server.close()
  })

  it('runs every pack on the scratch copy with the profile, and records it with the packages that unpack', async () => {
    const lifecycles = (steps: string[]) => [
      { name: 'vault', pack: async (t: any, handle: any, profile: string) => (steps.push(`vault ${t.slug} ${handle.locator} ${profile}`), true) },
      { name: 'audit', pack: async (_t: any, _h: any, profile: string) => (steps.push(`audit ${profile}`), false) },
      { name: 'rag', describe: async () => ({ engine: 'lancedb' }) }
    ]
    const { server, steps, governance, exports } = build({ lifecycles })
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/exports`, payload: { profile: 'client' } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.profile).toBe('client')
    expect(steps).toEqual(['vault acme vm_scratch client', 'audit client'])

    const manifest = JSON.parse(fs.readFileSync(path.join(exports, body.package, 'manifest.json'), 'utf8'))
    expect(manifest.profile).toBe('client')
    expect(manifest.packages).toEqual([
      { name: 'vault', file: null, unpack: true, description: null },
      { name: 'audit', file: null, unpack: false, description: null },
      { name: 'rag', file: null, unpack: false, description: { engine: 'lancedb' } }
    ])
    expect(governance.rows.at(-1)).toMatchObject({ action: 'tenant.exported', outcome: 'success', detail: { profile: 'client' } })
    await server.close()
  })

  it('fails the export, and leaves no folder, on a data layer that never runs pack', async () => {
    const lifecycles = () => [{ name: 'vault', pack: async () => true }]
    const { server, exports, governance } = build({ lifecycles, skipsPack: true })
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/exports`, payload: { profile: 'client' } })
    expect(res.statusCode).toBe(500)
    expect(fs.readdirSync(exports)).toEqual([])
    expect(governance.rows.at(-1)).toMatchObject({ action: 'tenant.exported', outcome: 'failure' })
    await server.close()
  })
})

describe('tenants · who exports and downloads, a slot per plane (T-17.11)', () => {
  const OTHER: any = { ...ACME, id: 'id-other', slug: 'other', locator: 'tenant_other' }
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const controlExport = async (server: any, profile = 'operator', id = ACME.id) => {
    const res = await server.inject({ method: 'POST', url: `/tenants/${id}/exports`, payload: { profile } })
    expect(res.statusCode).toBe(200)
    return JSON.parse(res.body)
  }
  const tenantExport = async (server: any, payload: any = {}) => {
    const res = await server.inject({ method: 'POST', url: '/exports', payload })
    expect(res.statusCode).toBe(200)
    return JSON.parse(res.body)
  }
  const envelopeOf = (exports: string, name: string) => JSON.parse(fs.readFileSync(path.join(exports, name, 'envelope.json'), 'utf8'))
  afterEach(() => {
    delete process.env.TENANT_EXPORT_MAX
    delete process.env.TENANT_EXPORT_WINDOW
  })

  it("replaces the previous package of the same slot once the new one is sealed, and leaves the other slot and a destruction's", async () => {
    const { server, exports, governance } = build()
    const destruction = await sealed()
    const first = await controlExport(server, 'operator')
    const ownFirst = await tenantExport(server)
    const second = await controlExport(server, 'client')

    expect(fs.readdirSync(exports).sort()).toEqual([destruction.name, ownFirst.package, second.package].sort())
    expect(envelopeOf(exports, second.package).slot).toBe('control')
    expect(envelopeOf(exports, ownFirst.package).slot).toBe('tenant')
    expect(envelopeOf(exports, destruction.name).slot).toBeUndefined()
    expect(governance.rows.at(-1)).toMatchObject({
      action: 'tenant.exported',
      outcome: 'success',
      actorKind: 'system_user',
      detail: { slot: 'control', replaced: [{ package: first.package, manifestSha256: first.manifestSha256, removed: true }] }
    })

    const ownSecond = await tenantExport(server)
    expect(fs.readdirSync(exports).sort()).toEqual([destruction.name, ownSecond.package, second.package].sort())
    expect(governance.rows.at(-1)).toMatchObject({
      actorKind: 'user',
      actorId: 'u-admin',
      detail: { slot: 'tenant', profile: 'client', replaced: [{ package: ownFirst.package, removed: true }] }
    })
    await server.close()
  })

  it('leaves the previous package where it was when the new export fails', async () => {
    let fails = false
    const lifecycles = () => [
      {
        name: 'vault',
        pack: async () => {
          if (fails) throw new Error('the vault is gone')
          return true
        }
      }
    ]
    const { server, exports, governance } = build({ lifecycles })
    const first = await controlExport(server)
    fails = true
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/exports`, payload: { profile: 'operator' } })
    expect(res.statusCode).toBe(500)
    expect(fs.readdirSync(exports)).toEqual([first.package])
    expect(governance.rows.at(-1)).toMatchObject({ action: 'tenant.exported', outcome: 'failure', detail: { slot: 'control' } })
    await server.close()
  })

  it('answers 409 while an export of the same slot runs, and lets the other plane export', async () => {
    const { server, governance, lock, exports } = build()
    lock.held.add(`export:${ACME.id}:control`)
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/exports`, payload: { profile: 'operator' } })
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([409, 'EXPORT_IN_PROGRESS'])
    expect(governance.rows).toEqual([])
    expect(fs.readdirSync(exports)).toEqual([])
    await tenantExport(server)
    await server.close()
  })

  it("counts the tenant plane's exports, failed ones too, never the operator's, and answers 429 with Retry-After", async () => {
    process.env.TENANT_EXPORT_MAX = '2'
    process.env.TENANT_EXPORT_WINDOW = '3600'
    let fails = true
    const lifecycles = () => [
      {
        name: 'vault',
        pack: async () => {
          if (fails) throw new Error('the vault is gone')
          return true
        }
      }
    ]
    const { server, governance, exports } = build({ lifecycles })
    expect((await server.inject({ method: 'POST', url: '/exports' })).statusCode).toBe(500)
    fails = false
    for (let i = 0; i < 3; i++) await controlExport(server)
    const own = await tenantExport(server)

    const res = await server.inject({ method: 'POST', url: '/exports' })
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([429, 'EXPORT_QUOTA_EXCEEDED'])
    const wait = Number(res.headers['retry-after'])
    expect(wait).toBeGreaterThan(3500)
    expect(wait).toBeLessThanOrEqual(3600)
    // Refused before the intent: the refusal neither counts nor touches the slot.
    expect(governance.rows.filter((r: any) => r.actorKind === 'user' && r.outcome === 'intent')).toHaveLength(2)
    expect(fs.readdirSync(exports)).toContain(own.package)
    // The operator's plane has no quota.
    await controlExport(server)
    await server.close()
  })

  it("exports the tenant of the token, whatever the request names, always as a client package", async () => {
    const { server, rows, exports } = build()
    rows.push(OTHER)
    const answer = await tenantExport(server, { tenantId: OTHER.id, id: OTHER.id, profile: 'operator' })
    expect(answer.tenant).toEqual({ id: ACME.id, slug: ACME.slug })
    expect(answer.profile).toBe('client')
    expect(envelopeOf(exports, answer.package).tenant.id).toBe(ACME.id)
    await server.close()
  })

  it("lets the tenant's admin download its own client packages, of either slot, and nothing else as anything but unknown", async () => {
    const { server, rows } = build()
    rows.push(OTHER)
    const own = await tenantExport(server)
    const fromOperator = await controlExport(server, 'client')
    const whole = await controlExport(server, 'operator', OTHER.id)
    const others = await controlExport(server, 'client', OTHER.id)

    for (const name of [own.package, fromOperator.package]) {
      const res = await server.inject({ method: 'GET', url: `/exports/${name}` })
      expect(res.statusCode).toBe(200)
      expect(res.rawPayload.includes(Buffer.from('envelope.json'))).toBe(false)
    }
    for (const url of [`/exports/${others.package}`, `/exports/${others.package}?tenantId=${OTHER.id}`, `/exports/${whole.package}`, '/exports/nope']) {
      expect((await server.inject({ method: 'GET', url })).statusCode).toBe(404)
    }
    await server.close()

    // An operator package of its own tenant answers the same.
    const mine = build()
    const operator = await controlExport(mine.server, 'operator')
    expect((await mine.server.inject({ method: 'GET', url: `/exports/${operator.package}` })).statusCode).toBe(404)
    await mine.server.close()
  })

  it('records every download, on both planes, with who, the package, its hash, the profile and the bytes that left', async () => {
    const { server, governance } = build()
    const own = await tenantExport(server)
    const operator = await controlExport(server, 'operator')

    const fromTenant = await server.inject({ method: 'GET', url: `/exports/${own.package}` })
    const fromControl = await server.inject({ method: 'GET', url: `/tenants/${ACME.id}/exports/${operator.package}` })
    await tick()
    const downloads = governance.rows.filter((r: any) => r.action === 'tenant.downloaded')
    expect(downloads).toMatchObject([
      { outcome: 'intent', tenantId: ACME.id, actorKind: 'user', actorId: 'u-admin', detail: { package: own.package, profile: 'client' } },
      { outcome: 'success', actorKind: 'user', detail: { manifestSha256: own.manifestSha256, bytes: fromTenant.rawPayload.length } },
      { outcome: 'intent', actorKind: 'system_user', actorId: 'sys-1', detail: { package: operator.package, profile: 'operator' } },
      { outcome: 'success', actorKind: 'system_user', detail: { manifestSha256: operator.manifestSha256, bytes: fromControl.rawPayload.length } }
    ])
    expect(downloads[1].intentId).toBe(downloads[0].id)
    await server.close()
  })

  it('sends nothing when the intent of the download cannot be written', async () => {
    const { server, governance } = build()
    const own = await tenantExport(server)
    const record = governance.record.bind(governance)
    governance.record = async (ctx: any, entry: any) => {
      if (entry.action === 'tenant.downloaded') throw new Error('the log is gone')
      return record(ctx, entry)
    }
    const res = await server.inject({ method: 'GET', url: `/exports/${own.package}` })
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([503, 'GOVERNANCE_LOG_NOT_AVAILABLE'])
    expect(res.headers['content-type']).not.toBe('application/x-tar')
    await server.close()
  })
})

describe('tenants · the cleanup of old packages (T-17.11)', () => {
  const ctx: any = { kind: 'control' }
  /** Ages a package as only the clock would: the cleanup reads the date, and checks nothing else. */
  const age = (exports: string, name: string, days: number) => {
    const file = path.join(exports, name, 'manifest.json')
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    fs.writeFileSync(file, JSON.stringify({ ...manifest, createdAt: new Date(Date.now() - days * 86_400_000).toISOString() }))
  }
  const exportIn = async (server: any, url: string, payload?: any) => JSON.parse((await server.inject({ method: 'POST', url, payload })).body).package

  it("removes the slots' packages older than the retention, with an event each, and leaves the rest", async () => {
    const { server, exports, governance, lock } = build()
    const old = await exportIn(server, `/tenants/${ACME.id}/exports`, { profile: 'operator' })
    const fresh = await exportIn(server, '/exports')
    const destruction = await sealed()
    age(exports, old, 8)
    age(exports, fresh, 6)
    age(exports, destruction.name, 30)
    fs.mkdirSync(path.join(exports, `.removing-${old}x`))
    const before = governance.rows.length

    const done = await expirePackages({ governance, ctx, provider: { withLock: lock.withLock } as any }, 7)
    expect(done).toEqual({ removed: 1, kept: 0 })
    expect(fs.readdirSync(exports).sort()).toEqual([destruction.name, fresh].sort())
    const events = governance.rows.slice(before)
    expect(events).toMatchObject([
      { action: 'tenant.export_expired', outcome: 'intent', tenantId: ACME.id, actorId: null, actorKind: null, ip: null },
      { action: 'tenant.export_expired', outcome: 'success', detail: { package: old, slot: 'control' } }
    ])
    expect(events[1].intentId).toBe(events[0].id)
    await server.close()
  })

  it('leaves a slot whose export is running for the next run, and refuses to run without a log or a lock', async () => {
    const { server, exports, governance, lock } = build()
    const old = await exportIn(server, '/exports')
    age(exports, old, 8)
    const before = governance.rows.length
    lock.held.add(`export:${ACME.id}:tenant`)
    const provider: any = { withLock: lock.withLock }
    expect(await expirePackages({ governance, ctx, provider }, 7)).toEqual({ removed: 0, kept: 1 })
    expect(fs.readdirSync(exports)).toEqual([old])
    expect(governance.rows.length).toBe(before)

    await expect(expirePackages({ governance: undefined, ctx, provider }, 7)).rejects.toMatchObject({ code: 'GOVERNANCE_LOG_NOT_AVAILABLE' })
    await expect(expirePackages({ governance, ctx, provider: {} as any }, 7)).rejects.toThrow(/no lock/)
    await server.close()
  })

  describe('on only with the variable and the scheduler, and a warning at the start otherwise', () => {
    const saved = { log: (global as any).log, config: (global as any).config }
    let warned: string[]
    beforeEach(() => {
      warned = []
      ;(global as any).log = { w: true, warn: (message: string) => warned.push(message) }
    })
    afterEach(() => {
      ;(global as any).log = saved.log
      ;(global as any).config = saved.config
      delete process.env.TENANT_EXPORT_RETENTION_DAYS
    })
    const configure = (options: any, days?: string) => {
      ;(global as any).config = { options }
      if (days === undefined) delete process.env.TENANT_EXPORT_RETENTION_DAYS
      else process.env.TENANT_EXPORT_RETENTION_DAYS = days
    }
    const tenants = { strategy: 'schema' }

    for (const [label, options, days, off] of [
      ['without the variable', { tenants, scheduler: true }, undefined, 'TENANT_EXPORT_RETENTION_DAYS is not set'],
      ['with the variable at zero', { tenants, scheduler: true }, '0', 'TENANT_EXPORT_RETENTION_DAYS is not set'],
      ['without the scheduler', { tenants }, '7', 'the scheduler is off']
    ] as const) {
      it(`stays off ${label}, and warns`, () => {
        configure(options, days)
        expect(exportRetention().off).toBe(off)
        expect(schedule.active).toBe(false)
        expect(warnExportCleanupOff()).toBe(true)
        expect(warned.filter((m) => m.startsWith('Export cleanup is off'))).toEqual([expect.stringContaining(off)])
      })
    }

    it('runs with both, and says nothing', () => {
      configure({ tenants, scheduler: true }, '7')
      expect(exportRetention()).toEqual({ days: 7, off: null })
      expect(schedule.active).toBe(true)
      expect(warnExportCleanupOff()).toBe(false)
      expect(warned).toEqual([])
    })

    it('says nothing where there are no tenants', () => {
      configure({ scheduler: true }, '7')
      expect(schedule.active).toBe(false)
      expect(warnExportCleanupOff()).toBe(false)
      expect(warned).toEqual([])
    })
  })
})

describe('tenants · the restore of a package (T-17.4)', () => {
  const PASSWORD = 'Founder-pw-123456'

  it('refuses a client package with RESTORE_PROFILE_MISMATCH, before anything is built (T-17.10)', async () => {
    const { server, steps } = build()
    const name = await exported(server, 'client')
    const res = await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([409, 'RESTORE_PROFILE_MISMATCH'])
    expect(steps).toEqual([])
    await server.close()
  })

  it('runs unpack after the migrations and before restore and create, only where pack asked for it (T-17.10)', async () => {
    const lifecycles = (steps: string[]) => [
      {
        name: 'vault',
        pack: async () => true,
        unpack: async (place: any, handle: any) => void steps.push(`vault unpack ${place.locator} ${handle.locator}`),
        create: async (place: any) => void steps.push(`vault create ${place.locator}`)
      },
      { name: 'audit', pack: async () => false, unpack: async () => void steps.push('audit unpack') }
    ]
    const { server, steps } = build({ lifecycles })
    const name = await exported(server)
    const res = await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })
    expect(res.statusCode).toBe(201)
    expect(steps).toEqual([
      'restore tenant_b tenant.sql vm_package',
      'migrate',
      'vault unpack tenant_b tenant_b',
      'token tok-1',
      `password u-founder ${PASSWORD}`,
      'vault create tenant_b',
      'row b tenant_b',
      'idp entra disabled no secret'
    ])
    await server.close()
  })

  it('refuses a package whose pack left values in clear on a build without unpack, and undoes a failing unpack (T-17.10)', async () => {
    const vault: any = { name: 'vault', pack: async () => true, unpack: async () => {} }
    const { server, steps, rows } = build({ lifecycles: () => [vault] })
    const name = await exported(server)

    delete vault.unpack
    const refused = await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })
    expect(refused.statusCode).toBe(409)
    expect(JSON.parse(refused.body)).toMatchObject({ code: 'RESTORE_PACKAGE_UNAVAILABLE', message: /vault/ })
    expect(steps).toEqual([])

    vault.unpack = async () => {
      throw new Error('no key to encrypt with')
    }
    const failed = await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })
    expect(failed.statusCode).toBe(500)
    expect(steps).toEqual(['restore tenant_b tenant.sql vm_package', 'migrate', 'drop tenant_b'])
    expect(rows).toEqual([ACME])
    await server.close()
  })

  it('builds a new tenant in the order of a creation, and records where it came from', async () => {
    const lifecycles = (steps: string[]) => [
      {
        name: 'rag',
        export: async (_t: any, target: string) => (fs.writeFileSync(target, 'index'), 5),
        describe: async () => ({ engine: 'lancedb', model: 'bge-small' }),
        restore: async (place: any, _h: any, source: string) => void steps.push(`rag restore ${place.locator} ${fs.readFileSync(source, 'utf8')}`),
        destroy: async (place: any) => void steps.push(`rag destroy ${place.locator}`)
      },
      { name: 'audit', create: async (place: any) => void steps.push(`audit create ${place.locator}`) }
    ]
    const { server, steps, governance, exports } = build({ lifecycles })
    const name = await exported(server)
    const manifest = JSON.parse(fs.readFileSync(path.join(exports, name, 'manifest.json'), 'utf8'))
    expect(manifest.packages[0]).toEqual({ name: 'rag', file: 'tenant.rag', unpack: false, description: { engine: 'lancedb', model: 'bge-small' } })

    const res = await restore(server, { package: name, slug: 'acme2', founderPassword: PASSWORD })
    expect(res.statusCode).toBe(201)
    const row = JSON.parse(res.body)
    expect(row).toMatchObject({ id: 'id-acme2', slug: 'acme2', name: 'Acme', locator: 'tenant_acme2', config: { brand: 'blue' } })
    expect(steps).toEqual([
      'restore tenant_acme2 tenant.sql vm_package',
      'migrate',
      'token tok-1',
      `password u-founder ${PASSWORD}`,
      'rag restore tenant_acme2 index',
      'audit create tenant_acme2',
      'row acme2 tenant_acme2',
      // Back without a secret, and disabled until an operator enters it.
      'idp entra disabled no secret'
    ])
    expect(governance.rows.at(-1)).toMatchObject({
      action: 'tenant.imported',
      outcome: 'success',
      tenantId: 'id-acme2',
      detail: { sourceTenantId: ACME.id, package: name, schemaVersion: '0002_more', tokens: 1, identityProviders: 1 }
    })
    // The hash of the manifest it was loaded from: the same the export recorded.
    const sealedWith = governance.rows.find((r) => r.action === 'tenant.exported' && r.outcome === 'success')?.detail?.manifestSha256
    expect(governance.rows.at(-1)?.detail?.manifestSha256).toBe(sealedWith)
    expect(JSON.stringify(governance.rows)).not.toContain(PASSWORD)
    await server.close()
  })

  it('refuses a slug already taken, before anything is built', async () => {
    const { server, steps } = build()
    const name = await exported(server)
    const res = await restore(server, { package: name, founderPassword: PASSWORD })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('TENANT_EXISTS')
    expect(steps).toEqual([])
    await server.close()
  })

  it('refuses a package of another strategy, a schema ahead of this build, and a part it cannot rebuild', async () => {
    const strategy = build()
    const one = await exported(strategy.server)
    // Made under `schema`, restored where containers are databases.
    strategy.server.provider.strategy = 'container'
    expect(JSON.parse((await restore(strategy.server, { package: one, slug: 'b', founderPassword: PASSWORD })).body).code).toBe(
      'RESTORE_STRATEGY_MISMATCH'
    )

    const ahead = build({ expected: '0000_initial' })
    const two = await exported(ahead.server)
    expect(JSON.parse((await restore(ahead.server, { package: two, slug: 'b', founderPassword: PASSWORD })).body).code).toBe(
      'RESTORE_SCHEMA_AHEAD'
    )

    const lifecycles = () => [{ name: 'rag', export: async (_t: any, target: string) => (fs.writeFileSync(target, 'i'), 1) }]
    const parts = build({ lifecycles })
    const three = await exported(parts.server)
    const refused = await restore(parts.server, { package: three, slug: 'b', founderPassword: PASSWORD })
    expect(refused.statusCode).toBe(409)
    expect(JSON.parse(refused.body)).toMatchObject({ code: 'RESTORE_PACKAGE_UNAVAILABLE', message: /rag/ })

    for (const { steps, server } of [strategy, ahead, parts]) {
      expect(steps).toEqual([])
      await server.close()
    }
  })

  it('refuses a changed package, an unknown one, and a data layer that cannot restore', async () => {
    const changed = build()
    const name = await exported(changed.server)
    fs.appendFileSync(path.join(changed.exports, name, 'tenant.sql'), 'grant all on schema public to public;\n')
    const res = await restore(changed.server, { package: name, slug: 'b', founderPassword: PASSWORD })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).code).toBe('RESTORE_PACKAGE_INVALID')
    expect((await restore(changed.server, { package: 'nothing-here', slug: 'b', founderPassword: PASSWORD })).statusCode).toBe(404)
    await changed.server.close()

    const unable = build({ canRestore: false })
    const other = await exported(unable.server)
    const refused = await restore(unable.server, { package: other, slug: 'b', founderPassword: PASSWORD })
    expect(refused.statusCode).toBe(503)
    expect(JSON.parse(refused.body).code).toBe('RESTORE_NOT_AVAILABLE')
    await unable.server.close()
  })

  it('refuses a package rewritten and hashed again without the key, signed or not, with RESTORE_SIGNATURE_INVALID', async () => {
    // Every hash matches after the forgery: the signature is the only thing that stops a dump
    // somebody else wrote from running as SQL here.
    const { server, steps, exports } = build()
    for (const keepSignature of [true, false]) {
      const name = await exported(server)
      await forge(path.join(exports, name), keepSignature)
      await expect(openPackage(path.join(exports, name))).resolves.toBeTruthy()
      const res = await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })
      expect([res.statusCode, JSON.parse(res.body).code]).toEqual([422, 'RESTORE_SIGNATURE_INVALID'])
    }
    expect(steps).toEqual([])
    await server.close()
  })

  it('exports without a key as an unsigned package, and restores nothing without a key to verify with', async () => {
    const { server, steps } = build()
    delete process.env.PACKAGE_SIGNING_KEY
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/exports`, payload: { profile: 'operator' } })
    expect([res.statusCode, JSON.parse(res.body).signed]).toEqual([200, false])

    const refused = await restore(server, {
      package: JSON.parse(res.body).package,
      slug: 'b',
      founderPassword: PASSWORD
    })
    expect([refused.statusCode, JSON.parse(refused.body).code]).toEqual([503, 'RESTORE_NOT_AVAILABLE'])
    expect(JSON.parse(refused.body).message).toMatch(/PACKAGE_SIGNING_KEY/)

    // A key that only verifies cannot open what was never signed.
    process.env.PACKAGE_VERIFY_KEYS = OLD_KEY
    const unsigned = await restore(server, {
      package: JSON.parse(res.body).package,
      slug: 'b',
      founderPassword: PASSWORD
    })
    expect([unsigned.statusCode, JSON.parse(unsigned.body).code]).toEqual([422, 'RESTORE_SIGNATURE_INVALID'])
    expect(steps).toEqual([])
    await server.close()
  })

  it('answers TENANT_LOCATOR_TAKEN to a container already there, and drops nothing', async () => {
    const { server, steps } = build({ containerTaken: true })
    const name = await exported(server)
    const res = await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('TENANT_LOCATOR_TAKEN')
    expect(steps).toEqual([])
    await server.close()
  })

  it('drops the container of a package with no founder, and writes no row', async () => {
    const { server, steps, rows } = build({ noFounder: true })
    const name = await exported(server)
    const res = await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })
    expect(res.statusCode).toBe(422)
    expect(JSON.parse(res.body).code).toBe('RESTORE_FOUNDER_MISSING')
    expect(steps).toEqual(['restore tenant_b tenant.sql vm_package', 'drop tenant_b'])
    expect(rows).toEqual([ACME])
    await server.close()
  })

  it('undoes the packages and the container when the row cannot be written', async () => {
    const lifecycles = (steps: string[]) => [
      {
        name: 'rag',
        export: async (_t: any, target: string) => (fs.writeFileSync(target, 'i'), 1),
        restore: async () => void steps.push('rag restore'),
        destroy: async (place: any) => void steps.push(`rag destroy ${place.locator}`)
      }
    ]
    const { server, steps } = build({ lifecycles, rowFails: true })
    const name = await exported(server)
    expect((await restore(server, { package: name, slug: 'b', founderPassword: PASSWORD })).statusCode).toBe(500)
    expect(steps.slice(-3)).toEqual(['rag restore', 'rag destroy tenant_b', 'drop tenant_b'])
    await server.close()
  })
})

describe('tenants · the move of a tenant (T-17.6)', () => {
  afterEach(() => {
    ACME.status = 'active'
    delete ACME.movedTo
  })

  it('marks the tenant moved, with the destination and the package it went with', async () => {
    const { server, governance } = build()
    const name = await exported(server)
    const sha = governance.rows.find((r) => r.action === 'tenant.exported' && r.outcome === 'success')?.detail?.manifestSha256
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/move`, payload: { destination: 'eu-west-2', package: name } })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({ id: ACME.id, status: 'moved', movedTo: 'eu-west-2' })
    expect(governance.rows.at(-1)).toMatchObject({
      action: 'tenant.moved',
      outcome: 'success',
      detail: { destination: 'eu-west-2', package: name, manifestSha256: sha }
    })
    await server.close()
  })

  it('refuses a client package with RESTORE_PROFILE_MISMATCH, and leaves the tenant active (T-17.10)', async () => {
    const { server, rows } = build()
    const name = await exported(server, 'client')
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/move`, payload: { destination: 'x', package: name } })
    expect([res.statusCode, JSON.parse(res.body).code]).toEqual([409, 'RESTORE_PROFILE_MISMATCH'])
    expect(rows[0].status).toBe('active')
    await server.close()
  })

  it("refuses another tenant's package with TENANT_PACKAGE_MISMATCH", async () => {
    const { server, rows } = build()
    const name = await exported(server)
    rows.push({ ...ACME, id: 'id-globex', slug: 'globex' })
    const res = await server.inject({ method: 'POST', url: '/tenants/id-globex/move', payload: { destination: 'x', package: name } })
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('TENANT_PACKAGE_MISMATCH')
    expect(rows.find((r) => r.id === 'id-globex').status).toBe('active')
    await server.close()
  })
})
