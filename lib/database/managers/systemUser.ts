import bcrypt from 'bcrypt'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { SystemUserManagement, ControlHandle, VQuery } from '../../../types/global.js'
import { executeFind, executeCount } from '../query/index.js'
import { encrypt, decrypt } from '../crypto.js'
import { control, table, column } from './runtime.js'
import { envInt } from '../env.js'

//
// Platform identities (T-4.1).
//
// The whole point of this file is the type of its first argument: every method takes a
// ControlHandle, so a system user cannot be read or written from inside a tenant container.
// In v4 there was no such table: the "super admin" was a row in the `user` table of the
// `public` schema, and the only thing keeping it apart from a tenant's admin was which
// schema the connection happened to resolve. That is D-01, and it made every administrative
// operation one defect away from a privilege escalation.
//
// What this table deliberately does NOT have (docs/SCHEMA_V5.md §3.2): `confirmed` and
// `confirmation_token`. System users are provisioned, never self-registered, so there is no
// public route to confirm and no state in which one is half created.
//
//
// The work factor, from the environment with a FLOOR.
//
// Twelve was measured once, on one machine, and hard-coded — so a deployment on slower
// hardware pays whatever that costs and a deployment on faster hardware under-spends, and
// neither can say so. T-9.4 measures the cost on the machine that will run it, which is only
// worth doing if the answer can be applied.
//
// The floor is the point: a tunable work factor is also a way to weaken every password in the
// database with one environment variable, and nothing downstream would report it. Twelve is
// the minimum whatever anyone writes; the ceiling keeps a typo from making every login a
// thirty-second wait, which is a denial of service typed by an operator.
//
const BCRYPT_COST = envInt('BCRYPT_COST', 12, { min: 12, max: 20 })

// The same shape as the tenant manager's, and for the same reason: comparing against a real
// hash when the address does not exist keeps the cost of the answer from revealing it.
const DUMMY_PASSWORD_HASH = '$2b$12$4sLKI6Ag4n6KjUBPqA4oJuAthEdYgbwUj7oIR8yj7IekjUCzUFRD2'

const NAME = 'systemUserManager'

