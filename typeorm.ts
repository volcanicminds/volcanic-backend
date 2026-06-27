/* eslint-disable @typescript-eslint/no-explicit-any */
import dotenv from 'dotenv'
dotenv.config()

import 'reflect-metadata'
import { DataSource } from 'typeorm'
import * as loaderEntities from './lib/database/typeorm/loader/entities.js'
import * as userManager from './lib/database/typeorm/loader/userManager.js'
import * as tokenManager from './lib/database/typeorm/loader/tokenManager.js'
import * as dataBaseManager from './lib/database/typeorm/loader/dataBaseManager.js'
import { TenantManager } from './lib/database/typeorm/loader/tenantManager.js'
import { isEmbedded, setupEmbedded, closeEmbedded } from './lib/database/typeorm/embedded.js'
import { User } from './lib/database/typeorm/entities/user.js'
import { Tenant } from './lib/database/typeorm/entities/tenant.js'
import { Token } from './lib/database/typeorm/entities/token.js'
import { Change } from './lib/database/typeorm/entities/change.js'
import {
  applyQuery,
  executeCountQuery,
  executeCountView,
  executeFindQuery,
  executeFindView,
  useOrder,
  useWhere,
  configureSensitiveFields,
  configureCaseInsensitiveDefault
} from './lib/database/typeorm/query.js'
import * as log from './lib/database/typeorm/util/logger.js'
import yn from './lib/database/typeorm/util/yn.js'

async function start(options) {
  if ((global as any).npmDebugServerStarted) {
    options = {
      type: 'postgres',
      host: '127.0.0.1',
      port: 5432,
      username: 'vminds',
      password: 'vminds',
      database: 'vminds',
      synchronize: true,
      logging: true, // query, error, schema, warn, info, all
      logger: '' // advanced-console, simple-console
    }
  }

  if (options == null || Object.keys(options).length == 0) {
    throw new Error('Volcanic Database: options not specified')
  }

  if (options.sensitiveFields) {
    configureSensitiveFields(options.sensitiveFields)
  }

  if (typeof options.caseInsensitiveByDefault === 'boolean') {
    configureCaseInsensitiveDefault(options.caseInsensitiveByDefault)
    delete options.caseInsensitiveByDefault // custom option, keep it out of TypeORM
  }

  // Embedded engine (PGlite): rewrites options to a Postgres-dialect DataSource backed
  // by an in-process WASM Postgres, registering/creating extensions before synchronize.
  // No-op for any other `type` (e.g. real 'postgres'). See lib/database/typeorm/embedded.ts.
  if (isEmbedded(options)) {
    await setupEmbedded(options)
  }

  const { LOG_DB_LEVEL = 'warn', LOG_COLORIZE = true, DB_SYNCHRONIZE_SCHEMA_AT_STARTUP = false } = process.env

  const logLevel: string | boolean =
    LOG_DB_LEVEL === 'trace'
      ? 'all'
      : LOG_DB_LEVEL === 'debug'
        ? 'query'
        : LOG_DB_LEVEL === 'info'
          ? 'info'
          : LOG_DB_LEVEL === 'warn'
            ? 'warn'
            : LOG_DB_LEVEL === 'error'
              ? 'error'
              : LOG_DB_LEVEL

  ;(global as any).cacheTimeout = options?.cacheTimeout || 30000 // milliseconds
  ;(global as any).isLoggingEnabled = options?.logging || true

  const { classes, repositories, entities } = await loaderEntities.load()
  options.entities = [...(options.entities || []), ...(entities || [])]
  options.logger = LOG_COLORIZE ? 'advanced-console' : 'simple-console'
  options.logging = logLevel
  options.synchronize = false

  const ds = new DataSource(options)
  await ds.initialize()

  if (yn(DB_SYNCHRONIZE_SCHEMA_AT_STARTUP, false)) {
    const { multi_tenant } = (global as any).config?.options || {}
    if (multi_tenant?.enabled) {
      log.warn('Volcanic-TypeORM: Multi-Tenant enabled, skipping schema synchronization')
    } else {
      log.warn('Volcanic-TypeORM: Database schema synchronization started')
      await ds.synchronize()
      log.warn('Volcanic-TypeORM: Database schema synchronization finished')
    }
  }

  // load uselful stuff
  const repository = {}
  Object.keys(repositories).map((r) => (repository[r] = ds.getRepository(repositories[r])))
  ;(global as any).connection = ds
  ;(global as any).entity = classes

  // FAIL-FAST: Proxy to forbid access to global repositories
  ;(global as any).repository = new Proxy(repository, {
    get(target, prop) {
      // Allow internal/debug access if needed (like console.log or inspection that checks keys)
      if (prop === 'toJSON' || prop === 'toString' || prop === Symbol.toStringTag) return target[prop]

      // If the property exists in the repository map, BLOCK IT.
      if (typeof prop === 'string' && prop in target) {
        throw new Error(
          `[Volcanic-TypeORM] FATAL: Access to global.repository.${prop} is FORBIDDEN. Refactor usage to Context-Aware Service: service.use(req.db).`
        )
      }

      return target[prop]
    }
  })

  return ds
}

export { Database } from './types/database/typeorm/global.js'
export {
  start,
  closeEmbedded,
  User,
  Tenant,
  Token,
  Change,
  userManager,
  tokenManager,
  dataBaseManager,
  TenantManager,
  DataSource,
  applyQuery,
  executeCountQuery,
  executeCountView,
  executeFindQuery,
  executeFindView,
  useOrder,
  useWhere,
  configureSensitiveFields,
  configureCaseInsensitiveDefault
}
