import { FastifyReply, FastifyRequest } from 'fastify'

export async function count(req: FastifyRequest, _reply: FastifyReply) {
  return await req.server['tokenManager'].countQuery(req.data(), req.runner)
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  const { headers, records } = await req.server['tokenManager'].findQuery(req.data(), req.runner)
  return reply.type('application/json').headers(headers).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()

  const token = await req.server['tokenManager'].retrieveTokenById(id, req.runner)
  return token || reply.status(404).send()
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const data = req.data()

  if (!data.name) {
    return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Token name not valid' })
  }

  // public is the default
  const publicRole = global.roles?.public?.code || 'public'
  data.roles = (data.requiredRoles || []).map((r) => global.roles[r]?.code).filter((r) => !!r)
  if (!data.roles.includes(publicRole)) {
    data.roles.push(publicRole)
  }

  let token = await req.server['tokenManager'].createToken(data, req.runner)
  if (!token || !token.getId() || !token.externalId) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Token not registered' })
  }

  const bearerToken = await reply.jwtSign(
    { sub: token.externalId },
    {
      sign: { expiresIn: data?.expiresIn || undefined }
    }
  )
  if (!bearerToken) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Token not signed' })
  }

  token = await req.server['tokenManager'].updateTokenById(token.getId(), { token: bearerToken }, req.runner)
  return token
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  let token = await req.server['tokenManager'].retrieveTokenById(id, req.runner)
  if (!token) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Token not found' })
  }

  token = await req.server['tokenManager'].removeTokenById(id, req.runner)
  return { ok: true }
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  const token = await req.server['tokenManager'].retrieveTokenById(id, req.runner)
  if (!token || !token.getId()) {
    return reply.status(404).send()
  }

  const data = req.data() || {}
  return req.server['tokenManager'].updateTokenById(token.getId(), data, req.runner)
}

export async function block(req: FastifyRequest, reply: FastifyReply) {
  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply.status(403).send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to block a user' })
  }

  const { id: userId } = req.parameters()
  const { reason } = req.data()

  await req.server['tokenManager'].blockTokenById(userId, reason, req.runner)
  const token = await req.server['tokenManager'].retrieveTokenById(userId, req.runner)
  return { ok: !!token.getId() }
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply
      .status(403)
      .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to unblock a user' })
  }

  const { id: userId } = req.parameters()
  await req.server['tokenManager'].unblockTokenById(userId, req.runner)
  const token = await req.server['tokenManager'].retrieveTokenById(userId, req.runner)
  return { ok: !!token.getId() }
}
