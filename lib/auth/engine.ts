import type {
  AccessLogEntry,
  AuthContext,
  AuthFlow,
  AuthFlowLimits,
  AuthInput,
  AuthManagers,
  AuthPlane,
  AuthPlaneFlows,
  AuthResult,
  AuthReturnInput,
  AuthSubject,
  Authenticator,
  AuthenticatorRegistry,
  DataHandle,
  FlowChallenges,
  FlowRoundTrip,
  StageDescriptor,
  StageOption,
  Tenant
} from '../../types/global.js'
import type { MfaPolicy } from '../config/constants.js'
import { allowsEnrolment, demandsEnrolment } from '../util/mfaPolicy.js'
import { uuidv7 } from '../util/uuid.js'
import {
  composeFlowCredential,
  newFlowSecret,
  newFlowState,
  parseFlowCredential,
  parseFlowState,
  type FlowCredential
} from '../util/flowCredential.js'
import { kindsOf } from './registry.js'
import { ENROLMENT_METHOD } from './validate.js'

//
// The flow engine (T-12.14), one module for both planes as the renewal is.
//
// Pure with respect to HTTP: it is handed a plane (a handle, a policy, the flows, how to load a
// subject and how to open a session) and answers an outcome the controller turns into a response.
// Every step reads the flow row, re-validates the subject, recomputes the stages from the
// configuration and the policy of now, and moves the row with an optimistic `advance`: two steps
// racing each other have one winner, and a subject blocked between two factors meets the refusal
// at the next one.
//

/** What a controller hands the engine: one plane of one request. */
export interface FlowPlane<R = unknown> {
  readonly plane: AuthPlane
  readonly handle: DataHandle
  readonly tenant: Tenant | null
  /** The routing segment of this request's container: the tenant id, or `ctl`. */
  readonly routing: string
  readonly policy: MfaPolicy
  readonly flows: AuthPlaneFlows
  readonly limits: AuthFlowLimits
  readonly registry: AuthenticatorRegistry
  readonly managers: AuthManagers
  readonly ip: string | null
  readonly userAgent: string | null
  /** The subject by its `externalId`, or null when it may not log in: missing, invalid, unconfirmed, blocked, waiting. */
  loadSubject(externalId: string): Promise<{ record: R; subject: AuthSubject } | null>
  /** Opens the session, once, and answers the body of the 200 and the subject it was issued to. */
  issue(record: R, subject: AuthSubject, methods: string[]): Promise<{ body: Record<string, unknown>; subjectId: string }>
  /** Best effort: a failed write never fails a login. */
  record(entry: Omit<AccessLogEntry, 'scope'>): Promise<void>
  /** Who may create an account on this plane (F49); absent on the control plane, which has no registration. */
  accountCreation?: AuthContext['accountCreation']
  /** The identity providers of this plane and tenant, by key (F38). */
  provider?: AuthContext['provider']
}

export interface Refusal {
  status: number
  code: string
  message: string
}