export function createSystemUserManager(): SystemUserManagement {
  const users = (ctx: unknown, what: string) => {
    const handle = control(ctx, `${NAME}.${what}`)
    return { handle, user: table(handle, 'systemUser') }
  }

  const one = async (ctx: unknown, what: string, where: any) => {
    const { handle, user } = users(ctx, what)
    const rows = await handle.db.select().from(user).where(where).limit(1)
    return rows[0] ?? null
  }

  const byColumn = async (ctx: unknown, what: string, field: string, value: unknown) => {
    const { user } = users(ctx, what)
    return await one(ctx, what, eq(column(user, field), value as never))
  }

  return {
    isImplemented: () => true,

    async createSystemUser(ctx: ControlHandle, data: any) {
      const { handle, user } = users(ctx, 'createSystemUser')
      const rows = await handle.db
        .insert(user)
        .values({
          email: String(data.email).trim().toLowerCase(),
          password: await bcrypt.hash(String(data.password), BCRYPT_COST),
          roles: data.roles ?? [],
          mfaEnabled: data.mfaEnabled ?? false
        })
        .returning()
      return rows[0]
    },

    async updateSystemUserById(ctx: ControlHandle, id: string, data: any) {
      const { handle, user } = users(ctx, 'updateSystemUserById')
      const values: Record<string, unknown> = { ...data, updatedAt: new Date() }
      // A password never travels through a generic update: it would land unhashed.
      delete values.password
      delete values.id
      delete values.externalId

      const rows = await handle.db
        .update(user)
        .set({ ...values, version: sql`${column(user, 'version')} + 1` })
        .where(eq(column(user, 'id'), id as never))
        .returning()
      return rows[0] ?? null
    },

    async deleteSystemUser(ctx: ControlHandle, id: string) {
      const { handle, user } = users(ctx, 'deleteSystemUser')
      const rows = await handle.db
        .update(user)
        .set({ deletedAt: new Date() })
        .where(eq(column(user, 'id'), id as never))
        .returning()
      return rows.length > 0
    },

    retrieveSystemUserById: (ctx, id) => byColumn(ctx, 'retrieveSystemUserById', 'id', id),
    retrieveSystemUserByExternalId: (ctx, externalId) =>
      byColumn(ctx, 'retrieveSystemUserByExternalId', 'externalId', externalId),
    retrieveSystemUserByEmail: async (ctx, email) =>
      await byColumn(ctx, 'retrieveSystemUserByEmail', 'email', String(email ?? '').trim().toLowerCase()),

    async retrieveSystemUserByPassword(ctx: ControlHandle, email: string, password: string) {
      const { user } = users(ctx, 'retrieveSystemUserByPassword')
      const found = await one(
        ctx,
        'retrieveSystemUserByPassword',
        and(eq(column(user, 'email'), String(email ?? '').trim().toLowerCase() as never), isNull(column(user, 'deletedAt')))
      )
      const matches = await bcrypt.compare(String(password ?? ''), found?.password || DUMMY_PASSWORD_HASH)
      return found && matches ? found : null
    },

    async blockSystemUserById(ctx: ControlHandle, id: string, reason: string) {
      const { handle, user } = users(ctx, 'blockSystemUserById')
      await handle.db
        .update(user)
        .set({ blocked: true, blockedReason: reason, blockedAt: new Date(), updatedAt: new Date() })
        .where(eq(column(user, 'id'), id as never))
      return true
    },

    async unblockSystemUserById(ctx: ControlHandle, id: string) {
      const { handle, user } = users(ctx, 'unblockSystemUserById')
      await handle.db
        .update(user)
        .set({ blocked: false, blockedReason: null, blockedAt: null, updatedAt: new Date() })
        .where(eq(column(user, 'id'), id as never))
      return true
    },

    // --- MFA ---------------------------------------------------------------------------
    //
    // Deferred in T-4.1 and landed here, because T-6.3 is what actually needs it: destroying
    // a customer's data asks for a second factor, and a factor that does not exist cannot be
    // asked for. Same shape as the tenant users': the secret is encrypted at rest with a key
    // derived per record (T-2.6), and only the id addresses a user, never an email.
    async saveMfaSecret(ctx: ControlHandle, userId: string, secret: string) {
      const { handle, user } = users(ctx, 'saveMfaSecret')
      await handle.db
        .update(user)
        .set({ mfaSecret: await encrypt(secret), mfaType: 'totp', updatedAt: new Date() })
        .where(eq(column(user, 'id'), userId as never))
      return true
    },

    async retrieveMfaSecret(ctx: ControlHandle, userId: string) {
      const found = await byColumn(ctx, 'retrieveMfaSecret', 'id', userId)
      return found?.mfaSecret ? await decrypt(found.mfaSecret) : null
    },

    async enableMfa(ctx: ControlHandle, userId: string) {
      const { handle, user } = users(ctx, 'enableMfa')
      await handle.db.update(user).set({ mfaEnabled: true, updatedAt: new Date() }).where(eq(column(user, 'id'), userId as never))
      return true
    },

    async disableMfa(ctx: ControlHandle, userId: string) {
      const { handle, user } = users(ctx, 'disableMfa')
      await handle.db
        .update(user)
        .set({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null, mfaLastUsedCounter: null, updatedAt: new Date() })
        .where(eq(column(user, 'id'), userId as never))
      return true
    },

    /** The replay guard: a TOTP step is accepted once, and never again. */
    async recordMfaCounter(ctx: ControlHandle, userId: string, counter: number) {
      const { handle, user } = users(ctx, 'recordMfaCounter')
      await handle.db
        .update(user)
        .set({ mfaLastUsedCounter: counter, updatedAt: new Date() })
        .where(eq(column(user, 'id'), userId as never))
      return true
    },

    async countQuery(ctx: ControlHandle, data: VQuery) {
      const { handle, user } = users(ctx, 'countQuery')
      return await executeCount(handle, user, data as never, { dialect: handle.dialect })
    },

    async findQuery(ctx: ControlHandle, data: VQuery) {
      const { handle, user } = users(ctx, 'findQuery')
      return (await executeFind(handle, user, data as never, { dialect: handle.dialect })) as never
    }
  }
}
