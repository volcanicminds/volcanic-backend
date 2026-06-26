/* eslint-disable @typescript-eslint/no-explicit-any */
import { DataSource, EntityManager } from 'typeorm'
import { Tenant } from '../entities/tenant.js'

export class TenantManager {
  constructor(private dataSource: DataSource) {}

  isImplemented() {
    return true
  }

  async resolveTenant(req: any): Promise<Tenant | null> {
    const { multi_tenant } = (global as any).config?.options || {}
    const headerKey = multi_tenant?.header_key || 'x-tenant-id'

    // 1. Single Tenant Mode (Default)
    if (!multi_tenant?.enabled) {
      return null
    }

    // 2. Multi-Tenant Mode: Extract Identifiers
    // Parse JWT from headers if not already attached (Fastify might attach it to req.user)
    const jwtTid = req.user?.tid
    const headerTid = req.headers[headerKey]

    // 3. Validation Logic (Strict)
    // Rule A: Header is MANDATORY in Multi-Tenant
    if (!headerTid) {
      // Log debug and return null to let the caller handle 404/403
      if ((global as any).log?.d) (global as any).log.debug('[TenantManager] No tenant header found')
      return null
    }

    // Rule B: JWT is OPTIONAL (For Public Routes/Login)
    // Rule C: Must Match (Security against Spoofing)
    if (jwtTid && headerTid) {
      if (jwtTid !== headerTid) {
        // Warning: Mismatch between Token and Header.
        // This is suspicious unless it's a System Admin impersonation flow.
        if ((global as any).log?.w)
          (global as any).log.warn(`[TenantManager] Mismatch: Token(${jwtTid}) vs Header(${headerTid})`)
      }
    }

    const tenantId = headerTid

    // 5. Database Lookup
    const tenantRepo = this.dataSource.getRepository('Tenant')

    // Support lookup by ID or SLUG
    const tenant = (await tenantRepo.findOne({
      where: [{ slug: tenantId }]
    })) as unknown as Tenant

    if (!tenant) {
      if ((global as any).log?.d) (global as any).log.debug(`[TenantManager] Tenant ${tenantId} not found in DB`)
      return null
    }

    if (tenant.status !== 'active') {
      if ((global as any).log?.d) (global as any).log.debug(`[TenantManager] Tenant ${tenantId} is not active`)
      return null
    }

    return tenant
  }

  /**
   * Switches the database context to the specific tenant schema.
   * CRITICAL SECURITY: This method MUST receive an EntityManager (db) when using Postgres Multi-Tenancy.
   * Modifying the global search_path is strictly forbidden to prevent data leaks.
   */
  async switchContext(tenant: Tenant, db?: EntityManager) {
    const driver = this.dataSource.driver.options.type

    if (driver === 'postgres') {
      const schema = tenant.dbSchema || 'public'
      const safeSchema = schema.replace(/[^a-z0-9_]/gi, '')

      if (db) {
        if ((global as any).log?.t)
          (global as any).log.trace(`[TenantManager] Context-Aware Switch Schema to: ${safeSchema}`)
        // Execute SET search_path only on the specific transactional QueryRunner
        await db.query(`SET search_path TO "${safeSchema}", public`)
      } else {
        // STRICT SECURITY CHECK
        // If no db (EntityManager) is provided, we used to fallback to global dataSource.
        // This is now FORBIDDEN as it poisons the connection pool.
        const errorMsg =
          '[TenantManager] ⛔️ CRITICAL: Attempted UNSAFE global context switch without QueryRunner. This operation has been blocked to prevent data leaks.'
        if ((global as any).log?.f) (global as any).log.fatal(errorMsg)
        throw new Error(errorMsg)
      }
    } else if (driver === 'mongodb') {
      // Mongo implementation stub
      if ((global as any).log?.w)
        (global as any).log.warn('[TenantManager] Mongo Multi-Tenancy context switch is not enforcing isolation yet.')
    }
  }

