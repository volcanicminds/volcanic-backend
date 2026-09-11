//
// The log level nobody chose.
//
// Unset, `LOG_LEVEL` used to mean `debug` everywhere, production included: every resolved subject
// and every warning about a bad token went into logs that outlive the request, on a deployment
// where nobody had decided that. The default now follows `NODE_ENV`, and an explicit value always
// wins. `silent` is accepted because pino accepts it and the framework's own e2e script sets it.
//
import { expect } from 'expect'
import logger from '../../lib/util/logger.js'

const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
  const previous: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(vars)) {
    previous[name] = process.env[name]
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    fn()
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

describe('util/logger · the default level', () => {
  it('is info in production when LOG_LEVEL is not set', () => {
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'production' }, () => {
      expect(logger.getLogLevel()).toBe('info')
    })
  })

  it('is debug anywhere else when LOG_LEVEL is not set', () => {
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'development' }, () => {
      expect(logger.getLogLevel()).toBe('debug')
    })
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: undefined }, () => {
      expect(logger.getLogLevel()).toBe('debug')
    })
  })

  it('lets an explicit LOG_LEVEL win, in production too', () => {
    withEnv({ LOG_LEVEL: 'DEBUG', NODE_ENV: 'production' }, () => {
      expect(logger.getLogLevel()).toBe('debug')
    })
  })

  it('treats an unknown LOG_LEVEL as unset, not as debug', () => {
    withEnv({ LOG_LEVEL: 'verbose', NODE_ENV: 'production' }, () => {
      expect(logger.getLogLevel()).toBe('info')
    })
  })

  it('accepts silent', () => {
    withEnv({ LOG_LEVEL: 'silent', NODE_ENV: 'production' }, () => {
      expect(logger.getLogLevel()).toBe('silent')
    })
  })
})
