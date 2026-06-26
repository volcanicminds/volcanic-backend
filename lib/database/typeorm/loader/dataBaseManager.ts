import { QueryRunner, EntityManager } from 'typeorm'
import * as log from '../util/logger.js'

export function isImplemented() {
  return true
}

export async function synchronizeSchemas(runner?: QueryRunner) {
  try {
    if (runner) {
      await runner.connection.synchronize()
    } else {
      await global.connection.synchronize()
    }
    return true
  } catch (error) {
    log.error(`Volcanic-TypeORM: ${error}`)
    throw error
  }
}

export async function retrieveBy(entityName: string, entityId: string, context?: QueryRunner | EntityManager) {
  try {
    const { multi_tenant } = (global as any).config?.options || {}

    if (multi_tenant?.enabled && !context) {
      const errorMsg =
        '[DataBaseManager] ⛔️ CRITICAL: Missing DB Context (Runner/Manager) in Multi-Tenant Environment! Implicit fallback to public schema forbidden.'
      log.error(errorMsg)
      throw new Error(errorMsg)
    }

    if (context) {
      // Handle QueryRunner logic
      if ((context as QueryRunner).manager) {
        return await (context as QueryRunner).manager.findOneBy(entityName, { id: entityId })
      }
      // Handle EntityManager logic
      return await (context as EntityManager).findOneBy(entityName, { id: entityId })
    }
    return await global.connection.getRepository(global.entity[entityName]).findOneBy({ id: entityId })
  } catch (error) {
    if (!(entityName in global.entity)) {
      log.error(`Volcanic-TypeORM: ${entityName} not found in global.entity`)
    }
    throw error
  }
}

export async function addChange(
  entityName: string,
  entityId: string,
  status: string,
  userId: string,
  contents: unknown,
  changeEntity = 'Change',
  context?: QueryRunner | EntityManager
) {
  try {
    const { multi_tenant } = (global as any).config?.options || {}

    if (multi_tenant?.enabled && !context) {
      const errorMsg =
        '[DataBaseManager] ⛔️ CRITICAL: Missing DB Context (Runner/Manager) in Multi-Tenant Environment! Implicit fallback to public schema forbidden.'
      log.error(errorMsg)
      throw new Error(errorMsg)
    }

    if (context) {
      let repo
      if ((context as QueryRunner).manager) {
        repo = (context as QueryRunner).manager.getRepository(changeEntity)
      } else {
        repo = (context as EntityManager).getRepository(changeEntity)
      }

      const newChange = repo.create({ entityName, entityId, status, userId, contents })
      return repo.save(newChange)
    }
    const repo = global.connection.getRepository(global.entity[changeEntity])
    const newChange = repo.create({ entityName, entityId, status, userId, contents })
    return repo.save(newChange)
  } catch (error) {
    if (!(changeEntity in global.entity)) {
      log.error(`Volcanic-TypeORM: ${changeEntity} not found in global.entity`)
    }
    throw error
  }
}
