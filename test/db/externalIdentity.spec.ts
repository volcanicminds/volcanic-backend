/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.27: who an identity from a provider is here (F40), on the real stores of a migrated
// container. Each of the three ways in is opt-in, and each of the cases below is a way an account
// would be taken over if it were not: an unverified address, a domain nobody listed, JIT that was
// off, JIT that grants admin, and one `sub` presented by two issuers.
//
import { expect } from 'expect'
import type { AuthContext, ExternalAuthResult } from '../../types/global.js'
import { resolveExternal } from '../../lib/auth/external.js'
import type { ResolvedProvider } from '../../lib/auth/providers.js'
import { createExternalIdentityManager } from '../../lib/database/managers/externalIdentity.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from './fixtures/migrated.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'
;(global as any).log = {}
;(global as any).roles = (global as any).roles ?? { public: { code: 'public' }, admin: { code: 'admin' } }

const ISSUER = 'https://login.acme-idp.test/v2.0'

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`auth · external identities on ${name} (T-12.27)`, function () {
    this.timeout(30000)
    let db: Migrated
    const users = createUserManager()
    const links = createExternalIdentityManager()
    let seq = 0

    before(async () => (db = await open()))
    after(async () => await db?.close())

    const ctx = (plane: 'tenant' | 'control' = 'tenant'): AuthContext =>
      ({
        plane,
        handle: plane === 'tenant' ? db.tenant : db.control,
        tenant: null,
        subject: null,
        policy: 'OPTIONAL',
        managers: { userManager: users, externalIdentityManager: links, systemUserManager: {} },
        flow: null,
        limits: { flowTtl: 600, otpTtl: 300, otpMaxAttempts: 5, otpMaxSends: 3 },
        challenges: null
      }) as any

    const provider = (settings: Record<string, unknown> = {}): ResolvedProvider => ({
      key: 'acme',
      type: 'oidc',
      source: 'tenant',
      settings: { issuer: ISSUER, clientId: 'c', redirectUri: 'https://api.test/auth/flow/return/oidc', ...settings },
      clientSecret: 'x'
    })

    const unique = () => `${++seq}-${Date.now()}`
    const claims = (over: Partial<ExternalAuthResult> = {}): ExternalAuthResult => ({
      provider: 'acme',
      issuer: ISSUER,
      subject: `sub-${unique()}`,
      email: null,
      emailVerified: false,
      ...over
    })

    async function person(domain = 'acme.test', over: Record<string, unknown> = {}) {
      const email = `user${unique()}@${domain}`
      return (await users.createUser(db.tenant, { email, password: 'Acme-pw-123456', confirmed: true, roles: ['member'], ...over })) as any
    }

    it('refuses an identity with no link when nothing else is turned on', async () => {
      const anna = await person()
      const result = await resolveExternal(ctx(), provider(), claims({ email: anna.email, emailVerified: true }))
      expect(result).toMatchObject({ outcome: 'refused', reason: 'IDP_IDENTITY_NOT_LINKED', event: 'idp.rejected' })
    })

    it('links by email only for an address the provider verified, in a listed domain, and then by the link', async () => {
      const anna = await person('acme.test')
      const byEmail = provider({ linkByEmail: true, emailDomains: ['ACME.test'] })

      const unverified = await resolveExternal(ctx(), byEmail, claims({ email: anna.email, emailVerified: false }))
      expect(unverified.outcome).toBe('refused')

      const outsider = await person('elsewhere.test')
      const otherDomain = await resolveExternal(ctx(), byEmail, claims({ email: outsider.email, emailVerified: true }))
      expect(otherDomain.outcome).toBe('refused')

      const identity = claims({ email: anna.email.toUpperCase(), emailVerified: true })
      const linked = await resolveExternal(ctx(), byEmail, identity)
      expect(linked).toMatchObject({ outcome: 'resolved', event: 'idp.linked', subject: { externalId: anna.externalId } })

      // The second login finds the link, even with the address gone from the token.
      const again = await resolveExternal(ctx(), provider(), { ...identity, email: null, emailVerified: false })
      expect(again).toMatchObject({ outcome: 'resolved', event: null, subject: { externalId: anna.externalId } })
    })

    it('does not take one sub for another issuer', async () => {
      const anna = await person()
      const sub = `shared-${unique()}`
      await links.createLink(db.tenant, { scope: 'tenant', provider: 'acme', issuer: ISSUER, subject: sub, subjectId: anna.externalId })
      expect((await resolveExternal(ctx(), provider(), claims({ subject: sub }))).outcome).toBe('resolved')
      const forged = await resolveExternal(ctx(), provider(), claims({ subject: sub, issuer: 'https://evil-idp.test' }))
      expect(forged.outcome).toBe('refused')
    })

    it('keeps a blocked subject out even through its link', async () => {
      const anna = await person()
      const identity = claims()
      await links.createLink(db.tenant, { scope: 'tenant', provider: 'acme', issuer: ISSUER, subject: identity.subject, subjectId: anna.externalId })
      await users.blockUserById(db.tenant, anna.id, 'test')
      expect((await resolveExternal(ctx(), provider(), identity)).outcome).toBe('refused')
    })

    it('provisions just in time only where it is on, confirmed only on a verified address', async () => {
      const email = `new${unique()}@acme.test`
      const off = await resolveExternal(ctx(), provider({ jit: { enabled: false, roles: ['member'] } }), claims({ email, emailVerified: true }))
      expect(off.outcome).toBe('refused')
      expect(await users.retrieveUserByEmail(db.tenant, email)).toBeNull()

      const on = await resolveExternal(ctx(), provider({ jit: { enabled: true, roles: ['member'] } }), claims({ email, emailVerified: true }))
      expect(on).toMatchObject({ outcome: 'resolved', event: 'idp.provisioned', subject: { email, roles: ['member'], confirmed: true } })
      const row: any = await users.retrieveUserByEmail(db.tenant, email)
      // A password nobody was ever shown: no guess made from the address logs in.
      expect(await users.retrieveUserByPassword(db.tenant, email, email)).toBeNull()
      expect(row.isFounder).toBe(false)

      const unverifiedEmail = `pending${unique()}@acme.test`
      const pending = await resolveExternal(ctx(), provider({ jit: { enabled: true, roles: [] } }), claims({ email: unverifiedEmail, emailVerified: false }))
      expect(pending.outcome).toBe('refused')
      expect(((await users.retrieveUserByEmail(db.tenant, unverifiedEmail)) as any).confirmed).toBe(false)
    })

    it('never provisions an admin, never over an existing account, never on the control plane', async () => {
      const email = `boss${unique()}@acme.test`
      const admin = await resolveExternal(ctx(), provider({ jit: { enabled: true, roles: ['admin'] } }), claims({ email, emailVerified: true }))
      expect(admin).toMatchObject({ outcome: 'refused', cause: 'just-in-time roles include the admin role' })
      expect(await users.retrieveUserByEmail(db.tenant, email)).toBeNull()

      const anna = await person()
      const taken = await resolveExternal(ctx(), provider({ jit: { enabled: true, roles: [] } }), claims({ email: anna.email, emailVerified: true }))
      expect(taken).toMatchObject({ outcome: 'refused', cause: 'an account with this address exists and is not linked' })

      const control = await resolveExternal(ctx('control'), provider({ jit: { enabled: true, roles: [] } }), claims({ email: `op${unique()}@acme.test`, emailVerified: true }))
      expect(control.outcome).toBe('refused')
    })
  })
}

behaviours('SQLite', () => migratedSqlite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_p12_ext_ctl', tenant: 'test_p12_ext_acme' }))
}