/** Every refusal the engine answers with. An authenticator's own reason passes through as 401. */
export const REFUSALS = {
  AUTH_INVALID_CREDENTIALS: { status: 401, code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' },
  AUTH_INPUT_INVALID: { status: 400, code: 'AUTH_INPUT_INVALID', message: 'The identifier or the credential is malformed' },
  PASSWORD_TO_BE_CHANGED: { status: 403, code: 'PASSWORD_TO_BE_CHANGED', message: 'Password is expired' },
  FLOW_REQUIRED: { status: 401, code: 'FLOW_REQUIRED', message: 'No live authentication flow on this request' },
  FLOW_EXPIRED: { status: 401, code: 'FLOW_EXPIRED', message: 'The authentication flow has expired' },
  FLOW_METHOD_NOT_ALLOWED: { status: 403, code: 'FLOW_METHOD_NOT_ALLOWED', message: 'That method is not offered here' },
  FLOW_CODE_INVALID: { status: 401, code: 'FLOW_CODE_INVALID', message: 'The code is not valid' },
  FLOW_CODE_EXPIRED: { status: 401, code: 'FLOW_CODE_EXPIRED', message: 'The code has expired or was already used: ask for a new one' },
  FLOW_SEND_LIMIT: { status: 429, code: 'FLOW_SEND_LIMIT', message: 'No more codes can be sent for now' },
  FLOW_ATTEMPTS_EXHAUSTED: { status: 401, code: 'FLOW_ATTEMPTS_EXHAUSTED', message: 'Too many attempts: start again' },
  FLOW_ENROLMENT_REFUSED: { status: 403, code: 'FLOW_ENROLMENT_REFUSED', message: 'No second factor can be enrolled here' },
  AUTH_FLOW_NOT_AVAILABLE: { status: 503, code: 'AUTH_FLOW_NOT_AVAILABLE', message: 'This build keeps no authentication flows' },
  MFA_NOT_AVAILABLE: { status: 503, code: 'MFA_NOT_AVAILABLE', message: 'This build has no MFA manager' },
  TENANT_MISMATCH: { status: 403, code: 'TENANT_MISMATCH', message: 'The flow does not belong to this tenant' },
  IDP_UNKNOWN_PROVIDER: { status: 400, code: 'IDP_UNKNOWN_PROVIDER', message: 'No such identity provider here' },
  IDP_UNAVAILABLE: { status: 502, code: 'IDP_UNAVAILABLE', message: 'The identity provider cannot be reached' },
  IDP_RETURN_PENDING: { status: 409, code: 'IDP_RETURN_PENDING', message: 'The identity provider has not answered yet' },
  IDP_RETURN_INVALID: { status: 401, code: 'IDP_RETURN_INVALID', message: 'The answer of the identity provider is not valid' },
  IDP_DENIED: { status: 401, code: 'IDP_DENIED', message: 'The identity provider did not authenticate' },
  IDP_IDENTITY_NOT_LINKED: { status: 403, code: 'IDP_IDENTITY_NOT_LINKED', message: 'This identity is not linked to an account here' },
  ACCOUNT_PENDING_APPROVAL: { status: 403, code: 'ACCOUNT_PENDING_APPROVAL', message: 'The account awaits the approval of an administrator' }
} as const satisfies Record<string, Refusal>

type Known = keyof typeof REFUSALS

export type FlowOutcome =
  | { kind: 'complete'; body: Record<string, unknown> }
  | { kind: 'partial'; credential: FlowCredential; expiresAt: Date; stage: StageDescriptor }
  | { kind: 'refused'; refusal: Refusal; endsFlow: boolean; remaining?: number; retryAt?: Date | null }
  | { kind: 'returned'; ok: boolean; returnTo?: string }

const refuse = (code: string, endsFlow = false, remaining?: number, retryAt?: Date | string | null): FlowOutcome => ({
  kind: 'refused',
  refusal: REFUSALS[code as Known] ?? { status: 401, code, message: 'Authentication refused' },
  endsFlow,
  ...(remaining !== undefined ? { remaining } : {}),
  ...(retryAt ? { retryAt: asDate(retryAt) } : {})
})

/** Where a flow stands between two requests: who, which flow of the configuration, what is proven. */
interface Progress<R> {
  subject: AuthSubject
  record: R
  flowIndex: number
  satisfied: string[]
  identifiedBy: string
  flow: AuthFlow | null
  credential: FlowCredential | null
}

interface PlannedStage {
  anyOf: readonly string[]
  /** Added by the MFA floor for a subject with no factor: the stage is an enrolment. */
  enrolment: boolean
}

const unique = (ids: readonly string[]) => [...new Set(ids)]
const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value))

const storeOf = <R>(p: FlowPlane<R>) => p.managers.authFlowManager
const storeAvailable = <R>(p: FlowPlane<R>) => storeOf(p)?.isImplemented?.() === true

/**
 * The code operations of one flow, bound to the secret of the credential that reached it. The
 * authenticator gets the operations and not the secret: the secret keys the HMAC of every code, and
 * a method written by a consumer has no reason to hold it.
 */
function challengesOf<R>(p: FlowPlane<R>, flow: AuthFlow, secret: string): FlowChallenges {
  const store = storeOf(p)
  return {
    record: (data) => store.recordChallenge(p.handle, flow.flowId, { secret, ...data }),
    consume: (code) => store.consumeChallenge(p.handle, flow.flowId, { secret, code, maxAttempts: p.limits.otpMaxAttempts }),
    nominate: async (subjectId) => Boolean(await store.advance(p.handle, flow.flowId, flow.version, { candidateSubjectId: subjectId }))
  }
}

