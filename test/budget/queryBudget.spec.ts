//
// The query budget: how many statements a request sends to the database, counted from the query
// spans (lib/database/adapters/postgres/queryTrace.ts) with an in-memory SDK. A count and not a
// time, so it is the same on a laptop and in CI and can fail a build where a latency never could.
//
// A count that grows is a statement added to every request of that kind: an N+1, a lookup moved
// inside a loop, a cache that stopped hitting. A count that shrinks is good news that still has to
// be written below, so the next growth is measured from it.
//
// The whole server on a tenant provisioned through the API (scripts/httpWorld.ts, shared with
// `npm run bench:http`), because a fleet pays the tenant resolution on every request. A suite of
// its own (`npm run test:budget`): it owns `global.server`, and lib/api/system/routes.ts decides
// whether it is mounted when it is imported, so a process holds one tenancy.
//
import { expect } from 'expect'
import { installTracing } from '../db/fixtures/tracing.js'
// Before httpWorld: it imports index.ts, whose dotenv.config() adds the developer's .env, and a
// DATABASE_URL found there is not a database anybody offered to these schemas.
import { DATABASE_URL } from '../db/fixtures/migrated.js'
import { openWorld, SCENARIOS, type HttpWorld, type WorldOptions } from '../../scripts/httpWorld.js'

const BUDGET: Record<string, number> = {
  health: 0,
  // The registry row the token names, then the subject.
  'users.me': 2,
  // The same two, the page, its count.
  'users.list': 4
}

const USERS = 30

const engines: Array<{ name: string; options: WorldOptions }> = [
  { name: 'PGlite', options: { engine: 'pglite', tenancy: 'schema', users: USERS } }
]
if (DATABASE_URL) {
  engines.push({
    name: 'Postgres',
    options: { engine: 'postgres', tenancy: 'schema', url: DATABASE_URL, prefix: 'qbudget', leftovers: 'drop', users: USERS }
  })
}

for (const engine of engines) {
  describe(`query budget · statements per request, ${engine.name}`, function () {
    this.timeout(60000)
    let tracing: ReturnType<typeof installTracing>
    let world: HttpWorld

    before(async () => {
      tracing = installTracing()
      world = await openWorld(engine.options)
    })

    after(async () => {
      await world?.close()
      await tracing?.uninstall()
    })

    async function send(url: string, as: 'anonymous' | 'admin') {
      tracing.reset()
      const res = await world.server.inject({ method: 'GET', url, headers: world.headers(as) })
      const sql = tracing
        .spans()
        .filter((s) => s.attributes['db.system.name'] === 'postgresql')
        .map((s) => String(s.attributes['db.query.text']))
      return { status: res.statusCode, body: res.body, sql }
    }

    it('spends its budget on every request, the first one and the ones after', async () => {
      const observed: Record<string, unknown> = {}
      const expected: Record<string, unknown> = {}
      for (const scenario of SCENARIOS) {
        const runs = []
        for (let i = 0; i < 3; i++) runs.push(await send(scenario.url, scenario.as))
        observed[scenario.name] = { status: runs.map((r) => r.status), statements: runs.map((r) => r.sql.length), sql: runs[2].sql }
        expected[scenario.name] = {
          status: [200, 200, 200],
          statements: Array(3).fill(BUDGET[scenario.name]),
          sql: expect.any(Array)
        }
      }
      // The statements of the last request travel with the diff: a failure names what was added.
      expect(observed).toEqual(expected)
    })

    it('reads a page in the same statements whatever its size', async () => {
      const one = await send('/users?_pageSize=1', 'admin')
      const all = await send(`/users?_pageSize=${USERS + 1}`, 'admin')
      expect([one.status, all.status]).toEqual([200, 200])
      // The pages really differ, or the comparison proves nothing.
      expect([JSON.parse(one.body).length, JSON.parse(all.body).length]).toEqual([1, USERS + 1])
      expect(all.sql.length).toBe(one.sql.length)
    })
  })
}
