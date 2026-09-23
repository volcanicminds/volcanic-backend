/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { AuthInput, AuthManagers, AuthPlane, AuthReturnInput, ControlHandle } from '../../types/global.js'
import { httpError } from '../util/httpError.js'
import { controlPolicy, tenantPolicy } from '../util/mfaPolicy.js'
import { dataContext, isTenancyEnabled } from '../util/tenancy.js'
import { issueSession } from '../util/credential.js'
import { CONTROL_ROUTING } from '../util/session.js'
import { deliverFlow, forgetFlow, presentedFlow } from '../util/flowCredential.js'
import { recordAccess } from '../util/accessLog.js'
import { present } from '../api/system/controller/systemAuth.js'
import * as engine from './engine.js'
import type { FlowOutcome, FlowPlane } from './engine.js'
import { mayLogIn, roleCodes, toSubject } from './subjects.js'
import { accountCreationOf } from './accountCreation.js'

//
// The HTTP side of the flow routes (T-12.15, T-12.16): one controller, parameterised by plane.
//
// What differs between the planes is small and lives in `planeOf`: which container, which users,
// which policy, which claims the access token carries. Reading the credential, answering 202 or
// 200 and clearing the cookie are the same code for both, as the renewal is.
//

const MANAGERS: ReadonlyArray<keyof AuthManagers> = [
  'userManager',
  'systemUserManager',
  'mfaManager',
  'sessionManager',
  'authFlowManager',
  'externalIdentityManager',
  'identityProviderManager',
  'challengeDeliveryManager',
  'accessLogManager',
  'settingManager'
]

function managersOf(req: FastifyRequest): AuthManagers {
  const server = req.server as unknown as Record<string, unknown>
  return Object.fromEntries(MANAGERS.map((name) => [name, server[name]])) as unknown as AuthManagers
}

const userAgentOf = (req: FastifyRequest) => (req.headers['user-agent'] as string | undefined) ?? null

/** The plane of this request, or null once a 503 has been sent. */
function planeOf(req: FastifyRequest, reply: FastifyReply, plane: AuthPlane): FlowPlane<any> | null {
  const common = {
    flows: global.authFlows[plane],
    limits: global.authFlows.limits,
    registry: req.server.authRegistry,
    managers: managersOf(req),
    ip: req.ip ?? null,
    userAgent: userAgentOf(req)
  }

  if (plane === 'control') {
    const users = req.server.systemUserManager
    const control = req.control as ControlHandle | undefined
    if (!users?.isImplemented?.() || !control) {
      reply.status(503).send(httpError(503, 'Platform identities are not available in this build', 'SYSTEM_USERS_NOT_AVAILABLE'))
      return null
    }
    const policy = controlPolicy()
    return {
      ...common,
      plane,
      handle: control,
      tenant: null,
      routing: CONTROL_ROUTING,
      policy,
      loadSubject: async (externalId) => {
        const user = await users.retrieveSystemUserByExternalId(control, externalId)
        return user && !user.blocked ? { record: user, subject: toSubject('control', user) } : null
      },
      issue: async (user, _subject, methods) => {
        // The control plane has its own cookies and its own container, and the token names no tenant.
        const { token, refreshToken } = await issueSession(
          reply,
          'control',
          { sub: user.externalId, scp: 'control' },
          {
            ctx: control,
            manager: req.server.sessionManager,
            subjectId: user.externalId,
            scope: 'control',
            routing: CONTROL_ROUTING,
            ip: req.ip ?? null,
            userAgent: userAgentOf(req),
            authMethods: methods
          }
        )
        return { body: { ...present(user), token, refreshToken, securityPolicy: { mfaPolicy: policy } }, subjectId: user.externalId }
      },
      record: (entry) => recordAccess(req, control, { ...entry, scope: 'control' })
    }
  }

  const users = req.server.userManager
  if (!users?.isImplemented?.()) throw new Error('Not implemented')
  const handle = dataContext(req)
  // The policy of THIS tenant (T-10.19): the deployment value is the floor, a customer may only tighten it.
  const policy = tenantPolicy(req.tenantInfo)
  const routing = isTenancyEnabled() ? (req.tenantInfo?.id ?? CONTROL_ROUTING) : CONTROL_ROUTING
  return {
    ...common,
    plane,
    handle,
    tenant: req.tenantInfo ?? null,
    routing,
    policy,
    accountCreation: async () =>
      (await accountCreationOf({ settings: req.server.settingManager, control: req.control as ControlHandle, handle, tenant: req.tenantInfo })).mode,
    loadSubject: async (externalId) => {
      const user = await users.retrieveUserByExternalId(handle, externalId)
      if (!(await mayLogIn(users, user))) return null
      return { record: user, subject: toSubject('tenant', user) }
    },
    issue: async (user, _subject, methods) => {
      let current = user
      // Once, at the end of the flow, and only on the tenant plane (F45). The manager answers the
      // new identifier, not the row: the session is issued to the identifier that now exists.
      if (global.config?.options?.reset_external_id_on_login) {
        current = { ...user, externalId: await users.resetExternalId(handle, user.id) }
      }
      const { token, refreshToken } = await issueSession(
        reply,
        'tenant',
        { sub: current.externalId, tid: req.tenantInfo?.id },
        {
          ctx: handle,
          manager: req.server.sessionManager,
          subjectId: current.externalId,
          scope: 'tenant',
          routing,
          ip: req.ip ?? null,
          userAgent: userAgentOf(req),
          authMethods: methods
        }
      )
      const roles = roleCodes(current.roles, [global.roles?.public?.code || 'public'])
      return { body: { ...current, roles, token, refreshToken, securityPolicy: { mfaPolicy: policy } }, subjectId: current.externalId }
    },
    record: (entry) => recordAccess(req, handle, { ...entry, scope: 'tenant' })
  }
}

