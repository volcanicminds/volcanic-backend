/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The framework's logger (F63).
//
// Unset, `LOG_LEVEL` used to mean `debug` everywhere, production included: every resolved subject
// and every warning about a bad token went into logs that outlive the request, on a deployment
// where nobody had decided that. The default now follows `NODE_ENV`, and an explicit value always
// wins. The format follows the same rule: JSON lines in production, pretty anywhere else.
//
// What is written is checked on the line itself: a secret in a logged object, a provider's code in
// a URL, and the lines Fastify writes for a request, which go through the same instance.
//
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Writable } from 'node:stream'
import { expect } from 'expect'
import fastify, { LogController } from 'fastify'
import { globSync } from 'glob'
import { createLogger, getLogFormat, getLogLevel, withoutQuery } from '../../lib/util/logger.js'

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

/** A logger writing JSON lines into an array, at the level asked for. */
const capture = (level = 'trace') => {
  const lines: Record<string, any>[] = []
  const stream = new Writable({
    write(chunk, _encoding, done) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line))
      done()
    }
  })
  let logger!: ReturnType<typeof createLogger>
  withEnv({ LOG_LEVEL: level }, () => {
    logger = createLogger(stream)
  })
  return { logger, lines }
}

describe('util/logger · the default level', () => {
  it('is info in production when LOG_LEVEL is not set', () => {
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'production' }, () => {
      expect(getLogLevel()).toBe('info')
    })
  })

  it('is debug anywhere else when LOG_LEVEL is not set', () => {
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: 'development' }, () => {
      expect(getLogLevel()).toBe('debug')
    })
    withEnv({ LOG_LEVEL: undefined, NODE_ENV: undefined }, () => {
      expect(getLogLevel()).toBe('debug')
    })
  })

  it('lets an explicit LOG_LEVEL win, in production too', () => {
    withEnv({ LOG_LEVEL: 'DEBUG', NODE_ENV: 'production' }, () => {
      expect(getLogLevel()).toBe('debug')
    })
  })

  it('treats an unknown LOG_LEVEL as unset, not as debug', () => {
    withEnv({ LOG_LEVEL: 'verbose', NODE_ENV: 'production' }, () => {
      expect(getLogLevel()).toBe('info')
    })
  })

  it('accepts silent', () => {
    withEnv({ LOG_LEVEL: 'silent', NODE_ENV: 'production' }, () => {
      expect(getLogLevel()).toBe('silent')
    })
  })

  it('keeps the level flags in step when the level changes', () => {
    const { logger } = capture('debug')
    expect([logger.d, logger.i]).toEqual([true, true])
    logger.level = 'warn'
    expect([logger.d, logger.i, logger.w]).toEqual([false, false, true])
  })
})

describe('util/logger · the format (F63)', () => {
  it('is json in production and pretty anywhere else', () => {
    withEnv({ LOG_FORMAT: undefined, NODE_ENV: 'production' }, () => {
      expect(getLogFormat()).toBe('json')
    })
    withEnv({ LOG_FORMAT: undefined, NODE_ENV: 'development' }, () => {
      expect(getLogFormat()).toBe('pretty')
    })
  })

  it('lets LOG_FORMAT win', () => {
    withEnv({ LOG_FORMAT: 'PRETTY', NODE_ENV: 'production' }, () => {
      expect(getLogFormat()).toBe('pretty')
    })
    withEnv({ LOG_FORMAT: 'json', NODE_ENV: 'development' }, () => {
      expect(getLogFormat()).toBe('json')
    })
  })

  it('refuses a LOG_FORMAT that is neither', () => {
    withEnv({ LOG_FORMAT: 'text' }, () => {
      expect(() => getLogFormat()).toThrow("LOG_FORMAT must be json or pretty, not 'text'")
      expect(() => createLogger()).toThrow('LOG_FORMAT')
    })
  })

  it('writes JSON lines in production, without a transport', () => {
    withEnv({ LOG_FORMAT: undefined, NODE_ENV: 'production' }, () => {
      expect(createLogger().format).toBe('json')
    })
  })
})

