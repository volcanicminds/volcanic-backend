/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: the refusals of the authentication hook, each one fired by the condition that
// reaches it.
//
// Every code below was written, reviewed and then never seen again — no test made any of them
// fire. That is not a gap in coverage percentages, it is a gap in knowledge: a guard nobody
// has watched work may sit on a path the request never takes, may read a field that does not
// exist, may be unreachable. Defect D-03 was exactly that shape — an anti-spoofing check
// comparing a property the entity did not have, in a hook that ran before the one that would
// have populated it. It never fired, nothing failed, and for two years the tenant was decided
// by a header.
//
// So these tests go through `server.inject`: a real request, a real token, the real hook
// order. Calling the guard directly would prove that it throws when invoked, which is not the
// thing in doubt.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import authHook from '../../lib/hooks/onRequest.js'

const SECRET = 'auth-refusals-test-secret-32-chars!'

const USER = { id: 'u1', externalId: 'u-ext-1', email: 'anna@acme.test', roles: ['admin'], blocked: false }
const TOKEN_SUBJECT = { id: 't1', externalId: 't-ext-1', roles: ['admin'] }

;(global as any).log = {}

let savedRoles: any
let savedConfig: any
let savedMode: string | undefined

/**
 * A server with the hook under test and one route per shape it has to refuse.
 *
 * The managers are doubles, and what each returns is the whole experiment: "the user exists
 * and is blocked" and "the user does not exist" are different refusals, and the only way to
 * tell whether the hook keeps them apart is to arrange each and read the code back.
 */
async function build(opts: any = {}) {
  ;(global as any).config = { options: { tenants: opts.tenants ?? null } }

  const server: any = fastify()
  server.decorate('provider', {})
  server.decorate('userManager', {
    isImplemented: () => opts.users !== false,
    isValidUser: async () => opts.userValid !== false,
    retrieveUserByExternalId: async (_ctx: any, id: string) => (opts.userExists === false ? null : id === USER.externalId ? USER : null)
  })
  server.decorate('tokenManager', {
    isImplemented: () => opts.tokens === true,
    isValidToken: async () => opts.tokenValid !== false,
    retrieveTokenByExternalId: async (_ctx: any, id: string) => (id === TOKEN_SUBJECT.externalId ? TOKEN_SUBJECT : null)
  })
  server.decorate('systemUserManager', { isImplemented: () => false })
  server.decorate('impersonationManager', {
    isImplemented: () => opts.impersonation === true,
    retrieveImpersonation: async () => null
  })

  await server.register(jwtValidator, { secret: SECRET })

  server.addHook('onRequest', async (req: any) => {
    req.data = () => ({})
    req.parameters = () => ({})
    req.control = { kind: 'control' }
  })
  server.addHook('onRequest', authHook)

  server.get('/orders', { config: { requiredRoles: [{ code: 'admin' }] } }, async () => ({ ok: true }))
  server.get('/open', { config: { requiredRoles: [{ code: 'public' }] } }, async (req: any) => ({ who: req.user?.email ?? null }))
  server.get('/public', { config: { requiredRoles: [{ code: 'public' }] } }, async (req: any) => ({ who: req.user?.id ?? null }))

  await server.ready()
  return server
}

const call = (server: any, url: string, token?: string) =>
  server.inject({ method: 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {} })

const codeOf = (res: any) => {
  try {
    return JSON.parse(res.body)?.code ?? 'NO_CODE'
  } catch {
    return 'NO_BODY'
  }
}

