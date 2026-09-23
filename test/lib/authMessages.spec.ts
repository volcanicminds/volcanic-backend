/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-8.1 / defect D-17: login and register stop answering the question "does this address have
// an account here?".
//
// v4 answered it four different ways at login — «Wrong credentials», «Invalid user», «User
// email unconfirmed», «User blocked» — and once more at registration, with «Email already
// registered». Those five messages are a directory: fed a list of addresses they say which
// ones exist, and for the ones that do, whether the account is merely unconfirmed or has been
// shut off. The tests below assert that the four login refusals are ONE response, and that a
// registration on a taken address is indistinguishable from one on a free address.
//
import { expect } from 'expect'
import { login, register, refreshToken } from '../../lib/api/auth/controller/auth.js'
import { EMAIL_ALREADY_REGISTERED } from '../../lib/config/constants.js'

;(global as any).log = {}
;(global as any).config = { options: {} }
;(global as any).roles = { public: { code: 'public' }, admin: { code: 'admin' } }

const GOOD = 'Str0ng-passw0rd!'

function fakeReply() {
  const sent: any = { code: 200, body: null }
  const reply: any = {
    status(code: number) {
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

function fakeRequest(data: any, userManager: any) {
  return {
    data: () => data,
    control: { kind: 'control' },
    routeOptions: { config: { tenantContext: false } },
    server: { userManager }
  } as any
}

/** A user manager whose only job is to fail login in the way each test asks for. */
function loginManager(over: any = {}) {
  return {
    isImplemented: () => true,
    isValidUser: (u: any) => !!u,
    isPasswordToBeChanged: () => false,
    retrieveUserByPassword: async () => null,
    retrieveUserByEmail: async () => null,
    ...over
  }
}

async function attemptLogin(manager: any) {
  const reply = fakeReply()
  await login(fakeRequest({ email: 'someone@acme.test', password: GOOD }, manager), reply)
  return reply.sent
}

describe('auth · one refusal for every login failure (D-17)', () => {
  const confirmed = { id: 'u1', externalId: 'x1', email: 'someone@acme.test', confirmed: true, blocked: false }

  it('answers the same for an address that has no account', async () => {
    const sent = await attemptLogin(loginManager())
    expect(sent.code).toBe(401)
    expect(sent.body).toEqual({ statusCode: 401, error: 'Unauthorized', code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' })
  })

  it('answers the same for a wrong password on an address that does have one', async () => {
    const sent = await attemptLogin(loginManager({ retrieveUserByEmail: async () => confirmed }))
    expect(sent.code).toBe(401)
    expect(sent.body.code).toBe('AUTH_INVALID_CREDENTIALS')
  })

  it('answers the same for an unconfirmed account', async () => {
    const sent = await attemptLogin(
      loginManager({ retrieveUserByPassword: async () => ({ ...confirmed, confirmed: false }) })
    )
    expect(sent.code).toBe(401)
    expect(sent.body.code).toBe('AUTH_INVALID_CREDENTIALS')
  })

  it('answers the same for a blocked account', async () => {
    const sent = await attemptLogin(
      loginManager({ retrieveUserByPassword: async () => ({ ...confirmed, blocked: true }) })
    )
    expect(sent.code).toBe(401)
    expect(sent.body.code).toBe('AUTH_INVALID_CREDENTIALS')
  })

  it('gives a blocked account the uniform refusal even when its password also aged out', async () => {
    // v4 checked the expiry first, so a blocked account whose password had aged out received
    // PASSWORD_TO_BE_CHANGED: a distinct code handed to someone the deployment shut out.
    const sent = await attemptLogin(
      loginManager({
        retrieveUserByPassword: async () => ({ ...confirmed, blocked: true }),
        isPasswordToBeChanged: () => true
      })
    )
    expect(sent.body.code).toBe('AUTH_INVALID_CREDENTIALS')
  })

  it('keeps the expired password distinct, because it is reached only after the password verified', async () => {
    const sent = await attemptLogin(
      loginManager({ retrieveUserByPassword: async () => confirmed, isPasswordToBeChanged: () => true })
    )
    expect(sent.code).toBe(403)
    expect(sent.body.code).toBe('PASSWORD_TO_BE_CHANGED')
  })
})

describe('auth · a taken address registers like a free one (D-17, decision A5)', () => {
  const body = { username: 'someone', email: 'Someone@Acme.test', password1: GOOD, password2: GOOD }

  // Registration is closed by default since F49; these cases are about an open one.
  before(() => ((global as any).config.options.accountCreation = { allowed: ['open'], default: 'open' }))
  after(() => delete (global as any).config.options.accountCreation)

  function registerManager(over: any = {}) {
    return {
      isImplemented: () => true,
      createUser: async (_ctx: any, data: any) => ({
        id: 'real-id',
        externalId: 'real-ext',
        username: data.username,
        email: data.email,
        roles: data.roles
      }),
      ...over
    }
  }

  it('returns a body of the same shape, with no account created', async () => {
    const taken = registerManager({
      createUser: async () => {
        throw Object.assign(new Error('Email already registered'), { code: EMAIL_ALREADY_REGISTERED })
      }
    })
    const reply = fakeReply()
    const decoy: any = await register(fakeRequest({ ...body }, taken), reply)

    // No status was ever set, so the route answers 200 exactly as a real registration does.
    expect(reply.sent.code).toBe(200)
    expect(Object.keys(decoy).sort()).toEqual(['email', 'externalId', 'id', 'roles', 'username'])
    expect(decoy.email).toBe('someone@acme.test')
    expect(decoy.roles).toEqual(['public'])
  })

  it('mints decoy identifiers in the shape the database mints, so the version nibble says nothing', async () => {
    const taken = registerManager({
      createUser: async () => {
        throw Object.assign(new Error('Email already registered'), { code: EMAIL_ALREADY_REGISTERED })
      }
    })
    const decoy: any = await register(fakeRequest({ ...body }, taken), fakeReply())
    const uuidV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(decoy.id).toMatch(uuidV7)
    expect(decoy.externalId).toMatch(uuidV7)
    expect(decoy.id).not.toBe(decoy.externalId)
  })

  it('does not look the address up before inserting: the pre-check is the timing oracle', async () => {
    let lookups = 0
    const manager = registerManager({ retrieveUserByEmail: async () => (lookups++, null) })
    await register(fakeRequest({ ...body }, manager), fakeReply())
    expect(lookups).toBe(0)
  })

  it('lets any other failure through instead of dressing it as a duplicate', async () => {
    const broken = registerManager({
      createUser: async () => {
        throw new Error('connection terminated')
      }
    })
    await expect(register(fakeRequest({ ...body }, broken), fakeReply())).rejects.toThrow('connection terminated')
  })
})

describe('auth · refresh when refresh tokens are turned off (T-9.5)', () => {
  //
  // `JWT_REFRESH=false` is a supported deployment: an instance that only issues access tokens.
  // The route still exists, because routes are loaded from the filesystem and not from the
  // configuration, so it has to answer something sensible instead of throwing on a verifier
  // that was never registered — which is what "answer a clean 404 instead of a 500 later"
  // means in the comment beside it. Nothing had ever asked.
  //
  it('answers 404 NOT_FOUND rather than failing on a verifier that was never registered', async () => {
    const reply = fakeReply()
    const req = fakeRequest({ token: 'a', refreshToken: 'b' }, { isImplemented: () => true })
    // A jwt without the `refreshToken` namespace: exactly what @fastify/jwt leaves behind
    // when JWT_REFRESH is off.
    ;(req as any).server.jwt = {}
    ;(reply as any).server = (req as any).server

    await refreshToken(req, reply)

    expect(reply.sent.code).toBe(404)
    expect(reply.sent.body.code).toBe('NOT_FOUND')
  })
})
