/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The pairing code of an integration token on real Postgres (docs/API_V5.md §4.2): off unless
// switched on, single use, ten minutes, one refusal for every code that does not work, and the
// bearer it delivers replaces every bearer issued before, as a reissue does.
//
import { expect } from 'expect'
import { setup, teardown, inject, app, systemToken, createTenant, login, sql, bearer, ACME, HEADER } from './harness.js'

const body = (res: any) => JSON.parse(res.body)
const REFUSED = { statusCode: 401, code: 'PAIRING_CODE_INVALID' }

describe('Token pairing, off by default', function () {
  this.timeout(60000)
  before(async () => await setup())
  after(async () => await teardown())

  it('mounts neither route on either plane: each answers as a path that never existed', async () => {
    const system = await systemToken()
    await createTenant(system, ACME)
    const admin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
    const answer = async (url: string, headers: any) => {
      const res = await inject({ method: 'POST', url, headers, payload: { code: '0000-0000-0000' } })
      const parsed = res.body ? JSON.parse(res.body) : {}
      return { statusCode: res.statusCode, error: parsed.error, code: parsed.code }
    }
    const calls: [string, string, any][] = [
      ['/token/pair', '/token/no-such-thing', { [HEADER]: ACME.slug }],
      ['/token/t1/pairing-code', '/token/t1/no-such-thing', bearer(admin, ACME.slug)],
      ['/system/tokens/pair', '/system/tokens/no-such-thing', {}],
      // A control bearer on a path no route matches is refused before any route would be: the same 401 either way.
      ['/system/tokens/t1/pairing-code', '/system/tokens/t1/no-such-thing', bearer(system)]
    ]
    for (const [url, never, headers] of calls) expect([url, await answer(url, headers)]).toEqual([url, await answer(never, headers)])
  })
})

