/* eslint-disable @typescript-eslint/no-explicit-any */
//
// An integration token bound to a key (RFC 9449, lib/util/dpop.ts): through the real hook, a
// bound bearer authenticates only beside a proof its key signed for that request, and only once.
//
import { expect } from 'expect'
import fastify from 'fastify'
import jwtValidator from '@fastify/jwt'
import authHook from '../../lib/hooks/onRequest.js'
import { INTEGRATION_TYP } from '../../lib/util/credential.js'
import { DPOP_WINDOW_S, jwkThumbprint, publicJwkOf } from '../../lib/util/dpop.js'
import { machineKey } from './fixtures/dpop.js'

;(global as any).log = {}

const SECRET = 'token-binding-test-secret-32-chars!!'
const TOKEN = { id: 't1', externalId: 't-ext-1', roles: ['admin'] }
const ORIGIN = 'https://rag.example.test'

async function build() {
  const server: any = fastify()
  await server.register(jwtValidator, { secret: SECRET })
  server.decorate('tokenManager', {
    isImplemented: () => true,
    isValidToken: async () => true,
    retrieveTokenByExternalId: async (_c: any, ext: string) => (ext === TOKEN.externalId ? TOKEN : null)
  })
  server.addHook('onRequest', async (req: any) => {
    req.control = { kind: 'control' }
    req.tenant = { kind: 'tenant', tenantId: 'acme' }
    req.tenantInfo = { id: 'acme', slug: 'acme' }
  })
  server.addHook('onRequest', authHook)
  const config = { config: { tenantContext: true, requiredRoles: [{ code: 'admin' }] } }
  server.get('/orders', config, async (req: any) => ({ who: req.token?.id ?? null }))
  server.post('/orders', config, async (req: any) => ({ who: req.token?.id ?? null }))
  server.get('/open', { config: { tenantContext: true, requiredRoles: [{ code: 'public' }] } }, async (req: any) => ({ who: req.token?.id ?? null }))
  await server.ready()
  return server
}

