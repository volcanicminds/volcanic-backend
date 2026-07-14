/* eslint-disable no-useless-catch */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as bcrypt from 'bcrypt'
import * as Crypto from 'crypto'
import { QueryRunner, EntityManager } from 'typeorm'
import { ServiceError } from '../util/error.js'
import { executeCountQuery, executeFindQuery } from '../query.js'
import { encrypt, decrypt } from '../util/crypto.js'

/**
 * Returns the appropriate user repository.
 * Use this to support both explicit EntityManager (req.db) and QueryRunner.
 */
function getUserRepo(context?: QueryRunner | EntityManager) {
  const { multi_tenant } = (global as any).config?.options || {}

  // Hardening: In Multi-Tenant, we MUST have a context (Runner or Manager).
  // Implicit fallback to global.connection is dangerous.
  if (multi_tenant?.enabled && !context) {
    const errorMsg =
      '[UserManager] ⛔️ CRITICAL: Missing DB Context (Runner/Manager) in Multi-Tenant Environment! Implicit fallback to public schema forbidden.'
    console.error(errorMsg)
    throw new Error(errorMsg)
  }

  // If no context provided (and not multi-tenant), fallback to global
  if (!context) {
    return global.connection.getRepository(global.entity.User)
  }

  // Check if it's a QueryRunner (has .manager property)
  if ((context as QueryRunner).manager) {
    return (context as QueryRunner).manager.getRepository(global.entity.User)
  }

  // Otherwise treat as EntityManager
  return (context as EntityManager).getRepository(global.entity.User)
}

export function isImplemented() {
  return true
}

export async function isValidUser(data: typeof global.entity.User) {
  return !!data && (!!data._id || !!data.id) && !!data.externalId && !!data.email && !!data.password
}

export async function createUser(data: typeof global.entity.User, runner?: QueryRunner) {
  const { username, email, password } = data

  if (!email || !password) {
    throw new ServiceError('Invalid parameters', 400)
  }

  const salt = await bcrypt.genSalt(12)
  const hashedPassword = await bcrypt.hash(password, salt)

  try {
    const repo = getUserRepo(runner)
    let externalId, user
    do {
      externalId = Crypto.randomUUID({ disableEntropyCache: true })

      user = await repo.findOneBy({ externalId: externalId })
    } while (user != null)

    const newUser = repo.create({
      ...data,
      passwordChangedAt: new Date(),
      confirmed: false,
      confirmationToken: Crypto.randomBytes(64).toString('hex'),
      blocked: false,
      blockedReason: null,
      externalId: externalId,
      email: email,
      username: username || email,
      password: hashedPassword,
      mfaEnabled: false,
      mfaSecret: null,
      mfaType: 'TOTP',
      mfaRecoveryCodes: []
    } as typeof global.entity.User)

    return getUserRepo(runner).save(newUser)
  } catch (error) {
    if (error?.code == 23505) {
      throw new ServiceError('Email or username already registered', 409)
    }
    throw error
  }
}

export async function deleteUser(id: string, runner?: QueryRunner) {
  if (!id) {
    throw new ServiceError('Invalid parameters', 400)
  }

  try {
    const userEx = await retrieveUserById(id, runner)
    if (!userEx) {
      throw new ServiceError('User not found', 404)
    }

    return getUserRepo(runner).delete(id)
  } catch (error) {
    throw error
  }
}

export async function resetExternalId(id: string, runner?: QueryRunner) {
  if (!id) {
    throw new ServiceError('Invalid parameters', 400)
  }

  try {
    let externalId, user
    do {
      externalId = Crypto.randomUUID({ disableEntropyCache: true })
      user = await getUserRepo(runner).findOneBy({ externalId: externalId })
    } while (user != null)

    return await updateUserById(id, { externalId: externalId }, runner)
  } catch (error) {
    if (error?.code == 23505) {
      throw new ServiceError('External ID not changed', 409)
    }
    throw error
  }
}

export async function updateUserById(id: string, user: typeof global.entity.User, runner?: QueryRunner) {
  if (!id || !user) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    const repo = getUserRepo(runner)
    const userEx = await retrieveUserById(id, runner)
    if (!userEx) {
      throw new ServiceError('User not found', 404)
    }
    // `password` must NEVER be set through the generic update path: it would be
    // stored in plaintext, bypassing bcrypt (and breaking login). Credential
    // changes go through changePassword / resetPassword, which hash. Drop it here
    // for ALL callers (admin PUT /users/:id included).
    const { password: _ignorePassword, ...safe } = (user as any) || {}
    const merged = repo.merge(userEx, safe)
    return repo.save(merged)
  } catch (error) {
    throw error
  }
}

