//
// Query spans (F68): one CLIENT span per statement that reaches the driver, emitted here and
// not by a patch of `pg`, so PGlite has them too and no loader hook is needed. The guard
// (guard.ts) calls in at the same choke point where it judges the statement.
//
// Without an SDK nothing is computed: the check below is one comparison per statement, and the
// regular expressions run only for a span somebody records.
//
import {
  ProxyTracerProvider,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer
} from '@opentelemetry/api'

const TRACER_NAME = '@volcanicminds/backend/db'

// What an unregistered proxy delegates to: the no-op provider, a singleton of the API.
const NOOP_PROVIDER = new ProxyTracerProvider().getDelegate()

let cachedProvider: unknown
let cachedTracer: Tracer | undefined

/**
 * The tracer, or undefined while no SDK is registered. Asked for each statement and cached by
 * provider: `trace.disable()` replaces the API's proxy, and a tracer taken once at import would
 * keep writing to the provider that was there before.
 */
function activeTracer(): Tracer | undefined {
  const provider = trace.getTracerProvider() as ProxyTracerProvider
  if (provider.getDelegate?.() === NOOP_PROVIDER) return undefined
  if (provider !== cachedProvider) {
    cachedProvider = provider
    cachedTracer = provider.getTracer(TRACER_NAME)
  }
  return cachedTracer
}

const STRING_LITERAL = /'(?:[^']|'')*'/g
// `$tag$ ... $tag$`, and `$$ ... $$`. A placeholder (`$1`) never matches: a tag cannot start with a digit.
const DOLLAR_QUOTED = /\$([A-Za-z_][A-Za-z0-9_]*)?\$[\s\S]*?\$\1\$/g
const OPERATION = /^\s*(?:(?:\/\*[\s\S]*?\*\/|--[^\n]*)\s*)*([A-Za-z]+)/

/**
 * A statement as a span may show it: every literal becomes `?`. Drizzle sends values as
 * parameters, which a span never carries; a literal is what raw SQL, DDL or a migration wrote.
 */
export function sanitizeQueryText(text: string): string {
  return text.replace(DOLLAR_QUOTED, '?').replace(STRING_LITERAL, '?')
}

/** Where a statement goes: a `pg` client carries these fields, PGlite has none. */
export interface QueryTarget {
  database?: unknown
  host?: unknown
  port?: unknown
}

/** The span of one statement, started in the active context, or undefined when nobody records. */
export function startQuerySpan(text: string, target?: QueryTarget): Span | undefined {
  const tracer = activeTracer()
  if (!tracer) return undefined

  const operation = OPERATION.exec(text)?.[1]?.toUpperCase()
  const attributes: Attributes = { 'db.system.name': 'postgresql', 'db.query.text': sanitizeQueryText(text) }
  if (operation) attributes['db.operation.name'] = operation
  if (typeof target?.database === 'string') attributes['db.namespace'] = target.database
  if (typeof target?.host === 'string') attributes['server.address'] = target.host
  if (typeof target?.port === 'number') attributes['server.port'] = target.port

  return tracer.startSpan(operation ?? 'postgresql', { kind: SpanKind.CLIENT, attributes })
}

/** Ends the span; a failure keeps its SQLSTATE, which says what went wrong without the values. */
export function endQuerySpan(span: Span, error?: unknown): void {
  if (error) {
    const { code, name, message } = error as { code?: unknown; name?: unknown; message?: unknown }
    const type = typeof code === 'string' ? code : typeof name === 'string' ? name : 'Error'
    if (typeof code === 'string') span.setAttribute('db.response.status_code', code)
    span.setAttribute('error.type', type)
    span.setStatus({ code: SpanStatusCode.ERROR, message: typeof message === 'string' ? message : undefined })
    if (error instanceof Error) span.recordException(error)
  }
  span.end()
}

/** Runs a statement that answers with a promise, or with a value, inside its span. */
export function settleInSpan<T>(span: Span, run: () => T): T {
  let result: T
  try {
    result = run()
  } catch (error) {
    endQuerySpan(span, error)
    throw error
  }
  if (result && typeof (result as { then?: unknown }).then === 'function') {
    return (result as unknown as Promise<unknown>).then(
      (value) => {
        endQuerySpan(span)
        return value
      },
      (error) => {
        endQuerySpan(span, error)
        throw error
      }
    ) as T
  }
  endQuerySpan(span)
  return result
}

/** A driver callback `(err, res)` that ends the span before it hands the result on. */
export function endingCallback(span: Span, callback: (...args: unknown[]) => unknown) {
  return (error: unknown, ...rest: unknown[]) => {
    endQuerySpan(span, error ?? undefined)
    return callback(error, ...rest)
  }
}