describe('hooks/onRequest · the refusals, each one provoked (T-9.5)', () => {
  before(() => {
    savedRoles = (global as any).roles
    savedConfig = (global as any).config
    ;(global as any).roles = { public: { code: 'public', name: 'Public' }, admin: { code: 'admin', name: 'Admin' } }
    // The refusals below are those of a session presented in the header, which since T-10.37
    // is the bearer mode only. The channel rules of the default mode are authChannels.spec.ts.
    savedMode = process.env.AUTH_MODE
    process.env.AUTH_MODE = 'BEARER'
  })

  after(() => {
    ;(global as any).roles = savedRoles
    ;(global as any).config = savedConfig
    if (savedMode === undefined) delete process.env.AUTH_MODE
    else process.env.AUTH_MODE = savedMode
  })

  it('answers 401 UNAUTHORIZED to an anonymous request for a protected route', async () => {
    const server = await build()
    const res = await call(server, '/orders')
    // 401 and not 403: nobody has been identified, so "log in first" is the honest answer.
    // 403 would tell an anonymous caller that their credentials were insufficient, which is a
    // statement about credentials they never sent.
    expect(res.statusCode).toBe(401)
    expect(codeOf(res)).toBe('UNAUTHORIZED')
    await server.close()
  })

  it('answers 401 UNAUTHORIZED to a token it cannot verify', async () => {
    const server = await build()
    const res = await call(server, '/orders', 'not-a-jwt-at-all')
    expect(res.statusCode).toBe(401)
    expect(codeOf(res)).toBe('UNAUTHORIZED')
    await server.close()
  })

  it('treats a bad token as no token on a public route, instead of refusing it', async () => {
    // The other half of the same branch, and the reason it is not simply a 401 everywhere: a
    // public route must answer an expired token, or every stale tab becomes an error page.
    const server = await build()
    const res = await call(server, '/open', 'not-a-jwt-at-all')
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).who).toBe(null)
    await server.close()
  })

  it('answers 403 USER_NOT_VALID for a user the manager rejects', async () => {
    const server = await build({ userValid: false })
    const token = server.jwt.sign({ sub: USER.externalId })
    const res = await call(server, '/orders', token)
    // Distinct from SUBJECT_NOT_FOUND on purpose: "blocked" and "does not exist" are different
    // facts for the operator reading the log, and a signed token proves the caller was once
    // legitimate, so there is nothing to hide from them here.
    expect(res.statusCode).toBe(403)
    expect(codeOf(res)).toBe('USER_NOT_VALID')
    await server.close()
  })

  it('answers 403 TOKEN_NOT_VALID for a machine token the manager rejects', async () => {
    const server = await build({ users: false, tokens: true, tokenValid: false })
    const token = server.jwt.sign({ sub: TOKEN_SUBJECT.externalId })
    const res = await call(server, '/orders', token)
    expect(res.statusCode).toBe(403)
    expect(codeOf(res)).toBe('TOKEN_NOT_VALID')
    await server.close()
  })

  it('answers 404 SUBJECT_NOT_FOUND when a valid signature names nobody', async () => {
    // The signature is good and the subject is gone: a user deleted while a token was still in
    // someone's browser. Answering 401 would invite a retry that cannot ever succeed.
    const server = await build({ userExists: false })
    const token = server.jwt.sign({ sub: 'u-ext-vanished' })
    const res = await call(server, '/orders', token)
    expect(res.statusCode).toBe(404)
    expect(codeOf(res)).toBe('SUBJECT_NOT_FOUND')
    await server.close()
  })

  it('refuses a pre-auth MFA token everywhere, the MFA routes included (T-12.35, F36)', async () => {
    const server = await build()
    const halfway = server.jwt.sign({ sub: USER.externalId, role: 'pre-auth-mfa' })

    // The second factor is a stage of the login flow, whose credential is not a JWT. A token of
    // the old kind still alive across a deploy is therefore nobody: there is no list of routes
    // it may reach any more, and without one it would pass for a session.
    const refused = await call(server, '/orders', halfway)
    expect([refused.statusCode, codeOf(refused)]).toEqual([401, 'UNAUTHORIZED'])

    // A public route answers, as it does to a bad token: to nobody.
    const open = await call(server, '/public', halfway)
    expect([open.statusCode, JSON.parse(open.body)]).toEqual([200, { who: null }])
    await server.close()
  })

  it('answers 503 IMPERSONATION_NOT_AVAILABLE for an impersonation token in a build without one', async () => {
    // 503 and not 403: the caller did nothing wrong, the deployment cannot honour the token.
    // Recording the difference is what lets an operator tell a misconfiguration from an
    // attempt.
    const server = await build({ impersonation: false })
    const token = server.jwt.sign({ sub: USER.externalId, imp: 'imp-1' })
    const res = await call(server, '/orders', token)
    expect(res.statusCode).toBe(503)
    expect(codeOf(res)).toBe('IMPERSONATION_NOT_AVAILABLE')
    await server.close()
  })
})
