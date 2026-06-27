/* eslint-disable @typescript-eslint/no-explicit-any */
// Integration tests for the embedded PGlite engine.
//
// PGlite is a single in-process WASM instance, shared as a singleton across the
// whole mocha process. We therefore start it ONCE and exercise every concern
// (connection, synchronize, query, boolean, persistence, multi-tenant, vector)
// against the same DataSource, using distinct table/schema names to avoid
// cross-test interference.
import { expect } from 'expect'
import {
  start,
  closeEmbedded,
  TenantManager,
  executeFindQuery,
  executeCountQuery,
  userManager,
  tokenManager,
  configureCaseInsensitiveDefault
} from '../../typeorm.js'
import { Product, User, Tenant, Token } from './fixtures/entities.js'

let ds: any

describe('Embedded PGlite engine', () => {
  before(async () => {
    ds = await start({
      type: 'pglite',
      vector: true, // enable pgvector
      synchronize: false,
      entities: [Product, User, Tenant, Token]
    })
    // The public schema is built explicitly here (startup sync is env-gated).
    await ds.synchronize()
    // userManager/tokenManager resolve the concrete entities via global.entity.*.
    ;(global as any).entity = { User, Tenant, Token }
  })

  after(async () => {
    if (ds?.isInitialized) await ds.destroy()
    await closeEmbedded()
  })

  describe('connection', () => {
    it('initializes a Postgres-dialect DataSource backed by PGlite', () => {
      expect(ds.isInitialized).toBe(true)
      expect(ds.options.type).toBe('postgres')
      expect((global as any).embeddedDatabase?.enabled).toBe(true)
    })

    it('reports the embedded state (in-memory, vector on, uuid-ossp always loaded)', () => {
      const state = (global as any).embeddedDatabase
      expect(state.persisted).toBe(false)
      expect(state.vector).toBe(true)
      expect(state.extensions).toContain('uuid_ossp')
      expect(state.extensions).toContain('vector')
    })

    it('runs raw SQL and reports a Postgres server version', async () => {
      const rows = await ds.query('SELECT version() as v')
      expect(String(rows[0].v)).toMatch(/PostgreSQL/i)
    })
  })

  describe('synchronize + uuid primary keys', () => {
    it('creates tables with uuid_generate_v4() defaults (needs uuid-ossp)', async () => {
      const repo = ds.getRepository(Product)
      const saved = await repo.save(repo.create({ name: 'widget', price: 10 }))
      // A real uuid was generated server-side by the extension.
      expect(saved.id).toMatch(/^[0-9a-f-]{36}$/)
    })
  })

  describe('queries + boolean serialization', () => {
    before(async () => {
      const repo = ds.getRepository(Product)
      await repo.save([
        repo.create({ name: 'alpha', price: 5, active: true }),
        repo.create({ name: 'beta', price: 20, active: false }),
        repo.create({ name: 'gamma', price: 15, active: true })
      ])
    })

    it('filters by boolean (the typeorm-pglite bool serializer)', async () => {
      const active = await ds.getRepository(Product).findBy({ active: true })
      expect(active.length).toBeGreaterThanOrEqual(2)
      expect(active.every((p: any) => p.active === true)).toBe(true)
    })

    it('supports ordering, where and aggregation via the query builder', async () => {
      const expensive = await ds
        .getRepository(Product)
        .createQueryBuilder('p')
        .where('p.price >= :min', { min: 15 })
        .orderBy('p.price', 'DESC')
        .getMany()
      expect(expensive[0].price).toBeGreaterThanOrEqual(expensive[expensive.length - 1].price)
      expect(expensive.every((p: any) => p.price >= 15)).toBe(true)
    })

    it('runs transactions', async () => {
      await ds.transaction(async (em: any) => {
        await em.getRepository(Product).save(em.getRepository(Product).create({ name: 'tx', price: 99 }))
      })
      const found = await ds.getRepository(Product).findOneBy({ name: 'tx' })
      expect(found?.price).toBe(99)
    })
  })

  describe('multi-tenant (schema isolation)', () => {
    it('CREATE SCHEMA + search_path isolate data per schema', async () => {
      const qr = ds.createQueryRunner()
      await qr.connect()
      try {
        await qr.query('CREATE SCHEMA IF NOT EXISTS t_iso')
        await qr.query('SET search_path TO "t_iso", public')
        const cur = await qr.query('SELECT current_schema() as s')
        expect(cur[0].s).toBe('t_iso')
        await qr.query('CREATE TABLE IF NOT EXISTS scoped (id int)')
        await qr.query('INSERT INTO scoped VALUES (1)')
        const inSchema = await qr.query('SELECT count(*)::int as c FROM scoped')
        expect(inSchema[0].c).toBe(1)
        await qr.query('SET search_path TO public')
      } finally {
        await qr.release()
      }
    })

    it('TenantManager.createTenant provisions a schema and seeds an admin (ephemeral DS not destroyed)', async () => {
      const tm = new TenantManager(ds)
      const tenant: any = await tm.createTenant({
        name: 'Acme',
        slug: 'acme',
        dbSchema: 'tenant_acme',
        adminEmail: 'admin@acme.test',
        adminPassword: 'S3cret-pw-123'
      })
      expect(tenant.id).toBeTruthy()

      // The primary connection is STILL alive (the no-destroy guard worked).
      const ping = await ds.query('SELECT 1 as ok')
      expect(ping[0].ok).toBe(1)

      // The admin user exists in the tenant schema...
      const adminInTenant = await tm.runInTenantContext(tenant.id, async (em: any) =>
        em.getRepository(User).findOneBy({ email: 'admin@acme.test' })
      )
      expect(adminInTenant?.email).toBe('admin@acme.test')
      expect(adminInTenant?.roles).toContain('admin')

      // ...but NOT in the public schema (isolation holds).
      const adminInPublic = await ds.getRepository(User).findOneBy({ email: 'admin@acme.test' })
      expect(adminInPublic).toBeNull()
    })
  })

  describe('pgvector (embeddings / similarity search)', () => {
    before(async () => {
      await ds.query('CREATE TABLE IF NOT EXISTS doc_embeddings (id serial primary key, content text, embedding vector(3))')
      await ds.query(
        "INSERT INTO doc_embeddings (content, embedding) VALUES ('cat', '[1,0,0]'), ('dog', '[0.9,0.1,0]'), ('car', '[0,0,1]')"
      )
    })

    it('orders rows by cosine/L2 distance to a query vector', async () => {
      const near = await ds.query(
        "SELECT content, embedding <-> '[1,0,0]' AS dist FROM doc_embeddings ORDER BY dist ASC LIMIT 2"
      )
      expect(near[0].content).toBe('cat') // closest to [1,0,0]
      expect(near.length).toBe(2)
      expect(Number(near[0].dist)).toBeLessThanOrEqual(Number(near[1].dist))
    })

    it('supports cosine distance operator (<=>)', async () => {
      const near = await ds.query(
        "SELECT content, embedding <=> '[1,0,0]' AS cos FROM doc_embeddings ORDER BY cos ASC LIMIT 1"
      )
      expect(near[0].content).toBe('cat')
    })
  })

  // End-to-end Magic Query: the HTTP-query-string -> SQL -> results pipeline,
  // previously only unit-tested at the parsing level (no real DB). PGlite lets us
  // run it against a real Postgres dialect with zero setup.
  describe('Magic Query (executeFindQuery / executeCountQuery) end-to-end', () => {
    let repo: any

    before(async () => {
      repo = ds.getRepository(Product)
      await repo.clear()
      await repo.save([
        repo.create({ name: 'apple', price: 10, active: true }),
        repo.create({ name: 'banana', price: 20, active: true }),
        repo.create({ name: 'cherry', price: 30, active: false }),
        repo.create({ name: 'orange', price: 40, active: true })
      ])
    })

    it('equality filter (default operator)', async () => {
      const { records } = await executeFindQuery(repo, {}, { name: 'banana' })
      expect(records.map((p: any) => p.name)).toEqual(['banana'])
    })

    it('comparison operator (:gt) with typecasting', async () => {
      const { records } = await executeFindQuery(repo, {}, { 'price:gt': '20' })
      expect(records.map((p: any) => p.name).sort()).toEqual(['cherry', 'orange'])
    })

    it(':in operator (comma list)', async () => {
      const { records } = await executeFindQuery(repo, {}, { 'price:in': '10,40' })
      expect(records.map((p: any) => p.name).sort()).toEqual(['apple', 'orange'])
    })

    it('case-insensitive contains (:containsi -> ILIKE)', async () => {
      const { records } = await executeFindQuery(repo, {}, { 'name:containsi': 'AN' })
      // 'banana' and 'orange' contain "an"
      expect(records.map((p: any) => p.name).sort()).toEqual(['banana', 'orange'])
    })

    it('boolean filter with typecasting', async () => {
      const { records } = await executeFindQuery(repo, {}, { active: 'false' })
      expect(records.map((p: any) => p.name)).toEqual(['cherry'])
    })

    it('sorting + pagination + pagination headers', async () => {
      const { records, headers } = await executeFindQuery(repo, {}, { sort: 'price:desc', page: 1, pageSize: 2 })
      expect(records.map((p: any) => p.price)).toEqual([40, 30])
      expect(headers['v-total']).toBe(4)
      expect(headers['v-pageSize']).toBe(2)
      expect(headers['v-pageCount']).toBe(2)
    })

    it('executeCountQuery honours filters', async () => {
      expect(await executeCountQuery(repo, { active: 'true' })).toBe(3)
      expect(await executeCountQuery(repo, { 'price:ge': '30' })).toBe(2)
    })

    it('extraWhere (RLS) is AND-ed to the user filter', async () => {
      const { records } = await executeFindQuery(repo, {}, { 'price:gt': '5' }, { active: true })
      expect(records.every((p: any) => p.active === true)).toBe(true)
      expect(records.find((p: any) => p.name === 'cherry')).toBeUndefined()
    })
  })

  // userManager auth core, end-to-end against a real DB (previously only the
  // constant-time password check was unit-tested with a stubbed runner).
  describe('userManager auth flows end-to-end', () => {
    const email = 'flow@acme.test'

    it('createUser hashes the password and persists the user', async () => {
      const u: any = await userManager.createUser({ email, password: 'Initial-pw-1', roles: ['user'] } as any)
      expect(u.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(u.password).not.toBe('Initial-pw-1') // stored as a bcrypt hash
      expect(u.externalId).toBeTruthy()
    })

    it('retrieveUserByEmail finds the persisted user', async () => {
      const u: any = await userManager.retrieveUserByEmail(email)
      expect(u?.email).toBe(email)
    })

    it('retrieveUserByPassword validates credentials', async () => {
      expect(await userManager.retrieveUserByPassword(email, 'Initial-pw-1')).not.toBeNull()
      expect(await userManager.retrieveUserByPassword(email, 'wrong-pw')).toBeNull()
    })

    it('changePassword rotates the credential', async () => {
      await userManager.changePassword(email, 'New-pw-2', 'Initial-pw-1')
      expect(await userManager.retrieveUserByPassword(email, 'New-pw-2')).not.toBeNull()
      expect(await userManager.retrieveUserByPassword(email, 'Initial-pw-1')).toBeNull()
    })
  })

  // tokenManager (API tokens) end-to-end on a real DB — previously untested.
  describe('tokenManager end-to-end', () => {
    let id: string
    let externalId: string

    it('createToken assigns an externalId and defaults blocked=false', async () => {
      const t: any = await tokenManager.createToken({ name: 'ci-token', description: 'for CI', roles: ['ci'] } as any)
      expect(t.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(t.externalId).toBeTruthy()
      expect(t.blocked).toBe(false)
      id = t.id
      externalId = t.externalId
    })

    it('rejects creation without a name', async () => {
      await expect(tokenManager.createToken({ description: 'no name' } as any)).rejects.toThrow()
    })

    it('retrieves by id and by externalId', async () => {
      expect((await tokenManager.retrieveTokenById(id))?.name).toBe('ci-token')
      expect((await tokenManager.retrieveTokenByExternalId(externalId))?.id).toBe(id)
    })

    it('updateTokenById merges fields', async () => {
      const updated: any = await tokenManager.updateTokenById(id, { description: 'updated' } as any)
      expect(updated.description).toBe('updated')
      expect(updated.name).toBe('ci-token') // untouched
    })

    it('block / unblock toggles the flag with a reason', async () => {
      const blocked: any = await tokenManager.blockTokenById(id, 'abuse')
      expect(blocked.blocked).toBe(true)
      expect(blocked.blockedReason).toBe('abuse')
      const unblocked: any = await tokenManager.unblockTokenById(id)
      expect(unblocked.blocked).toBe(false)
      expect(unblocked.blockedReason).toBeNull()
    })

    it('findQuery / countQuery use the Magic Query layer', async () => {
      expect(await tokenManager.countQuery({ name: 'ci-token' })).toBe(1)
      const { records } = await tokenManager.findQuery({ 'name:containsi': 'ci' })
      expect(records.some((r: any) => r.id === id)).toBe(true)
    })

    it('removeTokenById deletes the row', async () => {
      await tokenManager.removeTokenById(id)
      expect(await tokenManager.retrieveTokenById(id)).toBeNull()
    })
  })

  // New operator semantics: case-insensitive-by-default (i/s scheme),
  // completed negations, array and empty operators — verified on a real DB.
  describe('Magic Query operators (case sensitivity, negations, arrays)', () => {
    let repo: any

    before(async () => {
      repo = ds.getRepository(Product)
      await repo.clear()
      await repo.save([
        repo.create({ name: 'Apple', price: 10, active: true, tags: ['fruit', 'red'] }),
        repo.create({ name: 'Banana', price: 20, active: true, tags: ['fruit', 'yellow'] }),
        repo.create({ name: 'Carrot', price: 30, active: false, tags: ['veg', 'orange'] }),
        repo.create({ name: '', price: 0, active: true, tags: [] }) // empty-name row
      ])
    })

    it('eq is case-INsensitive by default (string)', async () => {
      const { records } = await executeFindQuery(repo, {}, { name: 'apple' }) // lower-case query
      expect(records.map((p: any) => p.name)).toEqual(['Apple'])
    })

    it('eqs forces case-sensitive', async () => {
      expect((await executeFindQuery(repo, {}, { 'name:eqs': 'apple' })).records).toHaveLength(0)
      expect((await executeFindQuery(repo, {}, { 'name:eqs': 'Apple' })).records).toHaveLength(1)
    })

    it('eqi is an explicit insensitive alias', async () => {
      expect((await executeFindQuery(repo, {}, { 'name:eqi': 'APPLE' })).records).toHaveLength(1)
    })

    it('eq stays exact for numeric values (no ILIKE on int column)', async () => {
      const { records } = await executeFindQuery(repo, {}, { price: '20' })
      expect(records.map((p: any) => p.name)).toEqual(['Banana'])
    })

    it('contains is insensitive by default; containss is sensitive', async () => {
      expect((await executeFindQuery(repo, {}, { 'name:contains': 'app' })).records).toHaveLength(1)
      expect((await executeFindQuery(repo, {}, { 'name:containss': 'app' })).records).toHaveLength(0)
      expect((await executeFindQuery(repo, {}, { 'name:containss': 'App' })).records).toHaveLength(1)
    })

    it('new negations: nstarts / nends', async () => {
      const { records } = await executeFindQuery(repo, {}, { 'name:nstarts': 'ba' }) // exclude Banana (insensitive)
      const names = records.map((p: any) => p.name)
      expect(names).toContain('Apple')
      expect(names).not.toContain('Banana')
    })

    it('nbetween (NOT BETWEEN)', async () => {
      const { records } = await executeFindQuery(repo, {}, { 'price:nbetween': '10:20' })
      const names = records.map((p: any) => p.name).sort()
      expect(names).toEqual(['', 'Carrot']) // price 0 and 30 are outside [10,20]
    })

    it('isEmpty / isNotEmpty', async () => {
      expect((await executeFindQuery(repo, {}, { 'name:isEmpty': '1' })).records.map((p: any) => p.price)).toEqual([0])
      const notEmpty = await executeFindQuery(repo, {}, { 'name:isNotEmpty': '1' })
      expect(notEmpty.records.every((p: any) => p.name !== '')).toBe(true)
    })

    it('array operators: arrayContains / overlap / arrayContainedBy', async () => {
      const contains = await executeFindQuery(repo, {}, { 'tags:arrayContains': 'fruit' })
      expect(contains.records.map((p: any) => p.name).sort()).toEqual(['Apple', 'Banana'])

      const overlap = await executeFindQuery(repo, {}, { 'tags:overlap': 'veg,yellow' })
      expect(overlap.records.map((p: any) => p.name).sort()).toEqual(['Banana', 'Carrot'])

      const containedBy = await executeFindQuery(repo, {}, { 'tags:arrayContainedBy': 'fruit,red,extra' })
      expect(containedBy.records.map((p: any) => p.name)).toContain('Apple')
      expect(containedBy.records.map((p: any) => p.name)).not.toContain('Banana')
    })

    it('the caseInsensitiveByDefault flag flips base-operator behavior', async () => {
      try {
        configureCaseInsensitiveDefault(false) // legacy: base = case-sensitive
        expect((await executeFindQuery(repo, {}, { name: 'apple' })).records).toHaveLength(0)
        expect((await executeFindQuery(repo, {}, { name: 'Apple' })).records).toHaveLength(1)
        // explicit *i still works regardless of the flag
        expect((await executeFindQuery(repo, {}, { 'name:eqi': 'apple' })).records).toHaveLength(1)
      } finally {
        configureCaseInsensitiveDefault(true) // restore default for other tests
      }
    })
  })
})
