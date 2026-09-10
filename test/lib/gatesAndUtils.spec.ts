/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: the two authorization middlewares, the response log, and two utilities that decide
// what a client reads. None of them had a test.
//
// The middlewares are the interesting half. Both were WRONG in a way a test would have caught
// immediately: `isAuthenticated` only knew about `req.user`, so every control route using it
// answered 401 to a perfectly valid platform token, and `isAdmin` asked only for the tenant
// `admin`, which made a control route guarded by it unreachable by the only identity allowed
// to act on the platform. Both were found by the isolation bench — that is, by a suite written
// for something else.
//
import { expect } from 'expect'
import { preHandler as isAuthenticated } from '../../lib/middleware/isAuthenticated.js'
import { preHandler as isAdmin } from '../../lib/middleware/isAdmin.js'
import onResponse from '../../lib/hooks/onResponse.js'
import { TranslatedError } from '../../lib/util/errors.js'
import { newAuthCode } from '../../lib/util/generate.js'

;(global as any).log = {}

function fakeReply() {
  const sent: any = { code: 200, body: null }
  const reply: any = {
    code(code: number) {
      sent.code = code
      return reply
    },
    send(body: any) {
      sent.body = body
      return reply
    },
    sent
  }
  return reply
}

/** `done()` is how a Fastify preHandler says "carry on", so calling it IS the pass. */
function run(gate: any, req: any) {
  const reply = fakeReply()
  let passed = false
  gate(req, reply, () => {
    passed = true
  })
  return { passed, sent: reply.sent }
}

const asRoles = (codes: string[]) => ({
  roles: () => codes,
  hasRole: (r: any) => codes.includes(r?.code)
})

describe('middleware/isAuthenticated · all three identities (T-9.5)', () => {
  it('lets a tenant user, a platform administrator and a machine token through', () => {
    // Three identities, one question. A platform administrator lands in `req.systemUser` and
    // deliberately NOT in `req.user` — they are not a tenant user — so a gate that only reads
    // `req.user` refuses the one identity the control plane exists for.
    expect(run(isAuthenticated, { user: { id: 'u1' } }).passed).toBe(true)
    expect(run(isAuthenticated, { systemUser: { id: 'sys-1' } }).passed).toBe(true)
    expect(run(isAuthenticated, { token: { id: 't1' } }).passed).toBe(true)
  })

  it('answers 401 UNAUTHORIZED when nobody is behind the request', () => {
    const { passed, sent } = run(isAuthenticated, {})
    expect(passed).toBe(false)
    expect(sent.code).toBe(401)
    expect(sent.body.code).toBe('UNAUTHORIZED')
  })

  it('is not fooled by an identity object without an id', () => {
    // An empty `req.user` is what a half-finished resolution leaves behind, and `{}` is truthy.
    const { passed, sent } = run(isAuthenticated, { user: {}, systemUser: {}, token: {} })
    expect(passed).toBe(false)
    expect(sent.code).toBe(401)
  })
})

describe('middleware/isAdmin · the apex of whichever plane (T-9.5)', () => {
  let savedRoles: any

  // Saved and put back: mocha runs every spec in one process, so a catalogue this suite
  // installs is installed for everybody. Leaving it behind is how another suite starts
  // failing for a reason that is not in its own file.
  before(() => {
    savedRoles = (global as any).roles
    ;(global as any).roles = { public: { code: 'public' }, admin: { code: 'admin' } }
  })

  after(() => {
    ;(global as any).roles = savedRoles
  })

  it('lets the tenant admin and the platform admin through', () => {
    expect(run(isAdmin, { user: { id: 'u1' }, ...asRoles(['admin']) }).passed).toBe(true)
    expect(run(isAdmin, { systemUser: { id: 'sys-1' }, ...asRoles(['system:admin']) }).passed).toBe(true)
  })

  it('refuses an authenticated identity without the apex role', () => {
    const { passed, sent } = run(isAdmin, { user: { id: 'u1' }, ...asRoles(['editor']) })
    expect(passed).toBe(false)
    expect(sent.code).toBe(403)
    expect(sent.body.code).toBe('FORBIDDEN')
  })

  it('does not let a tenant admin pass as a platform admin, or the reverse', () => {
    // The two apexes are separate identities, and `admin` on one plane is not `system:admin`
    // on the other. One field holding either would put the two back in the same slot, which
    // is the confusion T-4.1 exists to remove.
    expect(run(isAdmin, { systemUser: { id: 'sys-1' }, ...asRoles(['admin']) }).passed).toBe(false)
    expect(run(isAdmin, { user: { id: 'u1' }, ...asRoles(['system:admin']) }).passed).toBe(false)
  })

  it('answers 403 and not 401 to an anonymous caller', () => {
    // Deliberate: this gate runs after authentication, so reaching it anonymously means the
    // route's own role check already let it by. 403 is the honest answer for "identified or
    // not, this is not allowed".
    const { sent } = run(isAdmin, { ...asRoles([]) })
    expect(sent.code).toBe(403)
  })
})

