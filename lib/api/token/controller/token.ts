import { FastifyReply, FastifyRequest } from 'fastify'

export async function count(req: FastifyRequest, _reply: FastifyReply) {
  return await req.server['tokenManager'].countQuery(req.data())
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  const { headers, records } = await req.server['tokenManager'].findQuery(req.data())
  return reply.type('application/json').headers(headers).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()

  const token = await req.server['tokenManager'].retrieveTokenById(id)
  return token || reply.status(404).send()
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = req.data()

  if (!data.name) {
    return reply.status(404).send(new Error('Token name not valid'))
  }

  // public is the default
  const publicRole = global.roles?.public?.code || 'public'
  data.roles = (data.requiredRoles || []).map((r) => global.roles[r]?.code).filter((r) => !!r)
  if (!data.roles.includes(publicRole)) {
    data.roles.push(publicRole)
  }

  let token = await req.server['tokenManager'].createToken(data)
  if (!token || !token.getId() || !token.externalId) {
    return reply.status(400).send(new Error('Token not registered'))
  }

  const bearerToken = await reply.jwtSign(
    { sub: token.externalId },
    {
      sign: { expiresIn: data?.expiresIn || undefined }
    }
  )
  if (!bearerToken) {
    return reply.status(400).send(new Error('Token not signed'))
  }

  token = await req.server['tokenManager'].updateTokenById(token.getId(), { token: bearerToken })
  return token
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  let token = await req.server['tokenManager'].retrieveTokenById(id)
  if (!token) {
    return reply.status(403).send(new Error('Token not found'))
  }

  token = await req.server['tokenManager'].removeTokenById(id)
  return { ok: true }
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  const token = await req.server['tokenManager'].retrieveTokenById(id)
  if (!token || !token.getId()) {
    return reply.status(404).send()
  }

  const data = req.data() || {}
  return req.server['tokenManager'].updateTokenById(token.getId(), data)
}

export async function block(req: FastifyRequest, reply: FastifyReply) {
  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply.status(403).send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to block a user' })
  }

  const { id: userId } = req.parameters()
  const { reason } = req.data()

  await req.server['tokenManager'].blockTokenById(userId, reason)
  const token = await req.server['tokenManager'].retrieveTokenById(userId)
  return { ok: !!token.getId() }
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply
      .status(403)
      .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to unblock a user' })
  }

  const { id: userId } = req.parameters()
  await req.server['tokenManager'].unblockTokenById(userId)
  const token = await req.server['tokenManager'].retrieveTokenById(userId)
  return { ok: !!token.getId() }
}
