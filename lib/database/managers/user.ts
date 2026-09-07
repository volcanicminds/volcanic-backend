import bcrypt from 'bcrypt'
import { eq, and, isNull, sql } from 'drizzle-orm'
import type { UserManagement, DataHandle, VQuery } from '../../../types/global.js'
import { executeFind, executeCount } from '../query/index.js'
import { encrypt, decrypt } from '../crypto.js'
import { runtime, table, column } from './runtime.js'

//
// The user manager (T-2.5), over Drizzle.
//
// Everything appendix B of EVO_FRAMEWORK.md lists as already correct is carried over on
// purpose, because losing it in the port would be a security regression and not a detail:
// bcrypt at cost 12, a comparison that costs the same whether or not the email exists, and a
// reset token that carries its own expiry.
//
const BCRYPT_COST = 12

// A real bcrypt hash at the same cost, compared against when the user does not exist, so the
// response takes the same time either way. Without it, timing answers the question "is this
// address registered?" that the uniform messages of docs/API_V5.md §2.1 refuse to answer.
const DUMMY_PASSWORD_HASH = '$2b$12$4sLKI6Ag4n6KjUBPqA4oJuAthEdYgbwUj7oIR8yj7IekjUCzUFRD2'

const NAME = 'userManager'

export function createUserManager(): UserManagement {
  const users = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, user: table(handle, 'user') }
  }

  const one = async (ctx: unknown, what: string, where: any) => {
    const { handle, user } = users(ctx, what)
    const rows = await handle.db.select().from(user).where(where).limit(1)
    return rows[0] ?? null
  }

  // async, deliberately: a method that returns a promise must REJECT rather than throw
  // synchronously, or a caller using .catch() never sees the failure.
  const byColumn = async (ctx: unknown, what: string, field: string, value: unknown) => {
    const { user } = users(ctx, what)
    return await one(ctx, what, eq(column(user, field), value as never))
  }

  return {
    isImplemented: () => true,

    isValidUser(data: any) {
      return !!data?.email && !!data?.password
    },

    async createUser(ctx: DataHandle, data: any) {
      const { handle, user } = users(ctx, 'createUser')
      const password = await bcrypt.hash(String(data.password), BCRYPT_COST)

      const rows = await handle.db
        .insert(user)
        .values({
          email: String(data.email).trim().toLowerCase(),
          username: data.username ?? null,
          password,
          confirmed: data.confirmed ?? false,
          confirmedAt: data.confirmed ? new Date() : null,
          roles: data.roles ?? [],
          isFounder: data.isFounder ?? false,
          passwordChangedAt: new Date()
        })
        .returning()
      return rows[0]
    },

    async updateUserById(ctx: DataHandle, id: string, data: any) {
      const { handle, user } = users(ctx, 'updateUserById')
      const values: Record<string, unknown> = { ...data, updatedAt: new Date() }
      // A password never travels through a generic update: it would land unhashed.
      delete values.password
      delete values.id

      const rows = await handle.db
        .update(user)
        .set({ ...values, version: sql`${column(user, 'version')} + 1` })
        .where(eq(column(user, 'id'), id as never))
        .returning()
      return rows[0] ?? null
    },

    async deleteUser(ctx: DataHandle, id: string) {
      const { handle, user } = users(ctx, 'deleteUser')
      const rows = await handle.db
        .update(user)
        .set({ deletedAt: new Date() })
        .where(eq(column(user, 'id'), id as never))
        .returning()
      return rows.length > 0
    },

    async resetExternalId(ctx: DataHandle, id: string) {
      const { handle, user } = users(ctx, 'resetExternalId')
      const externalId = crypto.randomUUID()
      await handle.db.update(user).set({ externalId }).where(eq(column(user, 'id'), id as never))
      return externalId
    },

    retrieveUserById: (ctx, id) => byColumn(ctx, 'retrieveUserById', 'id', id),
    retrieveUserByExternalId: (ctx, externalId) => byColumn(ctx, 'retrieveUserByExternalId', 'externalId', externalId),
    retrieveUserByUsername: (ctx, username) => byColumn(ctx, 'retrieveUserByUsername', 'username', username),
    retrieveUserByResetPasswordToken: (ctx, token) =>
      byColumn(ctx, 'retrieveUserByResetPasswordToken', 'resetPasswordToken', token),
    retrieveUserByConfirmationToken: (ctx, token) =>
      byColumn(ctx, 'retrieveUserByConfirmationToken', 'confirmationToken', token),

    retrieveUserByEmail: async (ctx, email) =>
      await byColumn(ctx, 'retrieveUserByEmail', 'email', String(email ?? '').trim().toLowerCase()),

    async retrieveUserByPassword(ctx: DataHandle, email: string, password: string) {
      const { user } = users(ctx, 'retrieveUserByPassword')
      const found = await one(
        ctx,
        'retrieveUserByPassword',
        and(eq(column(user, 'email'), String(email ?? '').trim().toLowerCase() as never), isNull(column(user, 'deletedAt')))
      )
      // Always compare, even with no user: the cost of the answer must not reveal the answer.
      const matches = await bcrypt.compare(String(password ?? ''), found?.password || DUMMY_PASSWORD_HASH)
      return found && matches ? found : null
    },

    async changePassword(ctx: DataHandle, email: string, password: string, oldPassword: string) {
      const { handle, user } = users(ctx, 'changePassword')
      const found = await this.retrieveUserByPassword(ctx, email, oldPassword)
      if (!found) return false

      await handle.db
        .update(user)
        .set({ password: await bcrypt.hash(String(password), BCRYPT_COST), passwordChangedAt: new Date(), updatedAt: new Date() })
        .where(eq(column(user, 'id'), found.id as never))
      return true
    },

    async forgotPassword(ctx: DataHandle, email: string, ttlSeconds = 3600) {
      const { handle, user } = users(ctx, 'forgotPassword')
      const found = await this.retrieveUserByEmail(ctx, email)
      if (!found || found.blocked) return null

      // The token carries its own expiry, so a stolen one is useless after it: `<epoch>.<secret>`.
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
      const token = `${expiresAt}.${crypto.randomUUID().replace(/-/g, '')}`

      await handle.db
        .update(user)
        .set({ resetPasswordToken: token, resetPasswordTokenAt: new Date(), updatedAt: new Date() })
        .where(eq(column(user, 'id'), found.id as never))
      return token
    },

    async resetPassword(ctx: DataHandle, user: any, password: string) {
      const { handle, user: t } = users(ctx, 'resetPassword')
      await handle.db
        .update(t)
        .set({
          password: await bcrypt.hash(String(password), BCRYPT_COST),
          passwordChangedAt: new Date(),
          resetPasswordToken: null,
          resetPasswordTokenAt: null,
          updatedAt: new Date()
        })
        .where(eq(column(t, 'id'), user.id as never))
      return true
    },

    async userConfirmation(ctx: DataHandle, user: any) {
      const { handle, user: t } = users(ctx, 'userConfirmation')
      await handle.db
        .update(t)
        .set({ confirmed: true, confirmedAt: new Date(), confirmationToken: null, updatedAt: new Date() })
        .where(eq(column(t, 'id'), user.id as never))
      return true
    },

    async blockUserById(ctx: DataHandle, id: string, reason: string) {
      const { handle, user } = users(ctx, 'blockUserById')
      await handle.db
        .update(user)
        .set({ blocked: true, blockedReason: reason, blockedAt: new Date(), updatedAt: new Date() })
        .where(eq(column(user, 'id'), id as never))
      return true
    },

    async unblockUserById(ctx: DataHandle, id: string) {
      const { handle, user } = users(ctx, 'unblockUserById')
      await handle.db
        .update(user)
        .set({ blocked: false, blockedReason: null, blockedAt: null, updatedAt: new Date() })
        .where(eq(column(user, 'id'), id as never))
      return true
    },

    async countQuery(ctx: DataHandle, data: VQuery) {
      const { handle, user } = users(ctx, 'countQuery')
      return await executeCount(handle, user, data as never, { dialect: handle.dialect })
    },

    async findQuery(ctx: DataHandle, data: VQuery) {
      const { handle, user } = users(ctx, 'findQuery')
      return (await executeFind(handle, user, data as never, { dialect: handle.dialect })) as never
    },

    // --- MFA ---------------------------------------------------------------------
    async saveMfaSecret(ctx: DataHandle, userId: string, secret: string) {
      const { handle, user } = users(ctx, 'saveMfaSecret')
      await handle.db
        .update(user)
        .set({ mfaSecret: await encrypt(secret), mfaType: 'totp', updatedAt: new Date() })
        .where(eq(column(user, 'id'), userId as never))
      return true
    },

    async retrieveMfaSecret(ctx: DataHandle, userId: string) {
      const found = await byColumn(ctx, 'retrieveMfaSecret', 'id', userId)
      return found?.mfaSecret ? await decrypt(found.mfaSecret) : null
    },

    async enableMfa(ctx: DataHandle, userId: string) {
      const { handle, user } = users(ctx, 'enableMfa')
      await handle.db.update(user).set({ mfaEnabled: true, updatedAt: new Date() }).where(eq(column(user, 'id'), userId as never))
      return true
    },

    async disableMfa(ctx: DataHandle, userId: string) {
      const { handle, user } = users(ctx, 'disableMfa')
      await handle.db
        .update(user)
        .set({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: null, mfaLastUsedCounter: null, updatedAt: new Date() })
        .where(eq(column(user, 'id'), userId as never))
      return true
    },

    /** By id, never by email: taking an address here was an invitation to enumerate. */
    async forceDisableMfa(ctx: DataHandle, userId: string) {
      return await this.disableMfa(ctx, userId)
    }
  }
}
