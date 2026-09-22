import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, ExternalIdentityManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import { dataContext } from '../../../util/tenancy.js'
import { recordTenantAccess } from '../../../util/accessLog.js'
import { PROVIDER_KEY, resolveProvider } from '../../../auth/providers.js'

//
// External identities of a user, managed by the tenant's administrator (T-12.27, F40): the third
// way a link is born, next to linking by email and provisioning just in time.
//
const links = (req: FastifyRequest): ExternalIdentityManagement => req.server['externalIdentityManager']

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (links(req)?.isImplemented?.()) return false
  reply.status(404).send(httpError(404, 'This build keeps no external identities', 'NOT_FOUND'))
  return true
}

/** The user the path names, by its row id, or null once a 404 has been sent. */
async function target(req: FastifyRequest, reply: FastifyReply): Promise<{ externalId: string } | null> {
  const { id } = req.params as { id: string }
  const user = await req.server['userManager'].retrieveUserById(dataContext(req), String(id))
  if (!user?.externalId) {
    reply.status(404).send(httpError(404, 'User not found', 'NOT_FOUND'))
    return null
  }
  return { externalId: String(user.externalId) }
}

export async function list(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const user = await target(req, reply)
  if (!user) return
  return reply.send(await links(req).listOfSubject(dataContext(req), user.externalId, 'tenant'))
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const user = await target(req, reply)
  if (!user) return
  const { provider, issuer, subject } = req.body as { provider: string; issuer: string; subject: string }

  // A link to a provider this tenant cannot log in with is a row nobody can ever use.
  const known =
    PROVIDER_KEY.test(provider) &&
    (await resolveProvider({
      plane: 'tenant',
      key: provider,
      flows: global.authFlows,
      tenantId: req.tenantInfo?.id ?? null,
      control: (req.control as ControlHandle | undefined) ?? null,
      identityProviders: req.server['identityProviderManager']
    }))
  if (!known) return reply.status(400).send(httpError(400, `No provider '${provider}' is available to this tenant`, 'IDP_UNKNOWN_PROVIDER'))

  const key = { scope: 'tenant' as const, provider, issuer: String(issuer).trim(), subject: String(subject).trim() }
  if (await links(req).findLink(dataContext(req), key)) {
    // Taken by this user or by another: either way a second row would make one identity two people.
    return reply.status(409).send(httpError(409, 'This identity is already linked', 'IDP_LINK_TAKEN'))
  }
  const created = await links(req).createLink(dataContext(req), { ...key, subjectId: user.externalId, emailAtLink: null })
  await recordTenantAccess(req, { event: 'idp.linked', outcome: 'success', subjectId: user.externalId, provider })
  return reply.status(201).send(created)
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const user = await target(req, reply)
  if (!user) return
  const { linkId } = req.params as { linkId: string }
  const link = (await links(req).listOfSubject(dataContext(req), user.externalId, 'tenant')).find((row) => row.id === linkId)
  if (!link || !(await links(req).removeLink(dataContext(req), linkId, user.externalId))) {
    return reply.status(404).send(httpError(404, 'Not found', 'NOT_FOUND'))
  }
  await recordTenantAccess(req, { event: 'idp.unlinked', outcome: 'success', subjectId: user.externalId, provider: link.provider })
  return reply.send({ ok: true })
}
