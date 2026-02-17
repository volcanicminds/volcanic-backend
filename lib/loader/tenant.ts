import { FastifyInstance } from 'fastify'
import { TenantManagement } from '../../types/global.js'

export async function apply(server: FastifyInstance) {
  const { multi_tenant } = global.config.options || {}

  // Se multi-tenant non è abilitato, usciamo subito e iniettiamo il contesto single-tenant
  if (!multi_tenant?.enabled) {
    if (log.i) log.info('Multi-Tenant: Disabled (Using single-tenant DB context)')

    server.addHook('onRequest', async (req) => {
      const dataSource = global.connection
      if (dataSource) {
        req.db = dataSource.manager
      }
    })
    return
  }

  if (log.i) log.info('Multi-Tenant: 🟢 Enabled')

  // Hook globale per la risoluzione del tenant
  // Deve essere eseguito all'inizio della richiesta
  server.addHook('onRequest', async (req, reply) => {
    // Recuperiamo il gestore tenant iniettato o di default
    const tm = server['tenantManager'] as TenantManagement

    // Check if route opts out of tenant context
    const cfg = (req.routeOptions?.config as { tenantContext?: boolean }) || {}
    if (cfg.tenantContext === false) {
      if (log.t) log.trace(`Multi-Tenant: Route ${req.url} opted out of tenant context via config`)
      // Inject global DB context (public schema) like single-tenant
      const dataSource = global.connection
      if (dataSource) req.db = dataSource.manager
      return
    }

    // Controllo critico: se è abilitato il MT, DEVE esserci un manager implementato
    if (!tm || !tm.isImplemented()) {
      const errorMsg = 'Multi-Tenant enabled but no TenantManager provided/implemented!'
      if (log.f) log.fatal(errorMsg)
      throw new Error(errorMsg)
    }

    try {
      // 1. Risoluzione Tenant
      const tenant = await tm.resolveTenant(req)

      if (!tenant) {
        if (log.w) log.warn(`Multi-Tenant: Tenant resolution failed for request ${req.id}`)
        return reply.code(404).send({
          statusCode: 404,
          error: 'Not Found',
          message: 'Tenant not found or resolution failed'
        })
      }

      // 2. Setup Contesto
      req.tenant = tenant
      if (log.t) log.trace(`Multi-Tenant: Context switched to ${tenant.slug || tenant.id}`)

      // 3. Creazione QueryRunner (Context-Chain Root)
      // Questo è il cuore della "Golden Solution": ogni richiesta ha il suo QueryRunner isolato
      const dataSource = global.connection
      if (dataSource) {
        const qr = dataSource.createQueryRunner()
        await qr.connect()

        // Assegnamo il manager del QueryRunner alla richiesta
        req.db = qr.manager
        req.runner = qr

        // 4. Switch Schema su QUESTO QueryRunner
        // Passiamo il manager affinché il TenantManager possa eseguire "SET search_path" su questa connessione specifica
        await tm.switchContext(tenant, qr.manager)

        // 5. Cleanup: Rilascio del QueryRunner alla fine della richiesta
        reply.raw.on('finish', async () => {
          if (!qr.isReleased) {
            await qr.release()
          }
        })
      } else {
        if (log.w) log.warn('Multi-Tenant: Global connection not found! Skipping DB context creation.')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (log.e) log.error(`Multi-Tenant Error: ${message}`)
      return reply.code(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Tenant Context Switch Failed'
      })
    }
  })
}
