import { FastifyReply, FastifyRequest } from 'fastify'
import type { DataHandle } from '../../../../types/global.js'
import { includesRole } from '../../../util/authz.js'
import { INTEGRATION_TYP } from '../../../util/credential.js'
import { dataContext, isPlatformRoute } from '../../../util/tenancy.js'
import { fieldNames, governed, type GovernanceEvent } from '../../../util/governance.js'
import { httpError } from '../../../util/httpError.js'
import { newPairingCode, normalizePairingCode, PAIRING_CODE_TTL_MS } from '../../../util/tokenPairing.js'

//
// One controller for the tokens of every plane: the tenant's on `/tokens`, the control plane's on
// `/system/tokens`. The route says which: its container, its catalogue of roles, and the claims
// of the bearer follow from it.
//
// Every act on a token is written in the governance log of the container the token lives in, in
// the transaction of the change, and in no other log: a change that cannot be written down
// is not made. Create, update, reissue and unblock ask for a step-up on their routes; block and
// delete do not, so an access is taken away at once.
//
const governedToken = <T>(req: FastifyRequest, change: (tx: DataHandle) => Promise<T>, event: (result: T) => GovernanceEvent | null) =>
  governed(req, change, event, { container: dataContext(req) })

const SUPERUSER = 'system:admin'

/**
 * Whether the roles would make the token sovereign of its plane. On the control plane always:
 * no token carries `system:admin`, whoever issues it. In a tenant, Rule A: only an admin may grant
 * a token the admin role, and only with allow_multiple_admin, otherwise a `tokens` capability
 * holder could mint an admin token and escalate. Tokens carry roles used for authorization (see
 * onRequest).
 */
function grantsSovereignty(req: FastifyRequest, roleValue: unknown): boolean {
  if (isPlatformRoute(req)) return includesRole(roleValue, SUPERUSER)
  return (
    includesRole(roleValue, roles.admin.code) &&
    (!req.hasRole(roles.admin) || config.options?.allow_multiple_admin !== true)
  )
}

const sovereignRefused = (reply: FastifyReply, message: string) =>
  reply.status(403).send(httpError(403, message, 'TOKEN_ROLE_FORBIDDEN'))

/**
 * The roles of the token's own plane, and no other, on a creation and on an update alike: a code
 * the catalogue does not hold is dropped. A tenant token always keeps `public`; the control plane
 * has no role to default to.
 */
function planeRoles(req: FastifyRequest, codes: unknown): string[] {
  const platform = isPlatformRoute(req)
  const catalogue: Record<string, { code: string } | undefined> = platform ? global.systemRoles : global.roles
  const known = (Array.isArray(codes) ? codes : []).map((r) => catalogue[r]?.code).filter((r?: string): r is string => !!r)
  const publicRole = global.roles?.public?.code || 'public'
  return platform || known.includes(publicRole) ? known : [...known, publicRole]
}

/** The fields an update may change. Block, removal, expiry and the bearer have routes of their own. */
const UPDATABLE = ['name', 'description', 'roles'] as const

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

  data.roles = planeRoles(req, data.requiredRoles)
  if (grantsSovereignty(req, data.roles)) {
    return sovereignRefused(reply, isPlatformRoute(req) ? 'A token never carries system:admin' : 'Cannot assign the admin role to a token')
  }

  const token = await governedToken(
    req,
    (tx) => req.server['tokenManager'].createToken(tx, data),
    (row) =>
      row?.id
        ? { action: 'token.created', targetId: row.id, detail: { roles: row.roles ?? [], expiresAt: expiresAt?.toISOString() ?? null } }
        : null
  )
  if (!token || !token.id || !token.externalId) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Token not registered' })
  }

  const bearerToken = signBearer(req, token.externalId, expiresAt)
  if (!bearerToken) {
    return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Token not signed' })
  }

  // The bearer is returned here once and never stored: the row keeps the `externalId` it
  // resolves to, so whoever reads the table holds no credential, and a lost bearer is replaced
  // by a reissue, not read back.
  return { ...token, token: bearerToken }
}

/**
 * The bearer of a row, labelled as an integration token (lib/util/credential.ts). The plane the
 * row lives in is signed into it, as into a session's: `scp: 'control'` for the control plane's,
 * which the tenant resolution refuses inside a container; the tenant's id for a tenant's, since
 * with a token the tenant of a request comes from `tid` and a header may only agree with it
 * (docs/AUTHORIZATION_V5.md §5). Without tenants there is neither. It expires when the
 * row says, and only then. `reply.jwtSign` would add the session lifetime (JWT_EXPIRES_IN) over the
 * row's `exp`, and drops an `expiresIn: undefined` meant to clear it; `jwt.sign` given options signs
 * with those alone, so the registered lifetime never applies.
 */
function signBearer(req: FastifyRequest, externalId: string, expiresAt: Date | null): string {
  const plane = isPlatformRoute(req) ? { scp: 'control' } : req.tenantInfo ? { tid: req.tenantInfo.id } : {}
  const claims = { sub: externalId, typ: INTEGRATION_TYP, ...plane }
  return req.server.jwt.sign(expiresAt ? { ...claims, exp: Math.floor(expiresAt.getTime() / 1000) } : claims, {})
}

/**
 * A new bearer for an existing token, shown once. The `externalId` changes first, so every bearer
 * signed before stops resolving to the row; name, roles and expiry stay. A blocked token is
 * reissued too: its new bearer is refused like the old one until the token is unblocked. A bearer
 * carries the row's roles, so Rule A applies as on a creation: whoever could not mint an admin
 * token cannot take the bearer of one either.
 */
