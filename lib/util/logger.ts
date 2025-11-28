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

const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace']

const { LOG_LEVEL, LOG_COLORIZE, LOG_TIMESTAMP, LOG_TIMESTAMP_READABLE } = process.env

function getLogLevel(): string {
  const lvl = LOG_LEVEL?.toLowerCase()
  return LOG_LEVEL && logLevels.includes(lvl!) ? lvl! : 'debug'
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
