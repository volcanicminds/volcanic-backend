//
// OpenTelemetry (F64, F68). The framework starts the SDK itself, in `preload()`, when the
// deployment asks for it with the standard `OTEL_*` variables. No `--import` is needed, and
// nothing here patches a module: the loader hooks of `import-in-the-middle` register through
// `module.register()`, which Node 26 deprecates (DEP0205).
//
//   - HTTP: `@fastify/otel`, the first plugin of the server, so every hook and handler runs
//     inside the request span;
//   - queries: the data layer, at the driver (lib/database/adapters/postgres/queryTrace.ts);
//   - outgoing `fetch`: the undici instrumentation, which listens on `diagnostics_channel`;
//   - trace ids on every log line written inside a span (lib/util/logger.ts).
//
// An SDK registered earlier with `--import`, for third-party libraries, is used as it is: the
// framework adds its own instrumentations and leaves the SDK's lifecycle to whoever started it.
// That SDK must not instrument Fastify or undici as well, or their spans come twice.
//
import { metrics, ProxyTracerProvider, trace, type Attributes, type Span } from '@opentelemetry/api'
import type { FastifyInstance, FastifyPluginCallback, FastifyRequest } from 'fastify'
import { withoutQuery } from '../util/logger.js'
import yn from '../util/yn.js'

/** What a deployment installs to turn telemetry on: optional peers, absent by default. */
export const TELEMETRY_PEERS = ['@opentelemetry/sdk-node', '@fastify/otel', '@opentelemetry/instrumentation-undici']

// What an unregistered proxy delegates to: the no-op provider, a singleton of the API.
const NOOP_PROVIDER = new ProxyTracerProvider().getDelegate()

interface Running {
  fastify: { plugin(): FastifyPluginCallback; disable(): void }
  undici: { disable(): void }
  /** Only when the framework started it. */
  sdk?: { shutdown(): Promise<void> }
}
let running: Running | undefined

/** Whether a tracer provider is registered already: an SDK started with `--import`. */
export function sdkRegistered(): boolean {
  return (trace.getTracerProvider() as ProxyTracerProvider).getDelegate?.() !== NOOP_PROVIDER
}

const exporterNamed = (value?: string) => {
  const name = value?.trim().toLowerCase()
  return Boolean(name) && name !== 'none'
}

/**
 * Whether the deployment asks for telemetry: an OTLP endpoint, or a trace or metric exporter
 * other than `none`, unless `OTEL_SDK_DISABLED` is true. The rest (service name, protocol,
 * headers, sampler) the SDK reads by itself.
 */
export function telemetryRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  if (yn(env.OTEL_SDK_DISABLED, false)) return false
  return (
    Boolean(
      env.OTEL_EXPORTER_OTLP_ENDPOINT ||
      env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
      env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT
    ) ||
    exporterNamed(env.OTEL_TRACES_EXPORTER) ||
    exporterNamed(env.OTEL_METRICS_EXPORTER)
  )
}

/**
 * An optional peer, or a boot refusal naming what to install: telemetry a deployment asked for
 * must not quietly become no telemetry.
 */
export async function importPeer<T>(specifier: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    const { code, message } = error as { code?: unknown; message?: unknown }
    if (code === 'ERR_MODULE_NOT_FOUND' && typeof message === 'string' && message.includes(specifier)) {
      throw new Error(
        `Telemetry is on (OTEL_* variables, or an SDK started with --import) but ${specifier} is not installed: ` +
          `npm install ${TELEMETRY_PEERS.join(' ')}`
      )
    }
    throw error
  }
}

/**
 * The plugin records `request.url` as `url.path`, query string included, where a provider sends
 * back its authorization code, and it names every span `request`.
 */
function nameRequestSpan(span: Span, request: FastifyRequest): void {
  span.setAttribute('url.path', withoutQuery(request.url))
  const route = request.routeOptions?.url
  span.updateName(route ? `${request.method} ${route}` : request.method)
}

/**
 * The undici instrumentation records the query string of an outgoing call in `url.full` and
 * `url.query`, where an API key often travels. Merged before the span starts: an undefined value
 * leaves the attribute out.
 */
function outgoingUrl(request: { origin: string; path: string }): Attributes {
  try {
    const url = new URL(request.path, request.origin)
    return { 'url.full': `${url.origin}${url.pathname}`, 'url.query': undefined }
  } catch {
    return {}
  }
}

/** Starts telemetry when it is asked for (preload()). A second call does nothing. */
export async function startTelemetry(): Promise<void> {
  if (running) return
  const external = sdkRegistered()
  if (!external && !telemetryRequested()) return

  const { FastifyOtelInstrumentation } = await importPeer('@fastify/otel', () => import('@fastify/otel'))
  const { UndiciInstrumentation } = await importPeer(
    '@opentelemetry/instrumentation-undici',
    () => import('@opentelemetry/instrumentation-undici')
  )
  const fastify = new FastifyOtelInstrumentation({ requestHook: nameRequestSpan })
  const undici = new UndiciInstrumentation({ startSpanHook: outgoingUrl })

  if (external) {
    running = { fastify, undici }
    if (log.i) log.info('Telemetry: using the OpenTelemetry SDK registered before the framework')
    return
  }

  const { NodeSDK } = await importPeer('@opentelemetry/sdk-node', () => import('@opentelemetry/sdk-node'))
  const sdk = new NodeSDK({ instrumentations: [fastify, undici] })
  sdk.start()
  running = { fastify, undici, sdk }
  if (log.i)
    log.info(
      `Telemetry: OpenTelemetry started for ${process.env.OTEL_SERVICE_NAME || 'an unnamed service (OTEL_SERVICE_NAME)'}`
    )
}

// The boundaries OpenTelemetry's semantic conventions advise for `http.server.request.duration`.
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.25, 0.5, 0.75, 1, 2.5, 5, 7.5, 10]

/** Wires a server (start()), before any other plugin or hook. Nothing when telemetry is off. */
export async function registerTelemetry(server: FastifyInstance): Promise<void> {
  if (!running) return

  // Added before the plugin: a hook added after it gets a span of its own.
  const duration = metrics.getMeter('@volcanicminds/backend').createHistogram('http.server.request.duration', {
    unit: 's',
    description: 'Duration of HTTP server requests.',
    advice: { explicitBucketBoundaries: DURATION_BUCKETS }
  })
  server.addHook('onResponse', async (req, reply) => {
    const attributes: Attributes = {
      'http.request.method': req.method,
      'http.response.status_code': reply.statusCode,
      'url.scheme': req.protocol
    }
    if (req.routeOptions?.url) attributes['http.route'] = req.routeOptions.url
    duration.record(reply.elapsedTime / 1000, attributes)
  })
  server.addHook('onClose', stopTelemetry)

  await server.register(running.fastify.plugin())
}

/** Flushes and stops what the framework started; an SDK started with `--import` stays with its owner. */
export async function stopTelemetry(): Promise<void> {
  const current = running
  running = undefined
  if (!current) return
  current.fastify.disable()
  current.undici.disable()
  await current.sdk?.shutdown()
}