describe('util/logger · what never reaches a line (F63)', () => {
  it('redacts credentials at the top and one level down, and keeps the refusal code', () => {
    const { logger, lines } = capture()
    logger.info(
      {
        password: 'p1',
        body: { password: 'p2', oldPassword: 'p3', token: 't1', refreshToken: 't2', otp: '123456', clientSecret: 's1' },
        headers: { authorization: 'Bearer abc', cookie: 'session=abc', 'set-cookie': ['session=abc'] },
        code: 'AUTH_INVALID_CREDENTIALS'
      },
      'login'
    )
    const line = lines[0]
    expect(line.password).toBe('[redacted]')
    expect(line.body).toEqual({
      password: '[redacted]',
      oldPassword: '[redacted]',
      token: '[redacted]',
      refreshToken: '[redacted]',
      otp: '[redacted]',
      clientSecret: '[redacted]'
    })
    expect(line.headers).toEqual({ authorization: '[redacted]', cookie: '[redacted]', 'set-cookie': '[redacted]' })
    expect(line.code).toBe('AUTH_INVALID_CREDENTIALS')
    expect(JSON.stringify(line)).not.toMatch(/abc|p1|p2|p3|t1|t2|123456|s1/)
  })

  it('still serializes an error with its stack', () => {
    const { logger, lines } = capture()
    logger.error(new Error('boom'))
    expect(lines[0].err.message).toBe('boom')
    expect(lines[0].err.stack).toContain('boom')
  })

  it('leaves the query string out of every log line the framework writes (F63)', () => {
    // A message is a string by the time pino sees it, so `redact` cannot help: the URL has to
    // go through `withoutQuery` before. A cache key keeps the whole URL, and is not a log line.
    const root = path.resolve(import.meta.dirname, '../../lib')
    const offenders = globSync('**/*.ts', { cwd: root }).flatMap((file) =>
      readFileSync(path.join(root, file), 'utf8')
        .split('\n')
        .map((line, i) => ({ where: `lib/${file}:${i + 1}`, line }))
        .filter(({ line }) => /\blog\??\.\w+\(/.test(line) && /\$\{(req|request)\.(url|raw\.url|originalUrl)\}/.test(line))
        .map(({ where }) => where)
    )
    expect(offenders).toEqual([])
    expect(withoutQuery('/a/b?code=1')).toBe('/a/b')
    expect(withoutQuery(undefined)).toBe('')
  })

  it('logs a request URL without its query string', () => {
    const { logger, lines } = capture()
    logger.info({ req: { method: 'GET', url: '/auth/flow/return/oidc?code=c0de&state=st4te' } }, 'returned')
    expect(lines[0].req.url).toBe('/auth/flow/return/oidc')
    expect(JSON.stringify(lines[0])).not.toMatch(/c0de|st4te/)
  })
})

describe('util/logger · Fastify writes through the same instance (F63)', () => {
  it("gives a route's req.log the request id and the redaction, and its own lines the short URL", async () => {
    const { logger, lines } = capture('info')
    const server = fastify({ loggerInstance: logger })
    server.get('/return', async (req) => {
      req.log.info({ body: { password: 'hunter2' } }, 'inside the route')
      return { ok: true }
    })
    try {
      const res = await server.inject({ method: 'GET', url: '/return?code=c0de&state=st4te' })
      expect(res.statusCode).toBe(200)
    } finally {
      await server.close()
    }

    const inside = lines.find((l) => l.msg === 'inside the route')
    expect(inside?.reqId).toBeDefined()
    expect(inside?.body.password).toBe('[redacted]')
    const incoming = lines.find((l) => l.msg === 'incoming request')
    expect(incoming?.req.url).toBe('/return')
    expect(JSON.stringify(lines)).not.toMatch(/hunter2|c0de|st4te/)
  })

  it('writes no per-request line when request logging is off, as without LOG_FASTIFY', async () => {
    const { logger, lines } = capture('info')
    const server = fastify({ loggerInstance: logger, logController: new LogController({ disableRequestLogging: true }) })
    server.get('/quiet', async () => ({ ok: true }))
    try {
      await server.inject({ method: 'GET', url: '/quiet' })
    } finally {
      await server.close()
    }
    expect(lines.filter((l) => l.reqId)).toEqual([])
  })
})
