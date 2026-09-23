/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify'
import type { ControlHandle, DataHandle, DataProvider } from '../../types/global.js'
import { isTenancyEnabled } from '../util/tenancy.js'

//
// The emergency reset of the administrator's second factor, at boot (docs/SECURITY_MFA.md).
//
// `MFA_ADMIN_FORCED_RESET_EMAIL` names the identity, `MFA_ADMIN_FORCED_RESET_UNTIL` a moment no
// more than ten minutes away: a window that closes by itself if nobody removes the variables.
//
// The identity is looked up where the genesis puts the apex (lib/loader/genesis.ts): with tenants
// declared the administrator of the deployment is a platform identity, a `system_user`, and the
// `user` table of the control container holds nobody who administers anything; without tenants it
// is a `user` of the control container. Looking in the other table would reset nobody, or someone
// who shares the address and is not the administrator.
//

/** How far ahead `UNTIL` may be: a reset armed for next week is a door left open. */
export const RESET_WINDOW_MINUTES = 10

export type EmergencyResetOutcome =
  | 'not-requested'
  | 'expired'
  | 'too-far'
  | 'invalid-date'
  | 'no-data-layer'
  | 'not-found'
  | 'reset'
  | 'failed'

export interface EmergencyResetOptions {
  env?: Readonly<Record<string, string | undefined>>
  now?: Date
  /** Called instead of process.exit(1) when the window is too far ahead (injected by tests). */
  onFatal?: (message: string) => void
}

export async function emergencyMfaReset(server: FastifyInstance, options: EmergencyResetOptions = {}): Promise<EmergencyResetOutcome> {
  const env = options.env ?? process.env
  const email = env.MFA_ADMIN_FORCED_RESET_EMAIL?.trim()
  const until = env.MFA_ADMIN_FORCED_RESET_UNTIL?.trim()
  if (!email || !until) return 'not-requested'

  const onFatal =
    options.onFatal ??
    ((message: string) => {
      if (log.f) log.fatal(message)
      process.exit(1)
    })

  const deadline = new Date(until)
  if (Number.isNaN(deadline.getTime())) {
    if (log.e) log.error('Startup: MFA_ADMIN_FORCED_RESET_UNTIL is not a date. Ignoring the reset.')
    return 'invalid-date'
  }
  const minutes = (deadline.getTime() - (options.now ?? new Date()).getTime()) / 60_000
  if (minutes < 0) {
    if (log.i) log.info('Startup: MFA admin reset window expired. Ignoring.')
    return 'expired'
  }
  if (minutes > RESET_WINDOW_MINUTES) {
    onFatal(`Startup Error: MFA_ADMIN_FORCED_RESET_UNTIL is too far in the future (>${RESET_WINDOW_MINUTES} min). Fix configuration.`)
    return 'too-far'
  }

  const managers = server as unknown as Record<string, any>
  const provider = managers['provider'] as DataProvider | undefined
  const platform = isTenancyEnabled()
  const users = platform ? managers['systemUserManager'] : managers['userManager']
  if (!provider || !users?.isImplemented?.()) {
    if (log.e) log.error('Startup: no data layer is loaded, cannot reset MFA')
    return 'no-data-layer'
  }

  if (log.w) log.warn(`Startup: executing FORCE MFA RESET for ${platform ? 'platform identity' : 'admin'} ${email}`)
  try {
    const ctx = await provider.control()
    const target = platform
      ? await users.retrieveSystemUserByEmail(ctx as ControlHandle, email)
      : await users.retrieveUserByEmail(ctx as DataHandle, email)
    if (!target?.id) {
      if (log.e) log.error(`Startup: MFA RESET FAILED, no ${platform ? 'platform identity' : 'user'} with address ${email}`)
      return 'not-found'
    }
    if (platform) await users.disableMfa(ctx as ControlHandle, target.id)
    else await users.forceDisableMfa(ctx as DataHandle, target.id)
    if (log.w) log.warn(`Startup: MFA RESET SUCCESSFUL for ${email}`)
    return 'reset'
  } catch (error) {
    if (log.e) log.error(`Startup: MFA RESET FAILED: ${(error as Error)?.message ?? String(error)}`)
    return 'failed'
  }
}