export async function retrieveUserById(id: string, runner?: QueryRunner) {
  if (!id) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getUserRepo(runner).findOneBy({ id: id })
  } catch (error) {
    throw error
  }
}

export async function retrieveUserByEmail(email: string, runner?: QueryRunner) {
  if (!email) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getUserRepo(runner).findOneBy({ email: email })
  } catch (error) {
    throw error
  }
}

export async function retrieveUserByUsername(username: string, runner?: QueryRunner) {
  if (!username) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getUserRepo(runner).findOneBy({ username })
  } catch (error) {
    throw error
  }
}

export async function retrieveUserByConfirmationToken(code: string, runner?: QueryRunner) {
  if (!code) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getUserRepo(runner).findOneBy({ confirmationToken: code })
  } catch (error) {
    throw error
  }
}

export async function retrieveUserByResetPasswordToken(code: string, runner?: QueryRunner) {
  if (!code) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getUserRepo(runner).findOneBy({ resetPasswordToken: code })
  } catch (error) {
    throw error
  }
}

export async function retrieveUserByExternalId(externalId: string, runner?: QueryRunner) {
  if (!externalId) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getUserRepo(runner).findOne({
      where: { externalId: externalId },
      cache: global.cacheTimeout
    })
  } catch (error) {
    throw error
  }
}

// Constant-cost bcrypt hash (cost 12, matching createUser) compared against when
// the user does not exist, so response time is the same whether or not the email
// is registered. Prevents user enumeration via timing. The plaintext is irrelevant.
const DUMMY_PASSWORD_HASH = '$2b$12$4sLKI6Ag4n6KjUBPqA4oJuAthEdYgbwUj7oIR8yj7IekjUCzUFRD2'

export async function retrieveUserByPassword(email: string, password: string, runner?: QueryRunner) {
  if (!email || !password) {
    throw new ServiceError('Invalid parameters', 400)
  }
  const user = await getUserRepo(runner).findOneBy({ email: email })
  // Always run a bcrypt comparison (against a dummy hash when the user is missing)
  // to keep the timing constant and avoid leaking whether the email exists.
  const match = await bcrypt.compare(password, user?.password || DUMMY_PASSWORD_HASH)
  return user && match ? user : null
}

export async function changePassword(email: string, password: string, oldPassword: string, runner?: QueryRunner) {
  if (!email || !password || !oldPassword) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    const repo = getUserRepo(runner)
    const user = await repo.findOneBy({ email: email })
    // Guard the null deref (user not found) and keep the bcrypt cost constant
    // regardless of existence, mirroring retrieveUserByPassword.
    const match = await bcrypt.compare(oldPassword, user?.password || DUMMY_PASSWORD_HASH)
    if (user && match) {
      const salt = await bcrypt.genSalt(12)
      const hashedPassword = await bcrypt.hash(password, salt)
      return repo.save({ ...user, passwordChangedAt: new Date(), password: hashedPassword })
    }
    throw new ServiceError('Password not changed', 400)
  } catch (error) {
    throw error
  }
}

/**
 * Mints a reset token that carries its own expiry: `<epochSeconds>.<random>`.
 *
 * The deadline travels INSIDE the token instead of being read back from
 * `resetPasswordTokenAt`, because a `timestamp` (no time zone) column does not
 * round-trip: it is written in UTC and read back as local time, so the value
 * returns shifted by the process TZ offset (e.g. -2h on Europe/Rome, +4h on
 * America/New_York). Any expiry computed from it would be wrong by that offset —
 * too strict in the east, too lax in the west. An integer in the token cannot
 * drift.
 *
 * No signature is needed: the whole token is the DB lookup key, so tampering
 * with the epoch simply stops matching any row.
 *
 * `resetPasswordTokenAt` is still written, as audit info only.
 */
export async function forgotPassword(email: string, runner?: QueryRunner, ttlSeconds = 3600) {
  if (!email) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    const repo = getUserRepo(runner)
    const user = await repo.findOneBy({ email: email })

    if (user) {
      const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds
      return repo.save({
        ...user,
        resetPasswordTokenAt: new Date(),
        resetPasswordToken: `${expiresAt}.${Crypto.randomBytes(64).toString('hex')}`
      })
    }
    throw new ServiceError('Password not changed', 400)
  } catch (error) {
    throw error
  }
}

