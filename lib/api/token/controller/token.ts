import { FastifyReply, FastifyRequest } from 'fastify'
import { includesRole } from '../../../util/authz.js'
import { dataContext } from '../../../util/tenancy.js'
import { httpError } from '../../../util/httpError.js'

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
  // `VHeaders` is a closed shape (`v-count`, `v-total`, …) and Fastify wants a header record, so
  // the conversion happens here, at the boundary, instead of loosening the type the data layer
  // returns.
  return reply.type('application/json').headers({ ...headers }).send(records)
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

  // Only an explicit `null` means no expiry. A missing field is refused here as well as by the
  // schema, which a project may replace: a permanent credential is never the default.
  const expiresAt = data.expiresAt === null ? null : new Date(data.expiresAt)
  if (expiresAt && !(expiresAt.getTime() > Date.now())) {
    return reply
      .status(400)
      .send(httpError(400, 'expiresAt must be a future date, or null for a token that never expires', 'TOKEN_EXPIRY_INVALID'))
  }
  data.expiresAt = expiresAt

  // public is the default
  const publicRole = global.roles?.public?.code || 'public'
  data.roles = (data.requiredRoles || []).map((r: string) => global.roles[r]?.code).filter((r?: string) => !!r)
  if (!data.roles.includes(publicRole)) {
    data.roles.push(publicRole)
  }

  if (assignsAdmin(req, data.roles)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cannot assign the admin role to a token' })
  }

  const token = await req.server['tokenManager'].createToken(dataContext(req), data)
  if (!token || !token.id || !token.externalId) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Token not registered' })
  }

  // The bearer expires when the row says, and only then: `expiresIn: undefined` replaces the
  // session lifetime (JWT_EXPIRES_IN) that @fastify/jwt would otherwise apply.
  const bearerToken = await reply.jwtSign(
    expiresAt ? { sub: token.externalId, exp: Math.floor(expiresAt.getTime() / 1000) } : { sub: token.externalId },
    { sign: { expiresIn: undefined } }
  )
  if (!bearerToken) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Token not signed' })
  }

  // The bearer is returned here once and never stored: the row keeps the `externalId` it
  // resolves to, so whoever reads the table holds no credential, and a lost bearer is replaced
  // by a new token, not read back.
  return { ...token, token: bearerToken }
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
  if (!token || !token.id) {
    return reply.status(404).send()
  }

  const data = req.data() || {}
  if (assignsAdmin(req, data.roles)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cannot assign the admin role to a token' })
  }
  return req.server['tokenManager'].updateTokenById(dataContext(req), token.id, data)
}

export async function block(req: FastifyRequest, _reply: FastifyReply) {
  const { id: userId } = req.parameters()
  const { reason } = req.data()

  await req.server['tokenManager'].blockTokenById(dataContext(req), userId, reason)
  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), userId)
  return { ok: !!token.id }
}

export async function unblock(req: FastifyRequest, _reply: FastifyReply) {
  const { id: userId } = req.parameters()
  await req.server['tokenManager'].unblockTokenById(dataContext(req), userId)
  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), userId)
  return { ok: !!token.id }
}