describe('tokens · a bearer bound to a key needs a proof at every request (RFC 9449)', () => {
  let server: any
  let saved: any
  const key = machineKey()
  const bound = () => server.jwt.sign({ sub: TOKEN.externalId, typ: INTEGRATION_TYP, tid: 'acme', cnf: { jkt: jwkThumbprint(publicJwkOf(key.jwk)!) } })
  const call = (method: string, url: string, headers: Record<string, string>) => server.inject({ method, url, headers })
  const answer = (res: any) => ({ status: res.statusCode, code: res.statusCode === 200 ? undefined : JSON.parse(res.body).code })

  before(async () => {
    saved = { roles: (global as any).roles, config: (global as any).config }
    ;(global as any).roles = { public: { code: 'public' }, admin: { code: 'admin' } }
    ;(global as any).config = { options: {} }
    server = await build()
  })
  after(async () => {
    ;(global as any).roles = saved.roles
    ;(global as any).config = saved.config
    await server.close()
  })

  it('takes the thumbprint of RFC 8037 §A.3, and accepts only public Ed25519 and P-256 keys', () => {
    const rfc = publicJwkOf({ kty: 'OKP', crv: 'Ed25519', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' })!
    expect(jwkThumbprint(rfc)).toBe('kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k')
    expect(publicJwkOf(machineKey('p256').jwk)).not.toBeNull()
    expect(publicJwkOf({ ...rfc, d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A' })).toBeNull()
    expect(publicJwkOf({ kty: 'OKP', crv: 'X25519', x: rfc.x })).toBeNull()
    expect(publicJwkOf({ kty: 'OKP', crv: 'Ed25519', x: 'c2hvcnQ' })).toBeNull()
    // A P-256 point off the curve.
    expect(publicJwkOf({ kty: 'EC', crv: 'P-256', x: rfc.x, y: rfc.x })).toBeNull()
    expect(publicJwkOf('a key')).toBeNull()
  })

  it('refuses the bearer alone, under either scheme', async () => {
    const token = bound()
    expect(answer(await call('GET', '/orders', { authorization: `Bearer ${token}` }))).toEqual({ status: 401, code: 'DPOP_REQUIRED' })
    expect(answer(await call('GET', '/orders', { authorization: `DPoP ${token}` }))).toEqual({ status: 401, code: 'DPOP_PROOF_INVALID' })
  })

  it('accepts it with a proof its key signed for the request, once', async () => {
    const token = bound()
    const proof = key.proof('GET', `${ORIGIN}/orders`, token)
    const first = await call('GET', '/orders?page=2', { authorization: `DPoP ${token}`, dpop: proof })
    expect([first.statusCode, JSON.parse(first.body)]).toEqual([200, { who: 't1' }])
    expect(answer(await call('GET', '/orders', { authorization: `DPoP ${token}`, dpop: proof }))).toEqual({ status: 401, code: 'DPOP_PROOF_INVALID' })
  })

  it('refuses a proof signed for another method, URL, token, time or key, or not signed as it says', async () => {
    const token = bound()
    const now = Math.floor(Date.now() / 1000)
    const other = machineKey()
    const proofs: Record<string, string> = {
      method: key.proof('POST', `${ORIGIN}/orders`, token),
      url: key.proof('GET', `${ORIGIN}/invoices`, token),
      token: key.proof('GET', `${ORIGIN}/orders`, `${token}x`),
      stale: key.proof('GET', `${ORIGIN}/orders`, token, { claims: { iat: now - DPOP_WINDOW_S - 5 } }),
      future: key.proof('GET', `${ORIGIN}/orders`, token, { claims: { iat: now + DPOP_WINDOW_S + 5 } }),
      key: other.proof('GET', `${ORIGIN}/orders`, token),
      // Another key's proof presented as this key's: the header names the bound key, the signature is the other's.
      signature: other.proof('GET', `${ORIGIN}/orders`, token, { header: { jwk: key.jwk } }),
      typ: key.proof('GET', `${ORIGIN}/orders`, token, { header: { typ: 'JWT' } }),
      alg: key.proof('GET', `${ORIGIN}/orders`, token, { header: { alg: 'none' } }),
      jti: key.proof('GET', `${ORIGIN}/orders`, token, { claims: { jti: undefined } }),
      garbage: 'not.a.proof'
    }
    const answers: Record<string, unknown> = {}
    for (const [name, proof] of Object.entries(proofs)) answers[name] = answer(await call('GET', '/orders', { authorization: `DPoP ${token}`, dpop: proof }))
    for (const name of Object.keys(proofs)) expect([name, answers[name]]).toEqual([name, { status: 401, code: 'DPOP_PROOF_INVALID' }])
  })

  it('takes the exact path the client called, the prefix a proxy strips included, and a P-256 key as well', async () => {
    const token = bound()
    const post = (url: string) => call('POST', '/orders', { authorization: `DPoP ${token}`, dpop: key.proof('POST', url, token) })
    const refused = { status: 401, code: 'DPOP_PROOF_INVALID' }
    // Signed for a longer path that ends with this one: another route, unless a proxy is declared.
    expect(answer(await post(`${ORIGIN}/api/orders`))).toEqual(refused)
    expect(answer(await post(`${ORIGIN}/xorders`))).toEqual(refused)
    process.env.COOKIE_PATH_PREFIX = '/api'
    try {
      expect((await post(`${ORIGIN}/api/orders`)).statusCode).toBe(200)
      expect(answer(await post(`${ORIGIN}/v2/api/orders`))).toEqual(refused)
      expect(answer(await post(`${ORIGIN}/orders`))).toEqual(refused)
    } finally {
      delete process.env.COOKIE_PATH_PREFIX
    }
    expect((await post(`${ORIGIN}/orders`)).statusCode).toBe(200)

    const p256 = machineKey('p256')
    const ecToken = server.jwt.sign({ sub: TOKEN.externalId, typ: INTEGRATION_TYP, cnf: { jkt: jwkThumbprint(publicJwkOf(p256.jwk)!) } })
    expect((await call('GET', '/orders', { authorization: `DPoP ${ecToken}`, dpop: p256.proof('GET', `${ORIGIN}/orders`, ecToken) })).statusCode).toBe(200)
  })

  it('keeps an unbound token under Bearer, and refuses it under DPoP whatever the proof', async () => {
    const plain = server.jwt.sign({ sub: TOKEN.externalId, typ: INTEGRATION_TYP })
    expect((await call('GET', '/orders', { authorization: `Bearer ${plain}` })).statusCode).toBe(200)
    const res = await call('GET', '/orders', { authorization: `DPoP ${plain}`, dpop: key.proof('GET', `${ORIGIN}/orders`, plain) })
    expect(answer(res)).toEqual({ status: 401, code: 'DPOP_PROOF_INVALID' })
  })

  it('treats a bound token without its proof as no credential on a public route', async () => {
    const res = await call('GET', '/open', { authorization: `Bearer ${bound()}` })
    expect([res.statusCode, JSON.parse(res.body)]).toEqual([200, { who: null }])
  })
})