describe('hooks/onResponse · the log level follows the status (T-9.5)', () => {
  const lines: Array<[string, string]> = []
  let savedLog: any

  before(() => {
    savedLog = (global as any).log
    ;(global as any).log = {
      i: true,
      t: false,
      info: (m: string) => lines.push(['info', m]),
      warn: (m: string) => lines.push(['warn', m]),
      error: (m: string) => lines.push(['error', m])
    }
  })

  after(() => {
    ;(global as any).log = savedLog
  })

  const log1 = async (statusCode: number) => {
    lines.length = 0
    await onResponse({ method: 'GET', url: '/x', startedAt: new Date() } as any, { statusCode } as any)
    return lines[0]
  }

  it('logs a 2xx as info, a 3xx as a warning and a 4xx or 5xx as an error', async () => {
    // The level is what makes a log searchable: an operator greps for errors, and a 500 filed
    // under info is a 500 nobody finds.
    expect((await log1(200))[0]).toBe('info')
    expect((await log1(302))[0]).toBe('warn')
    expect((await log1(404))[0]).toBe('error')
    expect((await log1(500))[0]).toBe('error')
  })

  it('reports the method, the path, the status and how long it took', async () => {
    const [, message] = await log1(200)
    expect(message).toContain('GET /x 200')
    expect(message).toMatch(/\(\d+ms\)/)
  })
})

describe('util/errors · TranslatedError falls back rather than losing the message (T-9.5)', () => {
  let savedT: any

  before(() => {
    savedT = (global as any).t
    // The i18n double answers only the phrase it knows, which is how a missing translation
    // behaves in practice.
    ;(global as any).t = {
      __: ({ phrase }: any, data: any) => (phrase === 'error.known' ? `Known: ${data?.what ?? ''}` : null)
    }
  })

  after(() => {
    ;(global as any).t = savedT
  })

  it('translates the code when a translation exists, and interpolates the data', () => {
    const err = new TranslatedError({ translationCode: 'error.known', data: { what: 'this' } })
    expect(err.message).toBe('Known: this')
    expect(err.translatedMessage).toBe('Known: this')
    expect(err.status).toBe(400)
  })

  it('falls back to the code, then to the default message, and never to nothing', () => {
    // The chain matters because the last link is what a client reads when everything else is
    // missing, and an error with an empty message is an error nobody can act on.
    expect(new TranslatedError({ translationCode: 'error.absent' }).message).toBe('error.absent')
    expect(
      new TranslatedError({ translationCode: null as never, defaultMessage: 'something specific' as never }).message
    ).toBe('something specific')
    expect(new TranslatedError({ translationCode: null as never }).message).toBe('generic error')
  })

  it('carries the status it was given, so a caller does not have to guess 400', () => {
    expect(new TranslatedError({ translationCode: 'error.absent', status: 409 }).status).toBe(409)
  })
})

describe('util/generate · the authorization code (T-9.5)', () => {
  it('is the configured length, and the default is not zero', () => {
    const previous = process.env.AUTH_CODE_SIZE
    try {
      delete process.env.AUTH_CODE_SIZE
      expect(newAuthCode().length).toBe(10)

      process.env.AUTH_CODE_SIZE = '24'
      expect(newAuthCode().length).toBe(24)

      // A misconfigured value must not silently become a zero-length code, which would be a
      // credential that matches everything.
      process.env.AUTH_CODE_SIZE = 'not-a-number'
      expect(newAuthCode().length).toBe(10)
    } finally {
      if (previous === undefined) delete process.env.AUTH_CODE_SIZE
      else process.env.AUTH_CODE_SIZE = previous
    }
  })

  it('is drawn from an alphabet with no ambiguous punctuation, and does not repeat', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newAuthCode()))
    expect(codes.size).toBe(200)
    for (const code of codes) expect(code).toMatch(/^[A-Za-z0-9]+$/)
  })
})
