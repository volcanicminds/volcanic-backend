import { FastifyReply, FastifyRequest } from 'fastify'

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

export async function impersonate(req: FastifyRequest, reply: FastifyReply) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, prefer-const
  let { targetTenantSlug, targetTenantId, targetRole, targetUserEmail, targetUserId } = req.body as any

  // DX Improvement: If no target tenant specified, default to current context (self-impersonation)
  if (!targetTenantSlug && !targetTenantId && req.tenant) {
    targetTenantSlug = req.tenant.slug
  }

  // 1. Risoluzione Tenant (MUST be active)
  // We access the Tenant Entity remotely via global connection
  const Tenant = global.entity?.Tenant || global.connection.getRepository('Tenant').target
  const tenantRepo = global.connection.getRepository(Tenant)

  const targetTenant = await tenantRepo.findOne({
    where: [
      { slug: targetTenantSlug, status: 'active' },
      { id: targetTenantId, status: 'active' }
    ]
  })

  if (!targetTenant) {
    return reply.code(404).send({ error: 'Target tenant not found or inactive' })
  }

  // 2. Security Check (Hardened)
  // Allow if:
  // A) System Admin (Cross-Tenant)
  // B) Tenant Admin (Same Tenant)

  let isSystemAdmin = false
  // Check system context or explicit system tenant id
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (req.user?.tenantId === 'system' || req.tenant?.slug === 'system') {
    isSystemAdmin = true
  }

  let isTenantAdminForTarget = false
  // Check if current request tenant matches target
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  if (req.tenant?.id === targetTenant.id || req.tenant?.slug === targetTenant.slug) {
    // Logic to check admin role
    // We safely check req.roles() if available, or fallback to user.roles
    const userRoles = typeof req.roles === 'function' ? req.roles() : req.user?.roles || []
    // Normalize roles to strings
    const roleCodes = userRoles.map((r: any) => (typeof r === 'string' ? r : r?.code))

    if (roleCodes.includes('admin')) {
      isTenantAdminForTarget = true
    }
  }

  if (!isSystemAdmin && !isTenantAdminForTarget) {
    return reply
      .code(403)
      .send({ error: 'Unauthorized: Only System Admins or Tenant Admins can impersonate (Invalid Context)' })
  }

  // 3. Risoluzione Utente (su schema target)
  // We manually switch context using a fresh QueryRunner to avoid polluting the request context
  const qr = global.connection.createQueryRunner()
  await qr.connect()

  try {
    const dbSchema = targetTenant.dbSchema
    if (!dbSchema) throw new Error('Target tenant has no schema defined')

    await qr.query(`SET search_path TO "${dbSchema}", "public"`)

    // We assume User entity is standard.
    // We try to get repository from name string to avoid strict type dependency if possible,
    // or use global.entity.User if available from boot.
    const UserEntity = global.entity?.User || 'User'
    const targetUserRepo = qr.manager.getRepository(UserEntity)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let targetUser: any = null

    // Criteri di ricerca (user MUST be active)
    // User.e.ts has: blocked: boolean. confirmed: boolean.

    const baseWhere = { blocked: false }

    if (targetUserId) {
      targetUser = await targetUserRepo.findOne({ where: { ...baseWhere, id: targetUserId } })
    } else if (targetUserEmail) {
      targetUser = await targetUserRepo.findOne({ where: { ...baseWhere, email: targetUserEmail } })
    } else if (targetRole) {
      // SECURITY: ArrayContains
      targetUser = await targetUserRepo
        .createQueryBuilder('user')
        .where('user.blocked = :blocked', { blocked: false })
        .andWhere(':role = ANY(user.roles)', { role: targetRole })
        .getOne()
    }

    if (!targetUser) {
      return reply.code(404).send({ error: 'Target user not found (or blocked) matching criteria' })
    }

    // 3. Generazione Token Impersonato
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
  } finally {
    await qr.release()
  }
}
