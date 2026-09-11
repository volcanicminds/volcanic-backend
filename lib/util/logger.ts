'use strict'

/**
 * Minimal logger (thanks Pino)
 */

// log.debug('test log test log test log')
// log.error('test log test log test log')
// log.warn('test log test log test log')
// log.info('test log test log test log')
// log.fatal('test log test log test log')
// log.trace('test log test log test log')

import pino from 'pino'
import yn from './yn.js'

// `silent` is pino's own level for "nothing". It was missing, so `LOG_LEVEL=silent` (which the
// framework's own e2e script sets) was an unknown value and fell back to the default.
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']

const { LOG_COLORIZE, LOG_TIMESTAMP, LOG_TIMESTAMP_READABLE } = process.env

/**
 * The level to log at: `LOG_LEVEL` when it names one, otherwise a default that depends on where
 * the process runs. `debug` on a developer's machine, `info` in production: a production default
 * of `debug` writes every query and every resolved subject into logs that outlive the request,
 * and nobody chose it, because nobody set anything.
 *
 * Read at call time and not at import: `index.ts` loads `.env` after its imports have run, so a
 * value captured here at import would ignore a `LOG_LEVEL` or `NODE_ENV` that lives in `.env`.
 * `index.ts` calls this again once the file is loaded.
 */
function getLogLevel(): string {
  const declared = process.env.LOG_LEVEL?.toLowerCase()
  if (declared && logLevels.includes(declared)) return declared
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug'
}

const logColorize = yn(LOG_COLORIZE, true)
const logTimestamp = yn(LOG_TIMESTAMP, true)
const logTimestampReadable = yn(LOG_TIMESTAMP_READABLE, true)

const loggerConfig = {
  level: getLogLevel(),
  timestamp: logTimestamp,
  transport: {
    target: 'pino-pretty',
    options: {
      translateTime: logTimestampReadable ? 'yyyymmdd HH:MM:ss.l' : false,
      colorize: logColorize
    }
  }
}

const logger = pino(loggerConfig)
const logLevel = logger.levels.values[loggerConfig.level]

// Level:	trace	debug	info	warn	error	fatal	silent
// Value:	10	20	30	40	50	60	Infinity

const loggerExt = Object.assign(logger, {
  t: logLevel < 11,
  d: logLevel < 21,
  i: logLevel < 31,
  w: logLevel < 41,
  e: logLevel < 51,
  f: logLevel < 61,
  getLogLevel: getLogLevel,
  loggerConfig: loggerConfig,
  updateLevel: () => {
    loggerExt.t = loggerExt.levelVal < 11
    loggerExt.d = loggerExt.levelVal < 21
    loggerExt.i = loggerExt.levelVal < 31
    loggerExt.w = loggerExt.levelVal < 41
    loggerExt.e = loggerExt.levelVal < 51
    loggerExt.f = loggerExt.levelVal < 61
  }
})

loggerExt.on('level-change', () => {
  log.trace('Log level changed')
})

export default loggerExt