const context = <R>(p: FlowPlane<R>, subject: AuthSubject | null, flow: AuthFlow | null, secret?: string): AuthContext => ({
  plane: p.plane,
  handle: p.handle,
  tenant: p.tenant,
  subject,
  policy: p.policy,
  managers: p.managers,
  flow,
  limits: p.limits,
  challenges: flow && secret && storeAvailable(p) ? challengesOf(p, flow, secret) : null,
  accountCreation: p.accountCreation,
  provider: p.provider,
  roundTrip: flow && storeAvailable(p) ? roundTripOf(p, flow) : null,
  record: (entry) => p.record({ ...entry, flowId: flow?.flowId ?? null })
})

/**
 * The round trip of a flow (F39): the `state` carries the routing of this request's container, so
 * the return, which arrives with no credential and no header, finds its container; only the hash of
 * the secret part goes in the row, and the verifier and the nonce go in encrypted.
 */
function roundTripOf<R>(p: FlowPlane<R>, flow: AuthFlow): FlowRoundTrip {
  return {
    begin: async (external) => {
      const state = newFlowState(p.routing)
      return (await storeOf(p).bindExternal(p.handle, flow.flowId, { state: state.raw, external })) ? state.raw : null
    }
  }
}

/** An identifier of this plane that `identify` lists. */
function identifierOf<R>(p: FlowPlane<R>, method: unknown): Authenticator | null {
  if (typeof method !== 'string' || !p.flows.identify.includes(method)) return null
  const authenticator = p.registry.get(p.plane, method)
  return authenticator && kindsOf(authenticator).includes('identifier') ? authenticator : null
}

/** The first flow whose roles meet the subject's; `'*'` is last and meets everyone (F34). */
const chooseFlow = (flows: AuthPlaneFlows, roles: readonly string[]) =>
  flows.flows.findIndex((flow) => flow.roles.includes('*') || flow.roles.some((role) => roles.includes(role)))

async function enrolledIn(authenticator: Authenticator | undefined, ctx: AuthContext, subject: AuthSubject): Promise<boolean> {
  if (!authenticator) return false
  return authenticator.isEnrolled ? Boolean(await authenticator.isEnrolled(ctx, subject)) : true
}

const met = (stage: PlannedStage, satisfied: readonly string[]) => stage.anyOf.some((id) => satisfied.includes(id))

/** Every method a plane's configuration names, as an identifier or in a stage. */
function namedMethods(flows: AuthPlaneFlows): Set<string> {
  return new Set([...flows.identify, ...flows.flows.flatMap((flow) => flow.stages.flatMap((stage) => stage.anyOf))])
}

/**
 * The stages this subject owes, recomputed at every step from the configuration and the policy of
 * now. An optional stage applies to a subject enrolled in one of its methods. The MFA floor is the
 * engine's and not the configuration's (F35): under `MANDATORY` a flow that would close without a
 * second factor gets one, the subject's enrolled factors or, with none, an enrolment.
 */
async function planStages<R>(p: FlowPlane<R>, s: Progress<R>): Promise<PlannedStage[]> {
  const ctx = context(p, s.subject, s.flow)
  const stages: PlannedStage[] = []
  for (const stage of p.flows.flows[s.flowIndex]?.stages ?? []) {
    const planned = { anyOf: stage.anyOf, enrolment: false }
    if (!stage.optional || met(planned, s.satisfied)) {
      stages.push(planned)
      continue
    }
    for (const id of stage.anyOf) {
      if (await enrolledIn(p.registry.get(p.plane, id), ctx, s.subject)) {
        stages.push(planned)
        break
      }
    }
  }

  if (demandsEnrolment(p.policy)) {
    const secondFactor = s.satisfied.some((id) => id !== s.identifiedBy) || stages.some((stage) => !met(stage, s.satisfied))
    if (!secondFactor) {
      // The floor offers the factors this plane's configuration names, and TOTP, the one it can
      // enrol. Not every registered verifier: a built-in the deployment never listed may have no
      // port behind it (`email-otp` without a delivery), and the boot only checks what is listed.
      const named = namedMethods(p.flows)
      const factors: string[] = []
      for (const authenticator of p.registry.list(p.plane)) {
        if (authenticator.id === s.identifiedBy || !authenticator.isEnrolled || !kindsOf(authenticator).includes('verifier')) continue
        if (authenticator.id !== ENROLMENT_METHOD && !named.has(authenticator.id)) continue
        if (await authenticator.isEnrolled(ctx, s.subject)) factors.push(authenticator.id)
      }
      stages.push(factors.length ? { anyOf: factors, enrolment: false } : { anyOf: [ENROLMENT_METHOD], enrolment: true })
    }
  }
  return stages
}

