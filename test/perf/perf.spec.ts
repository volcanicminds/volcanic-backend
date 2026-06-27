/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Performance suite (run on demand: `npm run test:perf`).
//
// These tests REPORT numbers (ops/sec, latency, req/s) and assert only very
// loose floors — they are meant to track trends and catch big regressions, not
// to gate PRs (CI timing is noisy). Hard correctness lives in the normal suite;
// catastrophic-regression guards live in test/typeorm/unit/guardrails.spec.ts.
//
import { expect } from 'expect'
import { EntitySchema } from 'typeorm'
import autocannon from 'autocannon'
import { start as startServer } from '../../index.js'
import { start as startDatabase, closeEmbedded, executeFindQuery, userManager } from '../../typeorm.js'

const Product = new EntitySchema<any>({
  name: 'Product',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    price: { type: 'int', default: 0 },
    active: { type: Boolean, default: true }
  }
})

const report = (label: string, value: string) => console.log(`    ⏱  ${label.padEnd(34)} ${value}`)

describe('Performance', function () {
  this.timeout(120000)

  describe('Magic Query translation (CPU)', () => {
    it('applyQuery throughput', async () => {
      const { applyQuery } = await import('../../lib/database/typeorm/query.js')
      const data = { page: 2, pageSize: 50, sort: ['name:asc'], 'name:containsi': 'abc', 'price:gt': '10' }
      const N = 50_000
      const start = process.hrtime.bigint()
      for (let i = 0; i < N; i++) applyQuery({ ...data }, {}, null)
      const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
      const opsPerSec = Math.round((N / elapsedMs) * 1000)
      report('applyQuery', `${opsPerSec.toLocaleString()} ops/sec (${N} in ${elapsedMs.toFixed(0)}ms)`)
      expect(opsPerSec).toBeGreaterThan(1000) // floor only
    })
  })

  describe('Data layer on PGlite (10k rows)', () => {
    let ds: any

    before(async () => {
      ds = await startDatabase({ type: 'pglite', synchronize: false, logging: false, entities: [Product] })
      await ds.synchronize()
      await ds.query(
        `INSERT INTO product (id, name, price, active)
         SELECT uuid_generate_v4(), 'product-' || g, (g % 1000), (g % 2 = 0)
         FROM generate_series(1, 10000) AS g`
      )
    })

    after(async () => {
      if (ds?.isInitialized) await ds.destroy()
      await closeEmbedded()
    })

    it('executeFindQuery (filter + sort + paginate) latency', async () => {
      const repo = ds.getRepository(Product)
      const runs = 50
      const start = process.hrtime.bigint()
      for (let i = 0; i < runs; i++) {
        await executeFindQuery(repo, {}, { 'price:gt': '500', sort: 'price:desc', page: 1, pageSize: 25 })
      }
      const avgMs = Number(process.hrtime.bigint() - start) / 1e6 / runs
      report('find over 10k rows', `${avgMs.toFixed(2)} ms/query (avg of ${runs})`)
      expect(avgMs).toBeLessThan(2000) // generous floor
    })

    it('count over 10k rows latency', async () => {
      const repo = ds.getRepository(Product)
      const runs = 50
      const start = process.hrtime.bigint()
      for (let i = 0; i < runs; i++) await repo.count({ where: { active: true } })
      const avgMs = Number(process.hrtime.bigint() - start) / 1e6 / runs
      report('count over 10k rows', `${avgMs.toFixed(2)} ms/query (avg of ${runs})`)
      expect(avgMs).toBeLessThan(2000)
    })
  })

  describe('HTTP throughput (autocannon)', () => {
    let server: any
    const port = Number(process.env.PORT || 2233)

    before(async () => {
      server = await startServer({ userManager })
    })

    after(async () => {
      if (server) await server.close()
    })

    it('GET /health req/s + p97.5 latency', async () => {
      const result: any = await autocannon({
        url: `http://127.0.0.1:${port}/health`,
        connections: 10,
        duration: 3
      })
      report('GET /health', `${Math.round(result.requests.average)} req/s, p97.5 ${result.latency.p97_5}ms`)
      expect(result.requests.average).toBeGreaterThan(0)
      expect(result.non2xx).toBe(0)
    })
  })
})