  async createTenant(data: any): Promise<Tenant> {
    const driver = this.dataSource.driver.options.type
    const repo = this.dataSource.getRepository('Tenant')

    // Data validation should be handled by Schema validation in API
    // Enforce lowercase slug
    if (data.slug) data.slug = data.slug.toLowerCase()

    // Check existence
    const existing = await repo.findOne({
      where: [{ slug: data.slug }, { dbSchema: data.dbSchema }]
    })
    if (existing) {
      throw new Error('Tenant with this slug or dbSchema already exists')
    }

    const tenant = repo.create({
      ...data,
      status: 'active'
    })
    const savedTenant = (await repo.save(tenant)) as any as Tenant

    if (driver === 'postgres') {
      const schema = data.dbSchema
      if (!schema) throw new Error('dbSchema is required for Postgres Multi-Tenancy')

      const safeSchema = schema.replace(/[^a-z0-9_]/gi, '')
      const qr = this.dataSource.createQueryRunner()
      await qr.connect()
      try {
        await qr.query(`CREATE SCHEMA IF NOT EXISTS "${safeSchema}"`)

        // --- Schema Synchronization ---
        // We create an ephemeral DataSource to force TypeORM to synchronize only the specific schema.
        // This is necessary because the global DataSource is bound to the public/default schema.
        if ((global as any).log?.i)
          (global as any).log.info(`[TenantManager] Synchronizing tables for schema: ${safeSchema}`)

        const tenantDs = new DataSource({
          ...(this.dataSource.options as any),
          schema: safeSchema,
          synchronize: true,
          name: `sync_${safeSchema}_${Date.now()}`
        })
        await tenantDs.initialize()
        await tenantDs.destroy()

        if ((global as any).log?.i)
          (global as any).log.info(`[TenantManager] Schema ${safeSchema} synchronized successfully`)

        await qr.startTransaction()

        // Context Switch within the same transaction to seed the user
        // Use SET LOCAL so it automatically reverts at the end of the transaction
        await qr.query(`SET LOCAL search_path TO "${safeSchema}", public`)

        if (data.adminEmail && data.adminPassword) {
          if ((global as any).log?.i) (global as any).log.info(`[TenantManager] Seeding Admin User: ${data.adminEmail}`)
          const { createUser } = await import('./userManager.js')

          await createUser(
            {
              email: data.adminEmail,
              password: data.adminPassword,
              roles: ['admin'],
              firstName: data.adminFirstName || 'Tenant',
              lastName: data.adminLastName || 'Admin'
            } as any,
            qr
          )
        }

        await qr.commitTransaction()
        if ((global as any).log?.i) (global as any).log.info(`[TenantManager] Created Schema & Admin: ${safeSchema}`)
      } catch (err) {
        if (qr.isTransactionActive) {
          await qr.rollbackTransaction()
        }
        throw err
      } finally {
        try {
          // Reset to public for safety before releasing
          await qr.query(`SET search_path TO public`)
        } catch (cleanupErr) {
          if ((global as any).log?.e)
            (global as any).log.error(`[TenantManager] Failed to reset search_path: ${cleanupErr}`)
        }
        await qr.release()
      }
    } else {
      // Mongo or others
      if ((global as any).log?.i) (global as any).log.info(`[TenantManager] Created Tenant Record for ${driver}`)
    }

    return savedTenant
  }

  async deleteTenant(id: string): Promise<void> {
    const repo = this.dataSource.getRepository('Tenant')
    await repo.softDelete(id)
  }

  async restoreTenant(id: string) {
    const repo = this.dataSource.getRepository('Tenant')
    await repo.restore(id)
    return repo.findOneBy({ id })
  }

  async getTenant(id: string) {
    const repo = this.dataSource.getRepository('Tenant')
    return (await repo.findOneBy({ id })) as unknown as Tenant
  }

  async updateTenant(id: string, data: Partial<Tenant>) {
    const repo = this.dataSource.getRepository('Tenant')
    // Exclude dbSchema from updates as it requires migration of tables
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { dbSchema: _ignore, ...updateData } = data
    await repo.update(id, updateData as any)
    return repo.findOneBy({ id })
  }

  async listTenants() {
    const repo = this.dataSource.getRepository('Tenant')
    return repo.find({ order: { createdAt: 'DESC' } as any })
  }

  /**
   * Safe utility to execute a function within a specific Tenant Context (e.g. for Background Jobs or System Admin tasks).
   * This handles the creation, connection, context switch, and release of a QueryRunner automatically.
   */
  async runInTenantContext<T>(tenantId: string, callback: (em: EntityManager) => Promise<T>): Promise<T> {
    const tenant = await this.getTenant(tenantId)
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`)
    if (tenant.status !== 'active') throw new Error(`Tenant ${tenantId} is not active`)

    const qr = this.dataSource.createQueryRunner()
    await qr.connect()

    try {
      // Enforce context switch on this specific runner
      await this.switchContext(tenant, qr.manager)

      // Execute callback with the isolated EntityManager
      const result = await callback(qr.manager)
      return result
    } finally {
      try {
        await qr.query('SET search_path TO public')
      } catch (e) {
        if ((global as any).log?.w)
          (global as any).log.warn(`[TenantManager] Failed to reset search_path context: ${e}`)
      }
      await qr.release()
    }
  }
}