/**
 * The methods a stage offers this subject. One it is not enrolled in is offered as an enrolment
 * only where the policy accepts new factors and the subject has none: the rule of the 409 of
 * T-12.1, applied inside the flow.
 */
async function stageOptions<R>(p: FlowPlane<R>, s: Progress<R>, stage: PlannedStage): Promise<StageOption[]> {
  const ctx = context(p, s.subject, s.flow)
  const options: StageOption[] = []
  for (const id of stage.anyOf) {
    const authenticator = p.registry.get(p.plane, id)
    if (!authenticator || !kindsOf(authenticator).includes('verifier')) continue
    if (!stage.enrolment && (await enrolledIn(authenticator, ctx, s.subject))) {
      options.push({ id, kind: 'verifier' })
    } else if (authenticator.enrol && allowsEnrolment(p.policy) && s.subject.factors.length === 0) {
      options.push({ id, kind: 'verifier', enrol: true })
    }
  }
  return options
}

/** The option as a partial answer shows it, after `initiate` or `verify` said what comes next. */
function optionAfter(option: StageOption, result: AuthResult): StageOption {
  if (result.outcome === 'challenge') return { ...option, challenge: result.challenge }
  if (result.outcome === 'redirect') {
    return {
      ...option,
      action: result.binding === 'post' ? { type: 'post', url: result.url, fields: result.fields } : { type: 'redirect', url: result.url }
    }
  }
  return option
}

function partial(credential: FlowCredential, flow: AuthFlow, options: StageOption[]): FlowOutcome {
  return { kind: 'partial', credential, expiresAt: asDate(flow.expiresAt), stage: { options } }
}

/** Retires the flow, when there is one, and says so to the log of accesses. */
async function end<R>(p: FlowPlane<R>, flow: AuthFlow | null, entry: Omit<AccessLogEntry, 'scope' | 'flowId'>): Promise<void> {
  if (flow) await storeOf(p).cancelFlow(p.handle, flow.flowId)
  await p.record({ ...entry, flowId: flow?.flowId ?? null })
}

async function refuseSubject<R>(p: FlowPlane<R>, flow: AuthFlow | null, subjectId: string | null, methods: string[]): Promise<FlowOutcome> {
  await end(p, flow, { event: 'login.failed', outcome: 'failure', code: 'AUTH_INVALID_CREDENTIALS', subjectId, methods })
  return refuse('AUTH_INVALID_CREDENTIALS', true)
}

async function openFlow<R>(p: FlowPlane<R>, subjectId: string | null, flowIndex: number | null) {
  const secret = newFlowSecret()
  const flow = await storeOf(p).openFlow(p.handle, {
    flowId: uuidv7(),
    scope: p.plane,
    secret,
    subjectId,
    flowName: flowIndex === null ? null : String(flowIndex),
    expiresAt: new Date(Date.now() + p.limits.flowTtl * 1000),
    ip: p.ip,
    userAgent: p.userAgent
  })
  return { flow, credential: composeFlowCredential(p.routing, flow.flowId, secret) }
}

/** Housekeeping on one start in fifty, as the sessions do: never at the expense of the login. */
async function maybePurge<R>(p: FlowPlane<R>): Promise<void> {
  if (!storeAvailable(p) || Math.random() >= 0.02) return
  try {
    const removed = await storeOf(p).purgeExpired(p.handle)
    if (removed && log.d) log.debug(`Auth flows: ${removed} dead rows purged`)
  } catch (error) {
    if (log.w) log.warn(`Auth flows: the opportunistic purge failed (${(error as Error)?.message})`)
  }
}

/** The next stage, or the session: the one place a flow ends in success. */
async function proceed<R>(p: FlowPlane<R>, s: Progress<R>): Promise<FlowOutcome> {
  const stages = await planStages(p, s)
  const current = stages.find((stage) => !met(stage, s.satisfied))
  if (!current) return await complete(p, s)

  const options = await stageOptions(p, s, current)
  if (!options.length) {
    await end(p, s.flow, { event: 'login.failed', outcome: 'failure', code: 'FLOW_ENROLMENT_REFUSED', subjectId: s.subject.externalId, methods: s.satisfied })
    return refuse('FLOW_ENROLMENT_REFUSED', true)
  }
  // F46: a second step with no memory would be a second step that counts no attempts.
  if (!storeAvailable(p)) return refuse('AUTH_FLOW_NOT_AVAILABLE')

  if (s.flow && s.credential) return partial(s.credential, s.flow, options)

  const opened = await openFlow(p, s.subject.externalId, s.flowIndex)
  const flow = await storeOf(p).advance(p.handle, opened.flow.flowId, opened.flow.version, { satisfied: s.satisfied, stageIndex: 0 })
  if (!flow) return refuse('FLOW_REQUIRED', true)
  await p.record({ event: 'flow.started', outcome: 'success', subjectId: s.subject.externalId, methods: s.satisfied, flowId: flow.flowId })
  return partial(opened.credential, flow, options)
}