/** The fields a method receives: the body without the engine's own. Never the query string. */
function inputOf(req: FastifyRequest): { method: unknown; action: unknown; input: AuthInput } {
  const body = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>
  const { method, action, flow, ...input } = body
  void flow
  return { method, action, input }
}

function answer(reply: FastifyReply, plane: AuthPlane, outcome: FlowOutcome) {
  if (outcome.kind === 'complete') {
    forgetFlow(reply, plane)
    return reply.status(200).send(outcome.body)
  }
  if (outcome.kind === 'partial') {
    const flow = deliverFlow(reply, plane, outcome.credential, outcome.expiresAt)
    return reply.status(202).send({ flow, expiresAt: outcome.expiresAt.toISOString(), stage: outcome.stage })
  }
  if (outcome.kind === 'refused') {
    if (outcome.endsFlow) forgetFlow(reply, plane)
    const { status, code, message } = outcome.refusal
    const body = {
      ...httpError(status, message, code),
      ...(outcome.remaining !== undefined ? { remaining: outcome.remaining } : {}),
      ...(outcome.retryAt ? { retryAt: outcome.retryAt.toISOString() } : {})
    }
    return reply.status(status).send(body)
  }
  return reply.status(200).send({ ok: outcome.ok })
}

/** The six handlers of one plane, as the router loads them from a controller file. */
export function flowHandlers(plane: AuthPlane) {
  return {
    async options(req: FastifyRequest, reply: FastifyReply) {
      const p = planeOf(req, reply, plane)
      if (!p) return reply
      // The tenant plane also says whether a person may create an account here and how (F49), so a
      // client knows whether to show the registration and what to say after it.
      const accountCreation = p.accountCreation ? await p.accountCreation() : undefined
      return { options: engine.identifierOptions(p), ...(accountCreation ? { accountCreation } : {}) }
    },

    async start(req: FastifyRequest, reply: FastifyReply) {
      const p = planeOf(req, reply, plane)
      if (!p) return reply
      const { method, input } = inputOf(req)
      return answer(reply, plane, await engine.start(p, method, input))
    },

    async step(req: FastifyRequest, reply: FastifyReply) {
      const p = planeOf(req, reply, plane)
      if (!p) return reply
      const { method, action, input } = inputOf(req)
      return answer(reply, plane, await engine.step(p, presentedFlow(req, plane), method, input, action))
    },

    async challenge(req: FastifyRequest, reply: FastifyReply) {
      const p = planeOf(req, reply, plane)
      if (!p) return reply
      const { method, input } = inputOf(req)
      return answer(reply, plane, await engine.challenge(p, presentedFlow(req, plane), method, input))
    },

    async cancel(req: FastifyRequest, reply: FastifyReply) {
      const p = planeOf(req, reply, plane)
      if (!p) return reply
      await engine.cancel(p, presentedFlow(req, plane))
      forgetFlow(reply, plane)
      return { ok: true }
    },

    /**
     * A browser navigation back from a provider. It carries no credential and sets none; it answers
     * 303 to the plane's `returnUrl` with nothing in the URL, and the console resumes with `step`.
     */
    async returnFrom(req: FastifyRequest, reply: FastifyReply) {
      const p = planeOf(req, reply, plane)
      if (!p) return reply
      const { method } = (req.params ?? {}) as { method?: string }
      const query = (req.query && typeof req.query === 'object' ? req.query : {}) as Record<string, unknown>
      const input: AuthReturnInput = Object.fromEntries(Object.entries(query).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      const outcome = await engine.returnFrom(p, String(method ?? ''), input)
      if (outcome.kind === 'returned' && p.flows.returnUrl) return reply.redirect(p.flows.returnUrl, 303)
      return answer(reply, plane, outcome)
    }
  }
}
