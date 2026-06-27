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
  userManager
} from '../../typeorm.js'
import { Product, User, Tenant } from './fixtures/entities.js'

let ds: any

describe('Embedded PGlite engine', () => {
  before(async () => {
    ds = await start({
      type: 'pglite',
      vector: true, // enable pgvector
      synchronize: false,
      entities: [Product, User, Tenant]
    })
    // The public schema is built explicitly here (startup sync is env-gated).
    await ds.synchronize()
    // userManager.createUser resolves the concrete entity via global.entity.User.
    ;(global as any).entity = { User, Tenant }
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
})
