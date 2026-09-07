import { FastifyReply, FastifyRequest } from 'fastify'
import { includesRole } from '../../../util/authz.js'
import { dataContext } from '../../../util/tenancy.js'

// Rule A: only an admin may grant a token the admin role, and only with
// allow_multiple_admin — otherwise a `tokens` capability holder could mint an admin
// token and escalate. Tokens carry roles used for authorization (see onRequest).
function assignsAdmin(req: FastifyRequest, roleValue: unknown): boolean {
  return (
    includesRole(roleValue, roles.admin.code) &&
    (!req.hasRole(roles.admin) || config.options?.allow_multiple_admin !== true)
  )
}

export async function count(req: FastifyRequest, _reply: FastifyReply) {
  return await req.server['tokenManager'].countQuery(dataContext(req), req.data())
}

export async function find(req: FastifyRequest, reply: FastifyReply) {
  const { headers, records } = await req.server['tokenManager'].findQuery(dataContext(req), req.data())
  return reply.type('application/json').headers(headers).send(records)
}

export async function findOne(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()

  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), id)
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

  if (assignsAdmin(req, data.roles)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cannot assign the admin role to a token' })
  }

  let token = await req.server['tokenManager'].createToken(dataContext(req), data)
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

  token = await req.server['tokenManager'].updateTokenById(dataContext(req), token.getId(), { token: bearerToken })
  return token
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  let token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), id)
  if (!token) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Token not found' })
  }

  token = await req.server['tokenManager'].removeTokenById(dataContext(req), id)
  return { ok: true }
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), id)
  if (!token || !token.getId()) {
    return reply.status(404).send()
  }

  const data = req.data() || {}
  if (assignsAdmin(req, data.roles)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cannot assign the admin role to a token' })
  }
  return req.server['tokenManager'].updateTokenById(dataContext(req), token.getId(), data)
}

export async function block(req: FastifyRequest, _reply: FastifyReply) {
  const { id: userId } = req.parameters()
  const { reason } = req.data()

  await req.server['tokenManager'].blockTokenById(dataContext(req), userId, reason)
  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), userId)
  return { ok: !!token.getId() }
}

export async function unblock(req: FastifyRequest, _reply: FastifyReply) {
  const { id: userId } = req.parameters()
  await req.server['tokenManager'].unblockTokenById(dataContext(req), userId)
  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), userId)
  return { ok: !!token.getId() }
}