async function complete<R>(p: FlowPlane<R>, s: Progress<R>): Promise<FlowOutcome> {
  // Spent before the session exists: a flow is good for one session, whatever happens next.
  if (s.flow && !(await storeOf(p).completeFlow(p.handle, s.flow.flowId))) return refuse('FLOW_REQUIRED', true)
  const { body, subjectId } = await p.issue(s.record, s.subject, s.satisfied)
  await p.record({ event: 'login.succeeded', outcome: 'success', subjectId, methods: s.satisfied, flowId: s.flow?.flowId ?? null })
  return { kind: 'complete', body }
}

type Located = { flow: AuthFlow; credential: FlowCredential }

async function identified<R>(p: FlowPlane<R>, method: string, result: AuthResult, located: Located | null): Promise<FlowOutcome> {
  const flow = located?.flow ?? null
  if (result.outcome === 'fail') {
    await end(p, flow, { event: 'login.failed', outcome: 'failure', code: result.reason, subjectId: null, methods: [method] })
    return refuse(result.reason, Boolean(flow))
  }
  if (result.outcome !== 'success') {
    if (!located) return refuse('AUTH_FLOW_NOT_AVAILABLE')
    return partial(located.credential, located.flow, [optionAfter({ id: method, kind: 'identifier' }, result)])
  }
  if (!result.subject) return await refuseSubject(p, flow, null, [method])

  // Loaded again rather than taken from the method: validity is the engine's question, asked the
  // same way at every step, and a method written by a consumer may not ask it at all.
  const loaded = await p.loadSubject(result.subject.externalId)
  if (!loaded) return await refuseSubject(p, flow, null, [method])

  const flowIndex = chooseFlow(p.flows, loaded.subject.roles)
  const allowed = p.flows.flows[flowIndex]?.identifiers
  if (flowIndex < 0 || (allowed && !allowed.includes(method))) {
    await end(p, flow, { event: 'login.failed', outcome: 'failure', code: 'FLOW_METHOD_NOT_ALLOWED', subjectId: loaded.subject.externalId, methods: [method] })
    return refuse('FLOW_METHOD_NOT_ALLOWED', Boolean(flow))
  }

  const satisfied = unique([method, ...(result.satisfied ?? [])])
  let proven: AuthFlow | null = null
  if (located) {
    // Proving the subject takes its slot: any other proven flow of it is evicted (F37).
    proven = await storeOf(p).advance(p.handle, located.flow.flowId, located.flow.version, {
      subjectId: loaded.subject.externalId,
      flowName: String(flowIndex),
      satisfied,
      stageIndex: 0
    })
    if (!proven) return refuse('FLOW_REQUIRED', true)
    await p.record({ event: 'stage.passed', outcome: 'success', subjectId: loaded.subject.externalId, methods: [method], flowId: proven.flowId })
  }

  return await proceed(p, {
    subject: loaded.subject,
    record: loaded.record,
    flowIndex,
    satisfied,
    identifiedBy: method,
    flow: proven,
    credential: located?.credential ?? null
  })
}

/** The flow a request presents, or the refusal that says why there is none. */
async function locate<R>(p: FlowPlane<R>, presented: string | undefined): Promise<Located | FlowOutcome> {
  const credential = parseFlowCredential(presented)
  if (!credential) return refuse('FLOW_REQUIRED', Boolean(presented))
  // The routing is addressing, like the refresh credential's: checked against the container this
  // request resolved, and never used to choose one (T-12.17).
  if (credential.routing !== p.routing) return refuse('TENANT_MISMATCH')
  if (!storeAvailable(p)) return refuse('AUTH_FLOW_NOT_AVAILABLE')

  const lookup = await storeOf(p).findBySecret(p.handle, credential.flowId, credential.secret)
  // A flow of the other plane is not a flow of this one, even where both live in one container.
  if (lookup.outcome === 'unknown' || lookup.flow.scope !== p.plane) return refuse('FLOW_REQUIRED', true)
  if (lookup.outcome === 'expired') {
    await p.record({ event: 'flow.expired', outcome: 'failure', code: 'FLOW_EXPIRED', subjectId: lookup.flow.subjectId, flowId: lookup.flow.flowId })
    return refuse('FLOW_EXPIRED', true)
  }
  return { flow: lookup.flow, credential }
}

