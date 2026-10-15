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
import { fakeGovernanceLog } from './fixtures/governanceLog.js'

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

async function sealed(files: Record<string, string> = { 'tenant.sql': 'create table x();\n' }, packages: any[] = []) {
  const { name, dir } = createPackage(ACME, '0001_init')
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  const seal = await sealPackage(dir, {
    createdAt: new Date().toISOString(),
    tenant: { name: ACME.name, slug: ACME.slug },
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
    const part = (file: string, name = 'notes') => [{ name, file, description: null }]
    await expect(openPackage((await sealed(files, part('tenant.notes'))).dir)).resolves.toBeTruthy()

    for (const [file, name] of [['../../outside', 'notes'], ['tenant.notes/../..', 'notes'], ['tenant.sql', 'notes'], ['tenant.rag', 'rag'], ['tenant.x', '../x']]) {
      await expect(openPackage((await sealed(files, part(file, name))).dir)).rejects.toMatchObject({
        code: 'RESTORE_PACKAGE_INVALID',
        message: /is not a file of this package/
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
    dropContainer: async (locator: string) => void steps.push(`drop ${locator}`)
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
    req.systemUser = { id: 'sys-1', email: 'root@system.test' }
  })
  const control = { config: { tenantContext: false } }
  server.post('/tenants/:id/export', control, exportContainer)
  server.get('/tenants/:id/exports/:package', control, downloadPackage)
  server.post('/tenants/import', control, importTenant)
  server.post('/tenants/:id/move', control, move)
  return { server, governance, steps, rows, exports }
}

const exported = async (server: any) => {
  const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/export` })
  expect(res.statusCode).toBe(200)
  return JSON.parse(res.body).package as string
}

const restore = (server: any, payload: any) => server.inject({ method: 'POST', url: '/tenants/import', payload })

describe('tenants · the download of a package (T-17.2)', () => {
  afterEach(() => (ACME.status = 'active'))

  it('sends the client profile without the envelope, and the operator profile with it', async () => {
    const { server } = build()
    const name = await exported(server)

    const client = await server.inject({ method: 'GET', url: `/tenants/${ACME.id}/exports/${name}` })
    expect(client.statusCode).toBe(200)
    expect(client.headers['content-type']).toBe('application/x-tar')
    expect(client.headers['content-disposition']).toBe(`attachment; filename="${name}.tar"`)
    expect(client.rawPayload.includes(Buffer.from('envelope.json'))).toBe(false)
    expect(client.rawPayload.includes(Buffer.from(ACME.id))).toBe(false)

    const operator = await server.inject({ method: 'GET', url: `/tenants/${ACME.id}/exports/${name}?profile=operator` })
    expect(operator.statusCode).toBe(200)
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

describe('tenants · the restore of a package (T-17.4)', () => {
  const PASSWORD = 'Founder-pw-123456'

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
    expect(manifest.packages[0]).toEqual({ name: 'rag', file: 'tenant.rag', description: { engine: 'lancedb', model: 'bge-small' } })

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
    const res = await server.inject({ method: 'POST', url: `/tenants/${ACME.id}/export` })
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
