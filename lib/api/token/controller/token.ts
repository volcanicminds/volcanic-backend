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

  const bearerToken = await signBearer(req, reply, token.externalId, expiresAt)
  if (!bearerToken) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Token not signed' })
  }

  // The bearer is returned here once and never stored: the row keeps the `externalId` it
  // resolves to, so whoever reads the table holds no credential, and a lost bearer is replaced
  // by a reissue, not read back.
  return { ...token, token: bearerToken }
}

/**
 * The bearer of a row. The tenant the row lives in is signed into it, as into a session's: with a
 * token the tenant of a request comes from `tid`, and a header may only agree with it
 * (docs/AUTHORIZATION_V5.md §5). Without tenants there is none, and no claim. It expires when the
 * row says, and only then: `expiresIn: undefined` replaces the session lifetime (JWT_EXPIRES_IN)
 * that @fastify/jwt would otherwise apply.
 */
async function signBearer(req: FastifyRequest, reply: FastifyReply, externalId: string, expiresAt: Date | null): Promise<string> {
  const claims = { sub: externalId, ...(req.tenantInfo && { tid: req.tenantInfo.id }) }
  return await reply.jwtSign(expiresAt ? { ...claims, exp: Math.floor(expiresAt.getTime() / 1000) } : claims, {
    sign: { expiresIn: undefined }
  })
}

/**
 * A new bearer for an existing token, shown once. The `externalId` changes first, so every bearer
 * signed before stops resolving to the row; name, roles and expiry stay. A blocked token is
 * reissued too: its new bearer is refused like the old one until the token is unblocked. A bearer
 * carries the row's roles, so Rule A applies as on a creation: whoever could not mint an admin
 * token cannot take the bearer of one either.
 */
export async function reissue(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const tokens = req.server['tokenManager']

  const token = await tokens.retrieveTokenById(dataContext(req), id)
  if (!token?.id || token.deletedAt) return reply.status(404).send()
  if (assignsAdmin(req, token.roles)) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Cannot reissue a token with the admin role' })
  }

  const expiresAt = token.expiresAt ? new Date(token.expiresAt) : null
  if (expiresAt && !(expiresAt.getTime() > Date.now())) {
    return reply
      .status(409)
      .send(httpError(409, 'This token has expired, and a reissued bearer would be refused too: create a new token', 'TOKEN_EXPIRED'))
  }

  const externalId = await tokens.resetExternalId(dataContext(req), token.id)
  const bearerToken = await signBearer(req, reply, externalId, expiresAt)
  return { ...token, externalId, token: bearerToken }
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