export async function reissue(req: FastifyRequest, reply: FastifyReply) {
  const target = await reissuable(req, reply, 'Cannot reissue a token with the admin role')
  if (!target) return reply
  const { token, expiresAt } = target

  const externalId = await governedToken(
    req,
    (tx) => req.server['tokenManager'].resetExternalId(tx, token.id),
    () => ({ action: 'token.reissued', targetId: token.id })
  )
  const bearerToken = signBearer(req, externalId, expiresAt)
  return { ...token, externalId, token: bearerToken }
}

const hasExpired = (expiresAt: Date | null) => !!expiresAt && !(expiresAt.getTime() > Date.now())

/** The token a reissue, now or through a pairing code, may act on; null once the refusal is sent. */
async function reissuable(req: FastifyRequest, reply: FastifyReply, sovereign: string) {
  const { id } = req.parameters()
  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), id)
  if (!token?.id || token.deletedAt) {
    reply.status(404).send()
    return null
  }
  if (grantsSovereignty(req, token.roles)) {
    sovereignRefused(reply, sovereign)
    return null
  }
  const expiresAt: Date | null = token.expiresAt ? new Date(token.expiresAt) : null
  if (hasExpired(expiresAt)) {
    reply
      .status(409)
      .send(httpError(409, 'This token has expired, and a reissued bearer would be refused too: create a new token', 'TOKEN_EXPIRED'))
    return null
  }
  return { token, expiresAt }
}

/**
 * A code that a machine exchanges once, within ten minutes, for a reissue of the token
 * (docs/API_V5.md §4.2): what an administrator hands over instead of the bearer. The rules of a
 * reissue apply now, and the bearer the code delivers is signed at the exchange. Shown once,
 * kept as a hash; a new code voids the previous one.
 */
export async function issuePairingCode(req: FastifyRequest, reply: FastifyReply) {
  const target = await reissuable(req, reply, 'Cannot pair a token with the admin role')
  if (!target) return reply
  const { token } = target

  const { code, normalized } = newPairingCode()
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS)
  await governedToken(
    req,
    (tx) => req.server['tokenManager'].setPairingCode(tx, token.id, normalized, expiresAt),
    () => ({ action: 'token.pairing_code_issued', targetId: token.id, detail: { expiresAt: expiresAt.toISOString() } })
  )
  return { code, expiresAt: expiresAt.toISOString() }
}

/**
 * The exchange, unauthenticated: the code is the credential. The code is spent before anything is
 * checked, so a code that names an expired token or one that has gained the plane's sovereign role
 * is gone as well as refused. Unknown, expired, used, and ineligible all get one answer.
 */
export async function pair(req: FastifyRequest, reply: FastifyReply) {
  const code = normalizePairingCode(req.data()?.code)
  const tokens = req.server['tokenManager']
  const sovereign = isPlatformRoute(req) ? SUPERUSER : roles.admin.code

  const paired =
    code &&
    (await governedToken(
      req,
      async (tx) => {
        const token = await tokens.claimPairingCode(tx, code)
        const expiresAt: Date | null = token?.expiresAt ? new Date(token.expiresAt) : null
        if (!token?.id || hasExpired(expiresAt) || includesRole(token.roles, sovereign)) return null
        return { id: token.id as string, expiresAt, externalId: await tokens.resetExternalId(tx, token.id) }
      },
      (done) => done && { action: 'token.paired', targetId: done.id }
    ))
  if (!paired) {
    return reply.status(401).send(httpError(401, 'This code is unknown, expired or used already', 'PAIRING_CODE_INVALID'))
  }
  return { token: signBearer(req, paired.externalId, paired.expiresAt) }
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  if (!id) {
    return reply.status(404).send()
  }

  const token = await req.server['tokenManager'].retrieveTokenById(dataContext(req), id)
  if (!token) {
    return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Token not found' })
  }
  // Removed already: nothing changes, and the log keeps the one removal there was.
  if (token.deletedAt) return { ok: true }

  await governedToken(
    req,
    (tx) => req.server['tokenManager'].removeTokenById(tx, id),
    (removed) => (removed ? { action: 'token.deleted', targetId: id } : null)
  )
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

  // A field outside the list is dropped, whatever the body schema lets through: a project may
  // replace the schema, and the manager writes every key it is given.
  const body = req.data() || {}
  const data: Record<string, unknown> = {}
  for (const field of UPDATABLE) if (body[field] !== undefined) data[field] = body[field]
  if (data.roles !== undefined) data.roles = planeRoles(req, data.roles)
  if (grantsSovereignty(req, data.roles)) {
    return sovereignRefused(reply, isPlatformRoute(req) ? 'A token never carries system:admin' : 'Cannot assign the admin role to a token')
  }
  // The roles are kept as they became: a grant is the change an auditor looks for first.
  return await governedToken(
    req,
    (tx) => req.server['tokenManager'].updateTokenById(tx, token.id, data),
    (row) =>
      row && {
        action: 'token.updated',
        targetId: token.id,
        detail: { requested: fieldNames(data), ...(data.roles !== undefined ? { roles: row.roles } : {}) }
      }
  )
}

export async function block(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()
  const { reason } = req.data()

  if (!(await req.server['tokenManager'].retrieveTokenById(dataContext(req), id))?.id) return reply.status(404).send()
  await governedToken(
    req,
    (tx) => req.server['tokenManager'].blockTokenById(tx, id, reason),
    () => ({ action: 'token.blocked', targetId: id, detail: reason ? { reason: String(reason) } : null })
  )
  return { ok: true }
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  const { id } = req.parameters()

  if (!(await req.server['tokenManager'].retrieveTokenById(dataContext(req), id))?.id) return reply.status(404).send()
  await governedToken(
    req,
    (tx) => req.server['tokenManager'].unblockTokenById(tx, id),
    () => ({ action: 'token.unblocked', targetId: id })
  )
  return { ok: true }
}
