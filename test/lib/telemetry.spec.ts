/* eslint-disable @typescript-eslint/no-explicit-any */
//
// OpenTelemetry in the core (F64, F68): when the framework turns it on, what a request leaves
// behind, and the refusal when a deployment asks for it without the packages.
//
// The SDK here is the in-memory one an `--import` would have registered, so the framework takes
// the path that adds its instrumentations to an SDK it did not start. The path where it starts
// the SDK itself sends to a real OTLP endpoint and is checked on a running server.
//
import type { AddressInfo } from 'node:net'
import { Writable } from 'node:stream'
import { expect } from 'expect'
import fastify from 'fastify'
import { sql } from 'drizzle-orm'
import { metrics as metricsApi, SpanKind } from '@opentelemetry/api'
import { metrics } from '@opentelemetry/sdk-node'
import { createLogger } from '../../lib/util/logger.js'
import {
  importPeer,
  registerTelemetry,
  sdkRegistered,
  startTelemetry,
  stopTelemetry,
  telemetryRequested
} from '../../lib/loader/telemetry.js'
import { PostgresProvider, openPglite } from '../../lib/database/adapters/postgres/index.js'
import { installTracing } from '../db/fixtures/tracing.js'

describe('loader/telemetry · when it is on (F68)', () => {
  it('follows the standard OTEL_* variables', () => {
    expect(telemetryRequested({})).toBe(false)
    expect(telemetryRequested({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' })).toBe(true)
    expect(telemetryRequested({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://collector:4318/v1/traces' })).toBe(true)
    expect(telemetryRequested({ OTEL_TRACES_EXPORTER: 'console' })).toBe(true)
    expect(telemetryRequested({ OTEL_TRACES_EXPORTER: 'none', OTEL_METRICS_EXPORTER: 'none' })).toBe(false)
    expect(
      telemetryRequested({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318', OTEL_SDK_DISABLED: 'true' })
    ).toBe(false)
  })

  it('is off without variables and without an SDK, and adds nothing to the server', async () => {
    expect(sdkRegistered()).toBe(false)
    await startTelemetry()
    const server = fastify()
    await registerTelemetry(server)
    expect(server.hasRequestDecorator('opentelemetry')).toBe(false)
    await server.close()
  })

  it('refuses to boot when it is asked for and a package is missing, naming what to install', async () => {
    const missing = () => import('@volcanicminds/package-that-is-not-there' as string)
    await expect(importPeer('@volcanicminds/package-that-is-not-there', missing)).rejects.toThrow(
      /@volcanicminds\/package-that-is-not-there is not installed: npm install @opentelemetry\/sdk-node @fastify\/otel @opentelemetry\/instrumentation-undici/
    )
    // Any other failure is the package's own, and goes up as it is.
    await expect(importPeer('x', () => Promise.reject(new Error('broken')))).rejects.toThrow('broken')
  })
})

/** Collects on demand, instead of on a timer. */
class TestReader extends metrics.MetricReader {
  protected async onForceFlush() {}
  protected async onShutdown() {}
}

describe('loader/telemetry · a request with an SDK registered before the framework (F68)', function () {
  this.timeout(60000)
  let tracing: ReturnType<typeof installTracing>
  let reader: TestReader
  let provider: PostgresProvider
  let savedLog: any
  const lines: Record<string, any>[] = []

  before(async () => {
    savedLog = (global as any).log
    const stream = new Writable({
      write(chunk, _encoding, done) {
        for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line))
        done()
      }
    })
    ;(global as any).log = createLogger(stream)
    tracing = installTracing()
    reader = new TestReader()
    metricsApi.setGlobalMeterProvider(new metrics.MeterProvider({ readers: [reader] }))
    provider = new PostgresProvider({ pglite: await openPglite() })
  })

  after(async () => {
    await stopTelemetry()
    await provider?.shutdown()
    await tracing?.uninstall()
    ;(global as any).log = savedLog
  })

  it('traces the request under its route, the query under the request, and joins the log line to both', async () => {
    await startTelemetry()
    const server = fastify({ loggerInstance: (global as any).log })
    await registerTelemetry(server)
    server.get('/items/:id', async (req) => {
      req.log.info('inside the route')
      await (provider.control() as any).db.execute(sql`select 1`)
      return { ok: true }
    })

    try {
      const res = await server.inject({ method: 'GET', url: '/items/7?code=c0de&state=st4te' })
      expect(res.statusCode).toBe(200)
    } finally {
      await server.close()
    }

    const spans = tracing.spans()
    const request = spans.find((s) => s.kind === SpanKind.SERVER)
    expect(request?.name).toBe('GET /items/:id')
    expect(request?.attributes['http.route']).toBe('/items/:id')
    expect(request?.attributes['http.response.status_code']).toBe(200)
    // The plugin would record the query string, where a provider sends back its code.
    expect(request?.attributes['url.path']).toBe('/items/7')
    expect(JSON.stringify(spans.map((s) => s.attributes))).not.toMatch(/c0de|st4te/)

    const traceId = request!.spanContext().traceId
    const query = spans.find((s) => s.attributes['db.system.name'] === 'postgresql')
    expect(query?.spanContext().traceId).toBe(traceId)
    expect(query?.parentSpanContext?.spanId).toBeDefined()

    const line = lines.find((l) => l.msg === 'inside the route')
    expect(line?.trace_id).toBe(traceId)
    expect(line?.span_id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('records how long the request took, by route and status', async () => {
    const { resourceMetrics } = await reader.collect()
    const metric = resourceMetrics.scopeMetrics
      .flatMap((s) => s.metrics)
      .find((m) => m.descriptor.name === 'http.server.request.duration')
    const point: any = metric?.dataPoints[0]
    expect(metric?.descriptor.unit).toBe('s')
    expect(point?.attributes).toMatchObject({
      'http.route': '/items/:id',
      'http.response.status_code': 200,
      'http.request.method': 'GET'
    })
    expect(point?.value.count).toBe(1)
  })

  it('keeps the query string out of an outgoing call too, where an API key travels', async () => {
    tracing.reset()
    await startTelemetry()
    const server = fastify()
    await registerTelemetry(server)
    server.get('/ping', async () => ({ ok: true }))
    await server.listen({ port: 0, host: '127.0.0.1' })
    const { port } = server.server.address() as AddressInfo
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping?key=s3cret`)
      expect(res.status).toBe(200)
    } finally {
      await server.close()
    }

    const outgoing = tracing
      .spans()
      .find(
        (s) => s.kind === SpanKind.CLIENT && s.instrumentationScope.name === '@opentelemetry/instrumentation-undici'
      )
    expect(outgoing?.attributes['url.full']).toBe(`http://127.0.0.1:${port}/ping`)
    expect(outgoing?.attributes).not.toHaveProperty(['url.query'])
    expect(JSON.stringify(tracing.spans().map((s) => s.attributes))).not.toContain('s3cret')
  })

  it('stops with the server: the next server gets nothing', async () => {
    const server = fastify()
    await registerTelemetry(server)
    expect(server.hasRequestDecorator('opentelemetry')).toBe(false)
    await server.close()
  })
})
