import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, SettingManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import { dataContext } from '../../../util/tenancy.js'
import { TENANT_KEY, accountCreationOf, isMode } from '../../../auth/accountCreation.js'

const settings = (req: FastifyRequest): SettingManagement => req.server['settingManager']

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (settings(req)?.isImplemented?.()) return false
  reply.status(503).send(httpError(503, 'Settings are not available in this build', 'SETTINGS_NOT_AVAILABLE'))
  return true
}

const accountCreation = (req: FastifyRequest) =>
  accountCreationOf({
    settings: settings(req),
    control: req.control as ControlHandle,
    handle: dataContext(req),
    tenant: req.tenantInfo
  })

export async function getAccountCreation(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  return reply.send(await accountCreation(req))
}

/**
 * The tenant's choice (F49). A mode outside the set is refused when it is written rather than
 * stored and overridden when it is read: an administrator who reads back what they saved must be
 * reading what applies. The set can still shrink later, and then the state says so: `choice` stays,
 * `mode` moves.
 */
export async function setAccountCreation(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const { mode } = req.data()
  if (!isMode(mode))
    return reply.status(400).send(httpError(400, 'Write one of invite, approval, open', 'ACCOUNT_CREATION_INVALID'))
  const state = await accountCreation(req)
  if (!state.allowed.includes(mode)) {
    return reply
      .status(403)
      .send(
        httpError(403, `The platform allows this tenant ${state.allowed.join(', ')}`, 'ACCOUNT_CREATION_NOT_ALLOWED')
      )
  }
  await settings(req).set(dataContext(req), TENANT_KEY, mode, req.user?.externalId ?? null)
  return reply.send(await accountCreation(req))
}
