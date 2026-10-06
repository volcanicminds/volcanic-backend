/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The tenant on every log line and every span of a tenant's work (F75).
//
// The request is served over a socket, not `inject()`: the context is lost where Fastify reads the
// body from the socket's events and where the response finishes, and an injected request has
// neither.
//
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { expect } from 'expect'
import fastify, { type FastifyInstance } from 'fastify'
import { context, trace } from '@opentelemetry/api'
import { node, tracing } from '@opentelemetry/sdk-node'
import { createLogger } from '../../lib/util/logger.js'
import { currentTenantId, enterTenant, registerRequestContext, runInTenant } from '../../lib/util/requestContext.js'
import { registerTelemetry, startTelemetry, stopTelemetry, tenantSpanProcessor } from '../../lib/loader/telemetry.js'

const capture = () => {
  const lines: Record<string, any>[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line))
      done()
    }
  })
  return { lines, logger: createLogger(stream) }
}

/** A server that resolves the tenant from a header, as the tenant hook does from a token. */
async function serve(logger: ReturnType<typeof createLogger>) {
  const server = fastify({ loggerInstance: logger as any })
  await registerTelemetry(server)
  registerRequestContext(server)
  server.addHook('onRequest', async (req) => {
    const tenantId = req.headers['x-test-tenant']
    // A turn of the event loop between resolution and the handler, as a registry read has.
    await new Promise((resolve) => setTimeout(resolve, 5))
    if (typeof tenantId === 'string') enterTenant(req, tenantId)
  })
  server.addHook('onResponse', async (req) => {
    ;(global as any).log.info({ marker: req.headers['x-marker'] }, 'response finished')
  })
  server.get('/read', async (req) => {
    ;(global as any).log.info({ marker: req.headers['x-marker'] }, 'global logger')
    req.log.info({ marker: req.headers['x-marker'] }, 'request logger')
    return { tenant: currentTenantId() ?? null }
  })
  server.post('/write', async (req) => {
    await new Promise((resolve) => setTimeout(resolve, 5))
    ;(global as any).log.info({ marker: req.headers['x-marker'] }, 'global logger')
    return { tenant: currentTenantId() ?? null, body: req.body }
  })
  await server.listen({ port: 0, host: '127.0.0.1' })
  const base = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`
  return { server, base }
}

describe('util/requestContext · the tenant on log lines (F75)', () => {
  let savedLog: any
  beforeEach(() => {
    savedLog = (global as any).log
  })
  afterEach(() => {
    ;(global as any).log = savedLog
  })

  it('puts the tenant on a line written inside a tenant’s work, and nothing outside it', () => {
    const { lines, logger } = capture()
    runInTenant('tenant-a', () => logger.info('inside'))
    logger.info('outside')
    expect(lines.find((l) => l.msg === 'inside')?.tenant_id).toBe('tenant-a')
    expect(lines.find((l) => l.msg === 'outside')).not.toHaveProperty('tenant_id')
  })

  it('keeps it across the request: handler, body, response, both loggers, concurrent tenants apart', async () => {
    const { lines, logger } = capture()
    ;(global as any).log = logger
    const { server, base } = await serve(logger)
    try {
      const calls = ['tenant-a', 'tenant-b', 'tenant-c'].flatMap((tenant) => [
        fetch(`${base}/read`, { headers: { 'x-test-tenant': tenant, 'x-marker': `${tenant}:read` } }),
        fetch(`${base}/write`, {
          method: 'POST',
          headers: { 'x-test-tenant': tenant, 'x-marker': `${tenant}:write`, 'content-type': 'application/json' },
          body: JSON.stringify({ payload: 'x'.repeat(200_000) })
        })
      ])
      const answers = await Promise.all(calls.map(async (call) => (await call).json()))
      expect(answers.map((a: any) => a.tenant)).toEqual([
        'tenant-a',
        'tenant-a',
        'tenant-b',
        'tenant-b',
        'tenant-c',
        'tenant-c'
      ])
    } finally {
      await server.close()
    }

    const marked = lines.filter((l) => typeof l.marker === 'string')
    expect(marked).toHaveLength(15)
    for (const line of marked) expect(line.tenant_id).toBe(line.marker.split(':')[0])
  })

  it('leaves a request without a tenant without one', async () => {
    const { lines, logger } = capture()
    ;(global as any).log = logger
    const { server, base } = await serve(logger)
    try {
      const res = await fetch(`${base}/read`, { headers: { 'x-marker': 'none' } })
      expect(((await res.json()) as any).tenant).toBeNull()
    } finally {
      await server.close()
    }
    const marked = lines.filter((l) => l.marker === 'none')
    expect(marked).toHaveLength(3)
    for (const line of marked) expect(line).not.toHaveProperty('tenant_id')
  })
})

describe('loader/telemetry · the tenant on spans (F75)', function () {
  this.timeout(30000)

  it('tags every span started inside a tenant’s work, and none outside it', async () => {
    const exporter = new tracing.InMemorySpanExporter()
    const provider = new node.NodeTracerProvider({
      spanProcessors: [tenantSpanProcessor, new tracing.SimpleSpanProcessor(exporter)]
    })
    provider.register()
    try {
      const tracer = trace.getTracer('test')
      await runInTenant('tenant-a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        tracer.startSpan('inside').end()
      })
      tracer.startSpan('outside').end()
      // Read before the shutdown, which empties the exporter.
      const spans = exporter.getFinishedSpans()
      expect(spans.find((s) => s.name === 'inside')?.attributes['tenant.id']).toBe('tenant-a')
      expect(spans.find((s) => s.name === 'outside')?.attributes).not.toHaveProperty('tenant.id')
    } finally {
      await provider.shutdown()
      trace.disable()
      context.disable()
    }
  })

  it('on the SDK the framework starts: the request span and the handler’s spans carry it', async () => {
    const env = {
      OTEL_TRACES_EXPORTER: 'console',
      OTEL_METRICS_EXPORTER: 'none',
      OTEL_LOGS_EXPORTER: 'none',
      OTEL_SERVICE_NAME: 'request-context-test'
    }
    const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]))
    Object.assign(process.env, env)
    // The console exporter prints each finished span with `console.dir`.
    const printed: any[] = []
    const dir = console.dir
    console.dir = (value: any) => void printed.push(value)
    const { logger } = capture()
    const savedLog = (global as any).log
    ;(global as any).log = logger
    let server: FastifyInstance | undefined
    try {
      await startTelemetry()
      const served = await serve(logger)
      server = served.server
      const res = await fetch(`${served.base}/write`, {
        method: 'POST',
        headers: { 'x-test-tenant': 'tenant-z', 'content-type': 'application/json' },
        body: JSON.stringify({ a: 1 })
      })
      expect(res.status).toBe(200)
      // The request span ends in a response hook, after the client has its answer: a shutdown
      // before that drops it.
      for (let waited = 0; !printed.some((s) => s.kind === 1 /* SERVER */) && waited < 2000; waited += 10) {
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } finally {
      await server?.close()
      await stopTelemetry()
      console.dir = dir
      ;(global as any).log = savedLog
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
      trace.disable()
      context.disable()
    }

    const tenantOf = (prefix: string) =>
      printed.filter((s) => String(s.name).startsWith(prefix)).map((s) => s.attributes?.['tenant.id'] ?? null)
    // The request span started before resolution: `enterTenant` tags it.
    expect(tenantOf('POST /write')).toEqual(['tenant-z'])
    // The hooks after resolution, the handler, the response hooks: the span processor.
    expect(tenantOf('preValidation')).toEqual(['tenant-z'])
    expect(tenantOf('handler')).toEqual(['tenant-z'])
    expect(tenantOf('onResponse')).toEqual(['tenant-z', 'tenant-z'])
    // Before resolution there is no tenant to name, and the test's own fetch is not a tenant's work.
    expect(tenantOf('onRequest')).toEqual([null, null])
    expect(printed.filter((s) => s.kind === 2 /* CLIENT */).map((s) => s.attributes?.['tenant.id'] ?? null)).toEqual([
      null
    ])
  })
})
