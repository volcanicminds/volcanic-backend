import { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, SettingManagement } from '../../../../types/global.js'
import { httpError } from '../../../util/httpError.js'
import { CONTROL_KEY, checkRule, deploymentRule, globalRule } from '../../../auth/accountCreation.js'

//
// The rule of F49 for every tenant, written by the platform: which modes a tenant may choose from,
// and which applies until its administrator chooses. Stored in the control container; without a
// stored rule the deployment's configuration applies, and removing the stored one goes back to it.
// The set of a single tenant is `config.account_creation` on its registry row (`PUT /tenants/:id`).
//
const settings = (req: FastifyRequest): SettingManagement => req.server['settingManager']

function unavailable(req: FastifyRequest, reply: FastifyReply): boolean {
  if (settings(req)?.isImplemented?.() && req.control) return false
  reply.status(503).send(httpError(503, 'Settings are not available in this build', 'SETTINGS_NOT_AVAILABLE'))
  return true
}

const shown = async (req: FastifyRequest) => {
  const { rule, from } = await globalRule(settings(req), req.control as ControlHandle)
  return { ...rule, from, deployment: deploymentRule() }
}

export async function get(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  return reply.send(await shown(req))
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  const verdict = checkRule(req.data())
  if (!verdict.ok)
    return reply
      .status(400)
      .send(httpError(400, `The rule is not valid: ${verdict.message}`, 'ACCOUNT_CREATION_INVALID'))
  await settings(req).set(req.control as ControlHandle, CONTROL_KEY, verdict.value, req.systemUser?.externalId ?? null)
  if (log.i)
    log.info(
      `Account creation for every tenant set to ${verdict.value.allowed.join(', ')} (default ${verdict.value.default})`
    )
  return reply.send(await shown(req))
}

export async function reset(req: FastifyRequest, reply: FastifyReply) {
  if (unavailable(req, reply)) return
  await settings(req).remove(req.control as ControlHandle, CONTROL_KEY)
  if (log.i) log.info('Account creation for every tenant back to the deployment rule')
  return reply.send(await shown(req))
}
