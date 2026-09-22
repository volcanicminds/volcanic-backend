import crypto from 'crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { clearFlowCookie, flowCookieOf, isCookieMode, setFlowCookie, type Plane } from './credential.js'
import { newSessionSecret } from './session.js'

//
// The flow credential and the return `state` (F36, F39, T-12.13).
//
// `vf1.<routing>.<flowId>.<secret>` names one flow row; `st1.<routing>.<secret>` names the same row
// from outside, for a return that arrives without the credential. In both only the secret is a
// credential: the routing segment chooses the container, as the refresh credential's does, and the
// row found there is what decides anything. Neither is a JWT, so the authentication hook, which
// only verifies signatures, never takes one for a session.
//
export const FLOW_CREDENTIAL_VERSION = 'vf1'
export const FLOW_STATE_VERSION = 'st1'

export interface FlowCredential {
  routing: string
  flowId: string
  secret: string
  raw: string
}

export interface FlowState {
  routing: string
  secret: string
  raw: string
}

const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/

export function composeFlowCredential(routing: string, flowId: string, secret: string): FlowCredential {
  return { routing, flowId, secret, raw: [FLOW_CREDENTIAL_VERSION, routing, flowId, secret].join('.') }
}

/** Null for anything that is not four well-formed segments: a stranger chose this string. */
export function parseFlowCredential(raw: unknown): FlowCredential | null {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > 512) return null
  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [version, routing, flowId, secret] = parts
  if (version !== FLOW_CREDENTIAL_VERSION) return null
  if (!SEGMENT.test(routing) || !SEGMENT.test(flowId) || !SEGMENT.test(secret)) return null
  return { routing, flowId, secret, raw }
}

/**
 * A fresh `state`: 128 bits of secret, so that with a UUID routing it stays under the 80 bytes
 * SAML allows `RelayState`, and the method deferred to a later phase can use the same format.
 */
export function newFlowState(routing: string): FlowState {
  const secret = crypto.randomBytes(16).toString('base64url')
  return { routing, secret, raw: [FLOW_STATE_VERSION, routing, secret].join('.') }
}

export function parseFlowState(raw: unknown): FlowState | null {
  if (typeof raw !== 'string' || raw.length < 8 || raw.length > 256) return null
  const parts = raw.split('.')
  if (parts.length !== 3) return null
  const [version, routing, secret] = parts
  if (version !== FLOW_STATE_VERSION || !SEGMENT.test(routing) || !SEGMENT.test(secret)) return null
  return { routing, secret, raw }
}

/** The secret of a new flow: the same 32 bytes from the CSPRNG as a session's. */
export const newFlowSecret = newSessionSecret

/**
 * The credential of this request: the plane's cookie in cookie mode, the body's `flow` in bearer
 * mode, and never the other channel nor the `Authorization` header, which the tenant resolution
 * and the authentication hook both read.
 */
export function presentedFlow(req: FastifyRequest, plane: Plane): string | undefined {
  if (isCookieMode()) return flowCookieOf(req, plane)
  const body = req.body as { flow?: unknown } | undefined
  return typeof body?.flow === 'string' ? body.flow : undefined
}

/** Hands a credential over: in the cookie, answering `null`, or in the body. */
export function deliverFlow(reply: FastifyReply, plane: Plane, credential: FlowCredential, expiresAt: Date): string | null {
  if (!isCookieMode()) return credential.raw
  setFlowCookie(reply, plane, credential.raw, (expiresAt.getTime() - Date.now()) / 1000)
  return null
}

export function forgetFlow(reply: FastifyReply, plane: Plane): void {
  clearFlowCookie(reply, plane)
}
