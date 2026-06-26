/* eslint-disable no-useless-catch */
/* eslint-disable @typescript-eslint/no-explicit-any */
import * as Crypto from 'crypto'
import { QueryRunner, EntityManager } from 'typeorm'
import { ServiceError } from '../util/error.js'
import { executeCountQuery, executeFindQuery } from '../query.js'

/**
 * Returns the appropriate token repository.
 * Use this to support both explicit EntityManager (req.db) and QueryRunner.
 */
function getTokenRepo(context?: QueryRunner | EntityManager) {
  const { multi_tenant } = (global as any).config?.options || {}

  if (multi_tenant?.enabled && !context) {
    throw new Error('[TokenManager] ⛔️ CRITICAL: Missing DB Context (Runner/Manager) in Multi-Tenant Environment!')
  }

  // If no context provided (and not multi-tenant), fallback to global
  if (!context) {
    return global.connection.getRepository(global.entity.Token)
  }

  // Check if it's a QueryRunner (has .manager property)
  if ((context as QueryRunner).manager) {
    return (context as QueryRunner).manager.getRepository(global.entity.Token)
  }

  // Otherwise treat as EntityManager
  return (context as EntityManager).getRepository(global.entity.Token)
}

export function isImplemented() {
  return true
}

export async function isValidToken(data: typeof global.entity.Token) {
  return !!data && (!!data._id || !!data.id) && !!data.externalId && !!data.name
}

export async function createToken(data: typeof global.entity.Token, runner?: QueryRunner) {
  const { name, description } = data

  if (!name) {
    throw new ServiceError('Invalid parameters', 400)
  }

  try {
    const repo = getTokenRepo(runner)
    let externalId, token
    do {
      externalId = Crypto.randomUUID({ disableEntropyCache: true })
      token = await repo.findOneBy({ externalId: externalId })
    } while (token != null)

    const newToken = repo.create({
      ...data,
      name: name,
      description: description,
      blocked: false,
      blockedReason: null,
      externalId: externalId
    } as typeof global.entity.Token)

    return repo.save(newToken)
  } catch (error) {
    throw error
  }
}

export async function resetExternalId(id: string, runner?: QueryRunner) {
  if (!id) {
    throw new ServiceError('Invalid parameters', 400)
  }

  try {
    const repo = getTokenRepo(runner)
    let externalId, token
    do {
      externalId = Crypto.randomUUID({ disableEntropyCache: true })
      token = await repo.findOneBy({ externalId: externalId })
    } while (token != null)

    return await updateTokenById(id, { externalId: externalId }, runner)
  } catch (error) {
    if (error?.code == 23505) {
      throw new ServiceError('External ID not changed', 409)
    }
    throw error
  }
}

export async function updateTokenById(id: string, token: typeof global.entity.Token, runner?: QueryRunner) {
  if (!id || !token) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    const repo = getTokenRepo(runner)
    const tokenEx = await repo.findOneBy({ id: id })
    if (!tokenEx) {
      throw new ServiceError('Token not found', 404)
    }
    const merged = repo.merge(tokenEx, token)
    return repo.save(merged)
  } catch (error) {
    throw error
  }
}

export async function retrieveTokenById(id: string, runner?: QueryRunner) {
  if (!id) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getTokenRepo(runner).findOneBy({ id: id })
  } catch (error) {
    throw error
  }
}

export async function retrieveTokenByExternalId(externalId: string, runner?: QueryRunner) {
  if (!externalId) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getTokenRepo(runner).findOneBy({ externalId: externalId })
  } catch (error) {
    throw error
  }
}

export async function blockTokenById(id: string, reason: string, runner?: QueryRunner) {
  return updateTokenById(id, { blocked: true, blockedAt: new Date(), blockedReason: reason }, runner)
}

export async function unblockTokenById(id: string, runner?: QueryRunner) {
  return updateTokenById(id, { blocked: false, blockedAt: new Date(), blockedReason: null }, runner)
}

export async function countQuery(data: any, runner?: QueryRunner) {
  return await executeCountQuery(getTokenRepo(runner), data, {})
}

export async function findQuery(data: any, runner?: QueryRunner) {
  return await executeFindQuery(getTokenRepo(runner), {}, data)
}

export async function removeTokenById(id: string, runner?: QueryRunner) {
  if (!id) {
    throw new ServiceError('Invalid parameters', 400)
  }
  try {
    return await getTokenRepo(runner).delete(id)
  } catch (error) {
    throw error
  }
}