const isOutcome = (value: Located | FlowOutcome): value is FlowOutcome => 'kind' in value

/** A proven flow as it stands: the subject re-validated, the stage it waits on and its options. */
async function standing<R>(p: FlowPlane<R>, located: Located) {
  const { flow, credential } = located
  const subjectId = flow.subjectId as string
  const loaded = await p.loadSubject(subjectId)
  if (!loaded) return await refuseSubject(p, flow, subjectId, flow.satisfied)

  const flowIndex = Number(flow.flowName)
  // The configuration changed under a live flow: it is not finished against rules nobody chose.
  if (!Number.isInteger(flowIndex) || !p.flows.flows[flowIndex]) {
    await end(p, flow, { event: 'login.failed', outcome: 'failure', code: 'FLOW_REQUIRED', subjectId, methods: flow.satisfied })
    return refuse('FLOW_REQUIRED', true)
  }

  const s: Progress<R> = {
    subject: loaded.subject,
    record: loaded.record,
    flowIndex,
    satisfied: [...flow.satisfied],
    identifiedBy: flow.satisfied[0] ?? '',
    flow,
    credential
  }
  const stages = await planStages(p, s)
  const current = stages.find((stage) => !met(stage, s.satisfied)) ?? null
  const options = current ? await stageOptions(p, s, current) : []
  return { s, current, options }
}

async function exhausted<R>(p: FlowPlane<R>, s: Progress<R>, method: string): Promise<FlowOutcome> {
  await end(p, s.flow, { event: 'flow.exhausted', outcome: 'failure', code: 'FLOW_ATTEMPTS_EXHAUSTED', subjectId: s.subject.externalId, methods: [method] })
  return refuse('FLOW_ATTEMPTS_EXHAUSTED', true)
}

//
// The five operations a controller calls.
//

/** The identifiers of the plane, without touching any row (F47). */
export function identifierOptions<R>(p: FlowPlane<R>): StageOption[] {
  return p.flows.identify.filter((id) => identifierOf(p, id)).map((id) => ({ id, kind: 'identifier' as const }))
}

export async function start<R>(p: FlowPlane<R>, method: unknown, input: AuthInput): Promise<FlowOutcome> {
  const authenticator = identifierOf(p, method)
  if (!authenticator) return refuse('FLOW_METHOD_NOT_ALLOWED')
  const id = authenticator.id
  await maybePurge(p)

  if (!authenticator.initiate) return await identified(p, id, await authenticator.verify(context(p, null, null), input), null)

  // A method that leaves the request (a code sent, a provider visited) needs the row from the
  // start. It is not proven yet, so it holds no subject's slot and evicts nobody (F37).
  if (!storeAvailable(p)) return refuse('AUTH_FLOW_NOT_AVAILABLE')
  const opened = await openFlow(p, null, null)
  await p.record({ event: 'flow.started', outcome: 'success', methods: [id], flowId: opened.flow.flowId })
  const result = await authenticator.initiate(context(p, null, opened.flow, opened.credential.secret), input)
  return await unproven(p, id, result, opened, 'challenge.refused')
}

/**
 * The answer of an identifier on a flow whose subject is not proven yet. A recoverable failure (a
 * wrong code with attempts left, an expired code, a send over a ceiling) leaves the flow alive; a
 * spent flow ends as exhausted; anything else goes to `identified`, which ends the flow on a failure.
 */