export async function resetPassword(user: typeof global.entity.User, password: string, runner?: QueryRunner) {
  if (!user || !password || !user?.email) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    const repo = getUserRepo(runner)
    const userEx = await repo.findOneBy({ email: user.email })
    if (!userEx) {
      throw new Error('Wrong credentials')
    }

    const salt = await bcrypt.genSalt(12)
    const hashedPassword = await bcrypt.hash(password, salt)
    return repo.save({
      ...userEx,
      passwordChangedAt: new Date(),
      confirmed: true,
      confirmedAt: new Date(),
      resetPasswordToken: null,
      password: hashedPassword
    })
  } catch (error) {
    throw error
  }
}

export async function userConfirmation(user: typeof global.entity.User, runner?: QueryRunner) {
  if (!user) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return getUserRepo(runner).save({ ...user, confirmed: true, confirmedAt: new Date(), confirmationToken: null })
  } catch (error) {
    throw error
  }
}

export async function blockUserById(id: string, reason: string, runner?: QueryRunner) {
  return updateUserById(id, { blocked: true, blockedAt: new Date(), blockedReason: reason }, runner)
}

export async function unblockUserById(id: string, runner?: QueryRunner) {
  return updateUserById(id, { blocked: false, blockedAt: new Date(), blockedReason: null }, runner)
}

export function isPasswordToBeChanged(user: typeof global.entity.User) {
  if (process.env.PASSWORD_EXPIRATION_DAYS != null) {
    let passwordExpirationDays = -1
    try {
      passwordExpirationDays = Number(process.env.PASSWORD_EXPIRATION_DAYS)
      if (passwordExpirationDays <= 0) {
        throw new Error('PASSWORD_EXPIRATION_DAYS_ENV_INVALID')
      }
    } catch (e) {
      // `e` is already an Error; rethrow it as-is. `new Error(e)` stringified the
      // Error into a useless "[object …]" / doubly-wrapped message.
      throw e
    }
    const { passwordChangedAt } = user
    const date1 = new Date(passwordChangedAt)
    const date2 = new Date()
    const differenceInTime = date2.getTime() - date1.getTime()
    const differenceInDays = differenceInTime / (1000 * 3600 * 24)

    return differenceInDays >= passwordExpirationDays
  }

  return false
}

export async function countQuery(data: any, runner?: QueryRunner) {
  return await executeCountQuery(getUserRepo(runner), data)
}

export async function findQuery(data: any, runner?: QueryRunner) {
  return await executeFindQuery(getUserRepo(runner), {}, data)
}

export async function disableUserById(id: string, runner?: QueryRunner) {
  await updateUserById(
    id,
    { blocked: true, blockedAt: new Date(), blockedReason: 'User disabled to unregister' },
    runner
  )
  return resetExternalId(id, runner)
}

// MFA Persistence Methods

export async function saveMfaSecret(userId: string, secret: string, runner?: QueryRunner) {
  if (!userId || !secret) {
    throw new ServiceError('Invalid parameters', 400)
  }
  const encryptedSecret = encrypt(secret)

  await updateUserById(
    userId,
    {
      mfaSecret: encryptedSecret,
      mfaType: 'TOTP'
    },
    runner
  )
  return true
}

export async function retrieveMfaSecret(userId: string, runner?: QueryRunner) {
  if (!userId) throw new ServiceError('Invalid parameters', 400)

  const user = await getUserRepo(runner)
    .createQueryBuilder('user')
    .addSelect('user.mfaSecret')
    .where('user.id = :id', { id: userId })
    .getOne()

  if (!user || !user.mfaSecret) return null

  return decrypt(user.mfaSecret)
}

export async function enableMfa(userId: string, runner?: QueryRunner) {
  if (!userId) throw new ServiceError('Invalid parameters', 400)
  return await updateUserById(userId, { mfaEnabled: true }, runner)
}

export async function disableMfa(userId: string, runner?: QueryRunner) {
  if (!userId) throw new ServiceError('Invalid parameters', 400)
  return await updateUserById(userId, { mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] }, runner)
}

export async function forceDisableMfaForAdmin(email: string, runner?: QueryRunner) {
  if (!email) return false

  const user = await getUserRepo(runner).findOneBy({ email: email })
  if (!user) {
    return false
  }

  // Verify admin role (supports array of strings)
  const hasAdmin =
    user.roles && (user.roles.includes('admin') || user.roles.some((r) => r === 'admin' || r.code === 'admin'))

  if (!hasAdmin) {
    return false
  }

  await updateUserById(
    user.id,
    {
      mfaEnabled: false,
      mfaSecret: null,
      mfaRecoveryCodes: []
    },
    runner
  )

  return true
}