describe('Token pairing, switched on', function () {
  this.timeout(60000)

  let admin: string
  let system: string
  const asAdmin = (url: string, payload?: any) => inject({ method: 'POST', url, headers: bearer(admin, ACME.slug), payload })
  const exchange = (code: unknown) => inject({ method: 'POST', url: '/token/pair', headers: { [HEADER]: ACME.slug }, payload: { code } })
  const mint = async (name: string) => body(await asAdmin('/token', { name, expiresAt: null }))
  const codeOf = async (id: string) => body(await asAdmin(`/token/${id}/pairing-code`))
  const probe = (token: string) => inject({ method: 'GET', url: '/probe/subject', headers: bearer(token) })

  before(async () => {
    await setup({}, { config: { tokenPairing: { enabled: true } } })
    system = await systemToken()
    await createTenant(system, ACME)
    admin = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
  })
  after(async () => await teardown())

  it('hands a typeable code once, keeps only its hash, and logs both acts', async () => {
    const token = await mint('sentinel')
    const issued = await codeOf(token.id)
    expect(issued.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(new Date(issued.expiresAt).getTime() - Date.now()).toBeGreaterThan(9 * 60 * 1000)
    const row = (await sql().query(`select * from "${ACME.locator}".token where id = $1`, [token.id])).rows[0]
    expect(row.pairing_code_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row)).not.toContain(issued.code.replace(/-/g, ''))

    // Typed back in lower case and without separators, as a person would.
    const paired = await exchange(issued.code.replace(/-/g, '').toLowerCase())
    expect(paired.statusCode).toBe(200)
    expect(Object.keys(body(paired))).toEqual(['token'])

    // The bearer issued at creation is dead, as after a reissue (controlToken.e2e.spec.ts): its
    // `sub` names no row any more. The new one works without naming the tenant.
    expect((await probe(token.token)).statusCode).toBe(404)
    expect((await probe(body(paired).token)).statusCode).toBe(200)

    const acts = (
      await sql().query(`select action from "${ACME.locator}".governance_log where target_id = $1 order by occurred_at, id`, [token.id])
    ).rows.map((r: any) => r.action)
    expect(acts).toEqual(['token.created', 'token.pairing_code_issued', 'token.paired'])
  })

  it('refuses a used, a voided, an expired, an unknown and a malformed code alike', async () => {
    const token = await mint('alike')
    const used = await codeOf(token.id)
    expect((await exchange(used.code)).statusCode).toBe(200)
    const again = await exchange(used.code)

    const voided = await codeOf(token.id)
    const live = await codeOf(token.id)
    const replaced = await exchange(voided.code)

    const expiring = await codeOf(token.id)
    expect(live.code).not.toBe(expiring.code)
    await sql().query(`update "${ACME.locator}".token set pairing_code_expires_at = now() - interval '1 second' where id = $1`, [token.id])
    const expired = await exchange(expiring.code)
    const unknown = await exchange('0000-0000-0000')
    const malformed = await exchange('not a code')

    const answers = [again, replaced, expired, unknown, malformed].map((r) => ({ statusCode: r.statusCode, code: body(r).code, message: body(r).message }))
    for (const answer of answers) expect(answer).toMatchObject(REFUSED)
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1)
  })

  it('a reissue or a block voids the pending code, so it cannot pair once the token is back', async () => {
    const reissued = await mint('reissued')
    const beforeReissue = await codeOf(reissued.id)
    const fresh = body(await asAdmin(`/token/${reissued.id}/reissue`))
    expect(await exchange(beforeReissue.code)).toMatchObject({ statusCode: REFUSED.statusCode })
    expect((await probe(fresh.token)).statusCode).toBe(200)

    const blocked = await mint('blocked')
    const beforeBlock = await codeOf(blocked.id)
    expect((await asAdmin(`/token/${blocked.id}/block`, { reason: 'lost laptop' })).statusCode).toBe(200)
    expect((await asAdmin(`/token/${blocked.id}/unblock`)).statusCode).toBe(200)
    expect(await exchange(beforeBlock.code)).toMatchObject({ statusCode: REFUSED.statusCode })
    expect((await probe(blocked.token)).statusCode).toBe(200)
  })

  it('refuses, like a reissue, a token with the admin role and an expired one', async () => {
    const sovereign = await mint('sovereign')
    await sql().query(`update "${ACME.locator}".token set roles = '{admin,public}' where id = $1`, [sovereign.id])
    const refused = await asAdmin(`/token/${sovereign.id}/pairing-code`)
    expect(refused.statusCode).toBe(403)
    expect(body(refused).code).toBe('TOKEN_ROLE_FORBIDDEN')

    const old = await mint('old')
    await sql().query(`update "${ACME.locator}".token set expires_at = now() - interval '1 second' where id = $1`, [old.id])
    const expired = await asAdmin(`/token/${old.id}/pairing-code`)
    expect(expired.statusCode).toBe(409)
    expect(body(expired).code).toBe('TOKEN_EXPIRED')
  })

  it('pairs a token of the control plane on /system/tokens, signed for the control plane', async () => {
    const created = await inject({ method: 'POST', url: '/system/tokens', headers: bearer(system), payload: { name: 'platform', expiresAt: null } })
    expect(created.statusCode).toBe(200)
    const token = body(created)
    const issued = await inject({ method: 'POST', url: `/system/tokens/${token.id}/pairing-code`, headers: bearer(system) })
    expect(issued.statusCode).toBe(200)

    const paired = await inject({ method: 'POST', url: '/system/tokens/pair', payload: { code: body(issued).code } })
    expect(paired.statusCode).toBe(200)
    const claims: any = app().jwt.verify(body(paired).token)
    expect(claims).toMatchObject({ scp: 'control', typ: 'integration' })
    const row = (await sql().query('select external_id from token where id = $1', [token.id])).rows[0]
    expect(claims.sub).toBe(row.external_id)
    expect(row.external_id).not.toBe(token.externalId)

    const again = await inject({ method: 'POST', url: '/system/tokens/pair', payload: { code: body(issued).code } })
    expect({ statusCode: again.statusCode, code: body(again).code }).toEqual(REFUSED)
  })

  it('throttles the exchange per address', async () => {
    const answers: number[] = []
    for (let i = 0; i < 12; i++) answers.push((await exchange('0000-0000-0000')).statusCode)
    expect(answers).toContain(429)
  })
})
