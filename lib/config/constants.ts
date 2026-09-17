export enum MfaPolicy {
  /**
   * No new enrolments (T-10.19). Whoever already has a second factor keeps being asked for it,
   * and only a reset by an administrator takes it away: flipping a switch must not lower the
   * protection of the accounts that had it.
   */
  OFF = 'OFF',
  OPTIONAL = 'OPTIONAL',
  MANDATORY = 'MANDATORY',
  ONE_WAY = 'ONE_WAY'
}

/**
 * Code the user manager puts on the error it raises when a registration collides with an
 * account that already exists.
 *
 * A string literal and not a shared symbol on purpose: the data layer raises it and the core
 * reads it, and the boundary checked in CI keeps the two from importing each other's runtime
 * values, so there is nowhere a shared module could live that both may reach.
 * `lib/database/managers/user.ts` carries the same literal with a pointer back here.
 */
export const EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED'
