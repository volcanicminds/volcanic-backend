'use strict'

//
// The framework's logger (F63): pino, JSON lines in production, `pino-pretty` on a developer's
// machine. Fastify receives the same instance as `loggerInstance`, so `req.log` writes where
// `log` does.
//
// Built by a factory and not at import: ESM evaluates every import before the body of the entry
// module, which is where `.env` is loaded, so a logger built at import time could not see a
// `LOG_LEVEL`, `LOG_FORMAT` or `NODE_ENV` that lives in `.env`.
//

import { isSpanContextValid, trace } from '@opentelemetry/api'
import pino, { type DestinationStream, type LoggerOptions } from 'pino'
import yn from './yn.js'

// `silent` is pino's own level for "nothing". The framework's own e2e script sets it.
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']

/**
 * The level to log at: `LOG_LEVEL` when it names one, otherwise a default that depends on where
 * the process runs. `debug` on a developer's machine, `info` in production: a production default
 * of `debug` writes every query and every resolved subject into logs that outlive the request,
 * and nobody chose it, because nobody set anything.
 */
export function getLogLevel(): string {
  const declared = process.env.LOG_LEVEL?.toLowerCase()
  if (declared && logLevels.includes(declared)) return declared
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

export type LogFormat = 'json' | 'pretty'

/**
 * `json` in production, where a collector parses the lines, `pretty` anywhere else. `LOG_FORMAT`
 * wins, and a value that is neither stops the boot: a typo must not silently pick a format.
 */
export function getLogFormat(): LogFormat {
  const declared = process.env.LOG_FORMAT?.trim().toLowerCase()
  if (!declared) return process.env.NODE_ENV === 'production' ? 'json' : 'pretty'
  if (declared === 'json' || declared === 'pretty') return declared
  throw new Error(`LOG_FORMAT must be json or pretty, not '${process.env.LOG_FORMAT}'`)
}

// The credentials the framework's own routes carry, at the top of a logged object and one level
// down. `code` is not here on purpose: it is the refusal code of every framework error.
const SECRET_KEYS = [
  'password',
  'oldPassword',
  'newPassword',
  'token',
  'refreshToken',
  'secret',
  'clientSecret',
  'otp',
  'authorization',
  'cookie'
]

/** What pino replaces with `[redacted]` before a line is written. */
export const REDACTED_PATHS = [
  ...SECRET_KEYS.flatMap((key) => [key, `*.${key}`]),
  'req.headers.authorization',
  'req.headers.cookie',
  '*["set-cookie"]',
  'res.headers["set-cookie"]'
]

/**
 * A URL as a log line may show it: the path, never the query string. A provider sends its
 * authorization code and its state back there (`returnFrom` in lib/auth/http.ts), and `redact`
 * cannot reach inside a message that is already a string.
 */
export function withoutQuery(url: string | undefined): string {
  return typeof url === 'string' ? url.split('?')[0] : ''
}

/** Fastify's request serializer, with the URL as a log may show it. The instance's serializers win over Fastify's own. */
function serializeRequest(req: {
  method?: string
  url?: string
  host?: string
  ip?: string
  socket?: { remotePort?: number }
}) {
  return {
    method: req.method,
    url: withoutQuery(req.url),
    host: req.host,
    remoteAddress: req.ip,
    remotePort: req.socket?.remotePort
  }
}

/**
 * The active span's ids on a line written inside it, under the names OpenTelemetry's own pino
 * instrumentation uses, so a collector joins a log line to its trace (F68). Without an SDK there
 * is no active span and the line is unchanged.
 */
export function traceFields(): Record<string, string> {
  const spanContext = trace.getActiveSpan()?.spanContext()
  if (!spanContext || !isSpanContextValid(spanContext)) return {}
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
    trace_flags: `0${spanContext.traceFlags.toString(16)}`
  }
}

/**
 * A logger configured from the environment as it is now. With a `destination`, the lines go
 * there as JSON whatever `LOG_FORMAT` says: pretty printing is for a console, and pino runs it in
 * a worker that cannot share a caller's stream.
 */
export function createLogger(destination?: DestinationStream) {
  const level = getLogLevel()
  const format = destination ? 'json' : getLogFormat()

  const options: LoggerOptions = {
    level,
    timestamp: yn(process.env.LOG_TIMESTAMP, true),
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    // Listing serializers replaces pino's defaults, so `err` is named again.
    serializers: { err: pino.stdSerializers.err, req: serializeRequest },
    mixin: traceFields
  }
  if (format === 'pretty') {
    options.transport = {
      target: 'pino-pretty',
      options: {
        translateTime: yn(process.env.LOG_TIMESTAMP_READABLE, true) ? 'yyyymmdd HH:MM:ss.l' : false,
        colorize: yn(process.env.LOG_COLORIZE, true)
      }
    }
  }

  const logger = destination ? pino(options, destination) : pino(options)

  // Level:	trace	debug	info	warn	error	fatal	silent
  // Value:	10	20	30	40	50	60	Infinity
  const loggerExt = Object.assign(logger, {
    format,
    t: false,
    d: false,
    i: false,
    w: false,
    e: false,
    f: false,
    updateLevel: () => {
      loggerExt.t = loggerExt.levelVal < 11
      loggerExt.d = loggerExt.levelVal < 21
      loggerExt.i = loggerExt.levelVal < 31
      loggerExt.w = loggerExt.levelVal < 41
      loggerExt.e = loggerExt.levelVal < 51
      loggerExt.f = loggerExt.levelVal < 61
    }
  })
  loggerExt.updateLevel()
  loggerExt.on('level-change', () => {
    loggerExt.updateLevel()
    loggerExt.trace('Log level changed')
  })
  return loggerExt
}

export type VolcanicLogger = ReturnType<typeof createLogger>
