import { FastifyReply, FastifyRequest } from 'fastify'

/*
 * S12 — schema name hardening for `SET search_path`.
 * Postgres identifiers cannot be parameterized, so the schema name is always
 * string-interpolated. Mirror the canonical sanitization used by
 * `@volcanicminds/typeorm`'s `tenantManager.switchContext`
 * (`schema.replace(/[^a-z0-9_]/gi, '')`): strip anything outside the safe
 * identifier alphabet. A legit schema name is unaffected; a tampered/malformed
 * value collapses to empty and is rejected fail-fast instead of being injected.
 */
export function sanitizeSchemaName(schema: string): string {
  return (schema || '').replace(/[^a-z0-9_]/gi, '')
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const tenants = await tm.listTenants()
  return reply.send(tenants)
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const data = req.data()
  // Provisioning is handled by the manager implementation
  const tenant = await tm.createTenant(data)

  // Return created
  return reply.code(201).send(tenant)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  const tenant = await tm.getTenant(id)
  if (!tenant) return reply.status(404).send()
  return reply.send(tenant)
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  const data = req.data()
  const tenant = await tm.updateTenant(id, data)
  if (!tenant) return reply.status(404).send()
  return reply.send(tenant)
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  await tm.deleteTenant(id)
  return reply.send({ message: 'Tenant archived/deleted', id })
}

export async function restore(req: FastifyRequest, reply: FastifyReply) {
  const tm = req.server['tenantManager']
  if (!tm.isImplemented()) return reply.status(501).send()

  const { id } = req.parameters()
  const tenant = await tm.restoreTenant(id)
  return reply.send({ message: 'Tenant restored', tenant })
}

// Helper: Resolve Target Tenant
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveTargetTenant(targetTenantSlug: string, targetTenantId: string, reqTenant: any) {
  let resolvedSlug = targetTenantSlug
  if (!resolvedSlug && !targetTenantId && reqTenant) {
    resolvedSlug = reqTenant.slug
  }

  const Tenant = global.entity?.Tenant || global.connection.getRepository('Tenant').target
  const tenantRepo = global.connection.getRepository(Tenant)

  return tenantRepo.findOne({
    where: [
      { slug: resolvedSlug, status: 'active' },
      { id: targetTenantId, status: 'active' }
    ]
  })
}

// Helper: Security Check
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkImpersonationSecurity(req: FastifyRequest, targetTenant: any): boolean {
  let isSystemAdmin = false
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (req.user?.tenantId === 'system' || req.tenant?.slug === 'system') {
    isSystemAdmin = true
  }

  let isTenantAdminForTarget = false
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (req.tenant?.id === targetTenant.id || req.tenant?.slug === targetTenant.slug) {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    const userRoles = typeof req.roles === 'function' ? req.roles() : req.user?.roles || []
    const roleCodes = userRoles.map((r: { code?: string } | string) => (typeof r === 'string' ? r : r?.code))

    if (roleCodes.includes('admin')) {
      isTenantAdminForTarget = true
    }
  }

  return isSystemAdmin || isTenantAdminForTarget
}

// Helper: Resolve Target User
async function resolveTargetUser(dbSchema: string, targetUserId: string, targetUserEmail: string, targetRole: string) {
  const safeSchema = sanitizeSchemaName(dbSchema)
  if (!safeSchema) {
    throw new Error('Invalid target tenant schema')
  }

  const qr = global.connection.createQueryRunner()
  await qr.connect()

  try {
    await qr.query(`SET search_path TO "${safeSchema}", "public"`)

    const UserEntity = global.entity?.User || 'User'
    const targetUserRepo = qr.manager.getRepository(UserEntity)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetUser: any = null

    const baseWhere = { blocked: false }

    if (targetUserId) {
      targetUser = await targetUserRepo.findOne({ where: { ...baseWhere, id: targetUserId } })
    } else if (targetUserEmail) {
      targetUser = await targetUserRepo.findOne({ where: { ...baseWhere, email: targetUserEmail } })
    } else if (targetRole) {
      targetUser = await targetUserRepo
        .createQueryBuilder('user')
        .where('user.blocked = :blocked', { blocked: false })
        .andWhere(':role = ANY(user.roles)', { role: targetRole })
        .getOne()
    }

    return targetUser
  } finally {
    await qr.release()
  }
}

export async function impersonate(req: FastifyRequest, reply: FastifyReply) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-const
  let { targetTenantSlug, targetTenantId, targetRole, targetUserEmail, targetUserId } = req.body as any

  // 1. Risoluzione Tenant
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const targetTenant = await resolveTargetTenant(targetTenantSlug, targetTenantId, req.tenant)
  if (!targetTenant) {
    return reply.code(404).send({ error: 'Target tenant not found or inactive' })
  }

  // 2. Security Check (Hardened)
  const isAuthorized = checkImpersonationSecurity(req, targetTenant)
  if (!isAuthorized) {
    return reply
      .code(403)
      .send({ error: 'Unauthorized: Only System Admins or Tenant Admins can impersonate (Invalid Context)' })
  }

  // 3. Risoluzione Utente (su schema target)
  const dbSchema = targetTenant.dbSchema
  if (!dbSchema) {
    throw new Error('Target tenant has no schema defined')
  }

  const targetUser = await resolveTargetUser(dbSchema, targetUserId, targetUserEmail, targetRole)

  if (!targetUser) {
    return reply.code(404).send({ error: 'Target user not found (or blocked) matching criteria' })
  }

  // 4. Generazione Token Impersonato
  // We rely on fastify-jwt which is decorated on 'reply' (standard in volcanic-backend)
  const token = await reply.jwtSign(
    {
      sub: targetUser.externalId, // Identity: The Local Admin
      tid: targetTenant.id, // Context: The Target Tenant
      roles: targetUser.roles, // Privileges: Inherited from Target
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      impersonator: req.user.email, // Audit: Who is holding the puppet strings
      iat: Math.floor(Date.now() / 1000)
    },
    { expiresIn: '24h' }
  )

  return {
    token,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    impersonatedUser: { email: targetUser.email, id: targetUser.id }
  }
}