async function unproven<R>(
  p: FlowPlane<R>,
  method: string,
  result: AuthResult,
  located: Located,
  failure: 'stage.failed' | 'challenge.refused'
): Promise<FlowOutcome> {
  const { flow } = located
  if (result.outcome === 'challenge') {
    await p.record({ event: 'challenge.sent', outcome: 'success', subjectId: null, methods: [method], flowId: flow.flowId })
  }
  if (result.outcome !== 'fail') return await identified(p, method, result, located)
  if (result.reason === 'FLOW_ATTEMPTS_EXHAUSTED') {
    await end(p, flow, { event: 'flow.exhausted', outcome: 'failure', code: result.reason, subjectId: flow.candidateSubjectId, methods: [method] })
    return refuse(result.reason, true)
  }
  if (!result.recoverable) return await identified(p, method, result, located)
  await p.record({ event: failure, outcome: 'failure', code: result.reason, subjectId: null, methods: [method], flowId: flow.flowId })
  return refuse(result.reason, false, result.remaining, result.retryAt)
}

export async function step<R>(p: FlowPlane<R>, presented: string | undefined, method: unknown, input: AuthInput, action?: unknown): Promise<FlowOutcome> {
  const located = await locate(p, presented)
  if (isOutcome(located)) return located

  if (!located.flow.subjectId) {
    const authenticator = identifierOf(p, method)
    if (!authenticator) return refuse('FLOW_METHOD_NOT_ALLOWED')
    const result = await authenticator.verify(context(p, null, located.flow, located.credential.secret), input)
    return await unproven(p, authenticator.id, result, located, 'stage.failed')
  }

  const standingNow = await standing(p, located)
  if ('kind' in standingNow) return standingNow
  const { s, current, options } = standingNow
  if (!current) return await complete(p, s)

  const option = options.find((o) => o.id === method)
  const authenticator = option && p.registry.get(p.plane, option.id)
  if (!option || !authenticator) return refuse('FLOW_METHOD_NOT_ALLOWED')
  const flow = located.flow
  const ctx = context(p, s.subject, flow, located.credential.secret)

  if (action === 'enrol') {
    if (!option.enrol || !authenticator.enrol) return refuse('FLOW_ENROLMENT_REFUSED')
    // Generated here and kept in the row, encrypted by the store: the only response that ever
    // carries it is this one.
    const setup = await authenticator.enrol(ctx, s.subject)
    const bound = await storeOf(p).bindExternal(p.handle, flow.flowId, { external: { ...(flow.external ?? {}), enrolmentSecret: setup.secret } })
    if (!bound) return refuse('FLOW_EXPIRED', true)
    return partial(located.credential, flow, options.map((o) => (o.id === option.id ? { ...o, enrol: setup } : o)))
  }
  if (option.enrol && !flow.external?.enrolmentSecret) return refuse('FLOW_METHOD_NOT_ALLOWED')

  // A method whose code the store does not check itself spends an attempt before it is tested:
  // a burst of parallel guesses meets the ceiling instead of racing past it.
  let remaining: number | undefined
  if (!authenticator.initiate) {
    const reserved = await storeOf(p).recordAttempt(p.handle, flow.flowId, { secret: located.credential.secret, maxAttempts: p.limits.otpMaxAttempts })
    if (reserved.outcome === 'exhausted') return await exhausted(p, s, option.id)
    remaining = reserved.remaining
  }

  const result = await authenticator.verify(ctx, input)
  if (result.outcome === 'fail') {
    await p.record({ event: 'stage.failed', outcome: 'failure', code: result.reason, subjectId: s.subject.externalId, methods: [option.id], flowId: flow.flowId })
    // The engine's own count for a method it reserved an attempt for, the method's for one that
    // counts in the store itself (a sent code).
    const left = remaining ?? result.remaining
    if (result.reason === 'FLOW_ATTEMPTS_EXHAUSTED' || left === 0) return await exhausted(p, s, option.id)
    return refuse(result.reason, false, left, result.retryAt)
  }
  if (result.outcome !== 'success') return partial(located.credential, flow, options.map((o) => (o.id === option.id ? optionAfter(o, result) : o)))

  await p.record({ event: 'stage.passed', outcome: 'success', subjectId: s.subject.externalId, methods: [option.id], flowId: flow.flowId })
  if (option.enrol) await p.record({ event: 'mfa.enrolled', outcome: 'success', subjectId: s.subject.externalId, methods: [option.id], flowId: flow.flowId })

  const satisfied = unique([...s.satisfied, option.id, ...(result.satisfied ?? [])])
  const advanced = await storeOf(p).advance(p.handle, flow.flowId, flow.version, { satisfied, stageIndex: flow.stageIndex + 1 })
  if (!advanced) return refuse('FLOW_REQUIRED', true)

  // After every factor, not only after the first: the subject may have been blocked meanwhile,
  // and an enrolment has just changed its factors.
  const fresh = await p.loadSubject(s.subject.externalId)
  if (!fresh) return await refuseSubject(p, advanced, s.subject.externalId, satisfied)
  return await proceed(p, { ...s, subject: fresh.subject, record: fresh.record, satisfied, flow: advanced })
}

