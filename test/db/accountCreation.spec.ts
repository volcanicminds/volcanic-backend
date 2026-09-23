/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-12.46 and T-12.48 on the real stores of a migrated container (F49): the settings table on both
// containers, an account that waits and the approval that ends the wait, the doors a waiting
// account must not pass (password, email-otp, a link to a provider), and the just-in-time
// provisioning under each of the three modes. SQLite always, Postgres with DATABASE_URL.
//
import { expect } from 'expect'
import type { AuthContext, AuthPlaneFlows, ExternalAuthResult } from '../../types/global.js'
import * as engine from '../../lib/auth/engine.js'
import type { FlowOutcome, FlowPlane } from '../../lib/auth/engine.js'
import { buildAuthenticatorRegistry } from '../../lib/auth/registry.js'
import { mayLogIn, toSubject } from '../../lib/auth/subjects.js'
import { resolveExternal } from '../../lib/auth/external.js'
import type { ResolvedProvider } from '../../lib/auth/providers.js'
import { createAuthFlowManager } from '../../lib/database/managers/authFlow.js'
import { createExternalIdentityManager } from '../../lib/database/managers/externalIdentity.js'
import { createSettingManager } from '../../lib/database/managers/setting.js'
import { createUserManager } from '../../lib/database/managers/user.js'
import { DATABASE_URL, migratedPostgres, migratedSqlite, type Migrated } from './fixtures/migrated.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'
;(global as any).log = {}
;(global as any).roles = (global as any).roles ?? { public: { code: 'public' }, admin: { code: 'admin' } }

const ISSUER = 'https://login.acme-idp.test/v2.0'
const LIMITS = { flowTtl: 600, otpTtl: 300, otpMaxAttempts: 5, otpMaxSends: 3 }
const FLOWS: AuthPlaneFlows = { identify: ['password', 'email-otp'], flows: [{ roles: ['*'], stages: [] }] }
const tick = () => new Promise((resolve) => setImmediate(resolve))

