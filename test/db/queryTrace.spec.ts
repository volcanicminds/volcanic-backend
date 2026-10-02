/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Query spans (F68): the data layer emits one CLIENT span per statement, at the driver, under
// the span that was active when the statement was issued. Checked on PGlite, which runs
// everywhere, on a pool double for the one path PGlite does not have (a client handed out from
// the pool's waiting queue), and on Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import { sql } from 'drizzle-orm'
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import { PostgresProvider, openPglite } from '../../lib/database/adapters/postgres/index.js'
import { guardPool } from '../../lib/database/adapters/postgres/guard.js'
import { sanitizeQueryText, startQuerySpan } from '../../lib/database/adapters/postgres/queryTrace.js'
import { installTracing } from './fixtures/tracing.js'

const URL = process.env.DATABASE_URL

describe('database/queryTrace · what a span may show (F68)', () => {
  it('replaces every literal with ?, and keeps placeholders and identifiers', () => {
    expect(sanitizeQueryText(`select "email" from "acme"."user" where "id" = $1 and "name" = 'O''Brien'`)).toBe(
      `select "email" from "acme"."user" where "id" = $1 and "name" = ?`
    )
    expect(sanitizeQueryText(`create role app password 'hunter2'`)).toBe('create role app password ?')
    expect(sanitizeQueryText('do $body$ begin perform 1; end $body$; select $$x$$, $2')).toBe('do ?; select ?, $2')
  })

  it('starts nothing while no SDK is registered', () => {
    expect(startQuerySpan('select 1')).toBeUndefined()
  })
})

function engineSuite(engine: string, open: () => Promise<PostgresProvider>) {
  describe(`database/queryTrace · one span per statement, on ${engine} (F68)`, function () {
    this.timeout(60000)
    let provider: PostgresProvider
    let tracing: ReturnType<typeof installTracing>

    before(async () => {
      provider = await open()
      tracing = installTracing()
    })

    after(async () => {
      await tracing?.uninstall()
      await provider?.shutdown()
    })

    beforeEach(() => tracing.reset())

    it('writes a CLIENT span under the active span, with the statement and no literal', async () => {
      const parent = trace.getTracer('test').startSpan('request')
      // Awaited inside: a Drizzle query runs at `then()`, not when it is built.
      await context.with(trace.setSpan(context.active(), parent), async () => {
        await (provider.control() as any).db.execute(sql`select 'c0de' as secret, ${42}::int as n`)
      })
      parent.end()

      const query = tracing.spans().find((s) => s.attributes['db.system.name'] === 'postgresql')
      expect(query?.name).toBe('SELECT')
      expect(query?.kind).toBe(SpanKind.CLIENT)
      expect(query?.parentSpanContext?.spanId).toBe(parent.spanContext().spanId)
      expect(query?.spanContext().traceId).toBe(parent.spanContext().traceId)
      expect(query?.attributes['db.operation.name']).toBe('SELECT')
      expect(query?.attributes['db.query.text']).toBe('select ? as secret, $1::int as n')
      expect(JSON.stringify(query?.attributes)).not.toContain('c0de')
    })

    it('marks a failed statement with its SQLSTATE', async () => {
      await expect((provider.control() as any).db.execute(sql`select * from table_that_is_not_there`)).rejects.toThrow()
      const query = tracing.spans().find((s) => s.attributes['db.system.name'] === 'postgresql')
      expect(query?.status.code).toBe(SpanStatusCode.ERROR)
      expect(query?.attributes['db.response.status_code']).toBe('42P01')
      expect(query?.attributes['error.type']).toBe('42P01')
    })
  })
}

engineSuite('PGlite', async () => new PostgresProvider({ pglite: await openPglite() }))
if (URL) engineSuite('Postgres', async () => new PostgresProvider({ url: URL, schema: 'public', poolMax: 2 }))

/**
 * What pg-pool does when every connection is busy: `query` checks a client out with a callback,
 * and the callback runs when somebody else releases one, in that somebody's context.
 */
class QueueingPool {
  private waiting: Array<(err: unknown, client: any, release: () => void) => void> = []
  readonly client = {
    query: (_text: any, _values: any, cb: (err: unknown, res: unknown) => void) =>
      setImmediate(() => cb(null, { rows: [] })),
    release: () => {}
  }

  connect(cb: (err: unknown, client: any, release: () => void) => void) {
    this.waiting.push(cb)
  }

  query(text: any, values?: any) {
    return new Promise((resolve, reject) =>
      this.connect((err, client) => {
        if (err) return reject(err)
        client.query(text, values, (e: unknown, res: unknown) => (e ? reject(e) : resolve(res)))
      })
    )
  }

  /** Hands the next client out, from wherever this is called. */
  releaseOne() {
    this.waiting.shift()?.(null, this.client, () => {})
  }
}

describe('database/queryTrace · a queued checkout keeps its caller as parent (F68)', () => {
  let tracing: ReturnType<typeof installTracing>

  before(() => {
    tracing = installTracing()
  })

  after(async () => {
    await tracing?.uninstall()
  })

  it('parents the span on the request that issued the statement, not on the one that released the client', async () => {
    const pool = guardPool(new QueueingPool() as any) as unknown as QueueingPool
    const tracer = trace.getTracer('test')
    const caller = tracer.startSpan('caller')
    const releaser = tracer.startSpan('releaser')

    const pending = context.with(trace.setSpan(context.active(), caller), () => pool.query('select 1'))
    context.with(trace.setSpan(context.active(), releaser), () => pool.releaseOne())
    await pending
    caller.end()
    releaser.end()

    const query = tracing.spans().find((s) => s.attributes['db.system.name'] === 'postgresql')
    expect(query?.parentSpanContext?.spanId).toBe(caller.spanContext().spanId)
  })
})