/** Sends, or sends again, the code of a method of the current stage. */
export async function challenge<R>(p: FlowPlane<R>, presented: string | undefined, method: unknown, input: AuthInput): Promise<FlowOutcome> {
  const located = await locate(p, presented)
  if (isOutcome(located)) return located

  if (!located.flow.subjectId) {
    const authenticator = identifierOf(p, method)
    if (!authenticator?.initiate) return refuse('FLOW_METHOD_NOT_ALLOWED')
    const result = await authenticator.initiate(context(p, null, located.flow, located.credential.secret), input)
    return await unproven(p, authenticator.id, result, located, 'challenge.refused')
  }

  const standingNow = await standing(p, located)
  if ('kind' in standingNow) return standingNow
  const { s, options } = standingNow
  const option = options.find((o) => o.id === method)
  const authenticator = option && p.registry.get(p.plane, option.id)
  if (!option || !authenticator?.initiate) return refuse('FLOW_METHOD_NOT_ALLOWED')

  const result = await authenticator.initiate(context(p, s.subject, located.flow, located.credential.secret), input)
  if (result.outcome === 'fail') {
    await p.record({ event: 'challenge.refused', outcome: 'failure', code: result.reason, subjectId: s.subject.externalId, methods: [option.id], flowId: located.flow.flowId })
    return refuse(result.reason, false, result.remaining, result.retryAt)
  }
  if (result.outcome === 'challenge') {
    await p.record({ event: 'challenge.sent', outcome: 'success', subjectId: s.subject.externalId, methods: [option.id], flowId: located.flow.flowId })
  }
  return partial(located.credential, located.flow, options.map((o) => (o.id === option.id ? optionAfter(o, result) : o)))
}

/** Idempotent, and silent about whether there was anything to cancel. */
export async function cancel<R>(p: FlowPlane<R>, presented: string | undefined): Promise<void> {
  const credential = parseFlowCredential(presented)
  if (!credential || credential.routing !== p.routing || !storeAvailable(p)) return
  const lookup = await storeOf(p).findBySecret(p.handle, credential.flowId, credential.secret)
  if (lookup.outcome === 'current' && lookup.flow.scope === p.plane) await storeOf(p).cancelFlow(p.handle, lookup.flow.flowId)
}

/**
 * A return from outside (F39). It records what the method validated and issues nothing: the flow
 * credential, which only the browser that started the flow holds, cashes it with the next step.
 * A login CSRF therefore lands in the attacker's own row.
 */
export async function returnFrom<R>(p: FlowPlane<R>, method: string, input: AuthReturnInput): Promise<FlowOutcome> {
  const authenticator = p.registry.get(p.plane, method)
  if (!authenticator?.complete) return refuse('FLOW_METHOD_NOT_ALLOWED')
  if (!storeAvailable(p)) return refuse('AUTH_FLOW_NOT_AVAILABLE')

  const state = parseFlowState(input[authenticator.stateParam ?? 'state'])
  if (!state) return refuse('FLOW_REQUIRED')
  if (state.routing !== p.routing) return refuse('TENANT_MISMATCH')
  const flow = await storeOf(p).findByState(p.handle, state.raw)
  if (!flow || flow.scope !== p.plane) return refuse('FLOW_REQUIRED')

  const subject = flow.subjectId ? ((await p.loadSubject(flow.subjectId))?.subject ?? null) : null
  const result = await authenticator.complete(context(p, subject, flow), input)
  // Where the client asked to land, kept as a path when the flow started; the failure lands there too,
  // and the next step says what went wrong.
  const returnTo = flow.external?.returnTo
  const back = (ok: boolean): FlowOutcome => ({ kind: 'returned', ok, ...(returnTo ? { returnTo } : {}) })
  if (result.outcome === 'success' && result.external && (await storeOf(p).recordExternalResult(p.handle, flow.flowId, result.external))) {
    return back(true)
  }
  const code = result.outcome === 'fail' ? result.reason : 'FLOW_REQUIRED'
  await end(p, flow, { event: 'stage.failed', outcome: 'failure', code, subjectId: flow.subjectId, methods: [method] })
  return back(false)
}