function behaviours(name: string, open: () => Promise<Migrated>) {
  describe(`auth · account creation on ${name} (T-12.46, T-12.48)`, function () {
    this.timeout(30000)
    let db: Migrated
    const users = createUserManager()
    const links = createExternalIdentityManager()
    const settings = createSettingManager()
    const store = createAuthFlowManager()
    let seq = 0
    const unique = () => `${++seq}-${Date.now()}`

    before(async () => (db = await open()))
    after(async () => await db?.close())

    async function person(over: Record<string, unknown> = {}) {
      const email = `user${unique()}@acme.test`
      return (await users.createUser(db.tenant, {
        email,
        password: 'Acme-pw-123456',
        confirmed: true,
        roles: ['member'],
        ...over
      })) as any
    }

    it('keeps settings per container, replaces a value in place and removes it', async () => {
      expect(await settings.get(db.tenant, 'account_creation.mode')).toBeNull()
      await settings.set(db.tenant, 'account_creation.mode', 'approval', 'x-anna')
      await settings.set(db.tenant, 'account_creation.mode', 'open', 'x-anna')
      await settings.set(db.control, 'account_creation', { allowed: ['invite', 'open'], default: 'invite' })

      expect(await settings.get(db.tenant, 'account_creation.mode')).toBe('open')
      expect(await settings.get(db.control, 'account_creation')).toEqual({
        allowed: ['invite', 'open'],
        default: 'invite'
      })
      // The two containers do not see each other's keys.
      expect(await settings.get(db.control, 'account_creation.mode')).toBeNull()

      expect(await settings.remove(db.tenant, 'account_creation.mode')).toBe(true)
      expect(await settings.remove(db.tenant, 'account_creation.mode')).toBe(false)
      expect(await settings.get(db.tenant, 'account_creation.mode')).toBeNull()
    })

    it('creates accounts approved unless told otherwise, and approves a waiting one once', async () => {
      const anna = await person()
      expect(Boolean(anna.approved)).toBe(true)

      const bruno = await person({ approved: false })
      expect(Boolean(bruno.approved)).toBe(false)
      expect(await mayLogIn(users, bruno)).toBe(false)

      expect(await users.approveUserById(db.tenant, bruno.id)).toBe(true)
      expect(await users.approveUserById(db.tenant, bruno.id)).toBe(false)
      expect(await users.approveUserById(db.tenant, anna.id)).toBe(false)
      const approved: any = await users.retrieveUserById(db.tenant, bruno.id)
      expect(Boolean(approved.approved)).toBe(true)
      expect(approved.approvedAt).toBeTruthy()
      expect(await mayLogIn(users, approved)).toBe(true)
    })

    it('keeps a waiting account out of the password and the email-otp doors', async () => {
      const waiting = await person({ approved: false })
      const deliveries: any[] = []
      const p: FlowPlane<any> = {
        plane: 'tenant',
        handle: db.tenant,
        tenant: null,
        routing: 'ctl',
        policy: 'OPTIONAL' as never,
        flows: FLOWS,
        limits: LIMITS,
        registry: buildAuthenticatorRegistry(),
        managers: {
          userManager: users,
          authFlowManager: store,
          challengeDeliveryManager: { isImplemented: () => true, deliver: async (m: any) => void deliveries.push(m) }
        } as any,
        ip: null,
        userAgent: null,
        loadSubject: async (externalId) => {
          const user: any = await users.retrieveUserByExternalId(db.tenant, externalId)
          return (await mayLogIn(users, user)) ? { record: user, subject: toSubject('tenant', user) } : null
        },
        issue: async (user: any, _s, methods) => ({
          body: { sub: user.externalId, methods },
          subjectId: user.externalId
        }),
        record: async () => undefined
      }
      const refusal = (o: FlowOutcome) => (o.kind === 'refused' ? o.refusal.code : o.kind)

      // The uniform answer of D-17, as for an unconfirmed or blocked account.
      expect(refusal(await engine.start(p, 'password', { email: waiting.email, password: 'Acme-pw-123456' }))).toBe(
        'AUTH_INVALID_CREDENTIALS'
      )

      // The identifier answers as for an unknown address, and sends nothing.
      const started = await engine.start(p, 'email-otp', { email: waiting.email })
      expect(started.kind).toBe('partial')
      for (let i = 0; i < 5; i++) await tick()
      expect(deliveries).toHaveLength(0)
    })

    describe('just-in-time provisioning by mode', () => {
      const ctx = (mode: 'invite' | 'approval' | 'open'): AuthContext =>
        ({
          plane: 'tenant',
          handle: db.tenant,
          tenant: null,
          subject: null,
          policy: 'OPTIONAL',
          managers: { userManager: users, externalIdentityManager: links, systemUserManager: {} },
          flow: null,
          limits: LIMITS,
          challenges: null,
          accountCreation: async () => mode
        }) as any

      const provider = (settings: Record<string, unknown> = {}): ResolvedProvider => ({
        key: 'acme',
        type: 'oidc',
        source: 'tenant',
        settings: {
          issuer: ISSUER,
          clientId: 'c',
          redirectUri: 'https://api.test/auth/flow/return/oidc',
          jit: { enabled: true, roles: ['member'] },
          ...settings
        },
        clientSecret: 'x'
      })

      const claims = (email: string): ExternalAuthResult => ({
        provider: 'acme',
        issuer: ISSUER,
        subject: `sub-${unique()}`,
        email,
        emailVerified: true
      })

      it('under `invite`, provisions only an address in a domain the provider lists', async () => {
        const open = claims(`walkin${unique()}@gmail.test`)
        expect(await resolveExternal(ctx('invite'), provider(), open)).toMatchObject({
          outcome: 'refused',
          reason: 'IDP_IDENTITY_NOT_LINKED',
          cause: 'accounts here are created by invitation, and the address is not in a listed domain'
        })
        expect(await users.retrieveUserByEmail(db.tenant, open.email as string)).toBeNull()

        const staff = claims(`staff${unique()}@acme.test`)
        const listed = await resolveExternal(ctx('invite'), provider({ emailDomains: ['acme.test'] }), staff)
        expect(listed).toMatchObject({ outcome: 'resolved', event: 'idp.provisioned' })
      })

      it('under `approval`, creates a linked account that waits, and lets it in once approved', async () => {
        const identity = claims(`newcomer${unique()}@gmail.test`)
        const first = await resolveExternal(ctx('approval'), provider(), identity)
        expect(first).toMatchObject({
          outcome: 'refused',
          reason: 'ACCOUNT_PENDING_APPROVAL',
          event: 'account.pending'
        })
        const row: any = await users.retrieveUserByEmail(db.tenant, identity.email as string)
        expect(Boolean(row.approved)).toBe(false)
        expect(Boolean(row.confirmed)).toBe(true)
        expect((first as any).subjectId).toBe(row.externalId)

        // Back before the approval: the link is there, the account still waits.
        const again = await resolveExternal(ctx('approval'), provider(), identity)
        expect(again).toMatchObject({ outcome: 'refused', reason: 'ACCOUNT_PENDING_APPROVAL', event: 'idp.rejected' })

        await users.approveUserById(db.tenant, row.id)
        const after = await resolveExternal(ctx('approval'), provider(), identity)
        expect(after).toMatchObject({ outcome: 'resolved', event: null, subject: { externalId: row.externalId } })
      })

      it('under `open`, provisions an account that waits for nobody', async () => {
        const identity = claims(`anyone${unique()}@gmail.test`)
        expect(await resolveExternal(ctx('open'), provider(), identity)).toMatchObject({
          outcome: 'resolved',
          event: 'idp.provisioned'
        })
      })

      it('without the mode in the context, applies the most closed one', async () => {
        const { accountCreation: _dropped, ...rest } = ctx('open') as any
        const identity = claims(`nomode${unique()}@gmail.test`)
        expect(await resolveExternal(rest, provider(), identity)).toMatchObject({
          outcome: 'refused',
          reason: 'IDP_IDENTITY_NOT_LINKED'
        })
      })
    })
  })
}

behaviours('SQLite', () => migratedSqlite())

if (DATABASE_URL) {
  behaviours('Postgres', () => migratedPostgres({ control: 'test_f49_ctl', tenant: 'test_f49_acme' }))
}
