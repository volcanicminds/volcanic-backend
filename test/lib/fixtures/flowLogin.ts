/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The login of v5, for the specs that need a session and are not about the login (T-12.34).
//
// `/auth/login` and `/system/auth/login` are gone: a session is what `POST /auth/flow/start` with
// `method: 'password'` answers when nothing else is owed. What the flow handlers read besides the
// managers is set up here, as `start()` would: the resolved flows and the authenticator registry.
//
import frameworkFlows from '../../../lib/config/authFlows.js'
import { resolveAuthFlows } from '../../../lib/loader/authFlows.js'
import { buildAuthenticatorRegistry } from '../../../lib/auth/registry.js'
import { start as tenantStart } from '../../../lib/api/auth/controller/flow.js'
import { start as controlStart } from '../../../lib/api/system/controller/systemFlow.js'

export { tenantStart, controlStart }

/** Sets the framework's own flows, and answers the function that puts back what was there. */
export function useFrameworkFlows(): () => void {
  const bag = globalThis as any
  const saved = bag.authFlows
  bag.authFlows = resolveAuthFlows(frameworkFlows)
  return () => {
    bag.authFlows = saved
  }
}

/** The registry the flow handlers read from the server. */
export const decorateAuthRegistry = (server: any) => server.decorate('authRegistry', buildAuthenticatorRegistry())

/** The body of a password login. */
export const passwordLogin = (email: string, password = 'pw') => ({ method: 'password', email, password })
