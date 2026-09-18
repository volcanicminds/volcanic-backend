//
// The anti-replay counter of a TOTP verification.
//
// A verifier answers with a DELTA: how many time steps away from now the code it accepted was,
// which is zero for a code typed in its own window. A delta is not a position in time, and
// storing one as if it were is how an anti-replay check turns into a lock.
//
// That is what happened on the control plane (found by running it, T-10.20): `mfa_last_used_counter`
// held the delta, so the first successful verification wrote `0`, and every later code, being also
// a delta of `0`, failed `counter <= last` and answered «That code has already been used». A
// platform operator with a second factor could enrol once and never log in again. The tenant plane
// did the conversion inline and was fine, which is exactly how two copies of one rule drift: the
// copy nobody exercised is the one that is wrong.
//
// So the conversion lives here, once, and both planes call it.
//

/** TOTP period in seconds. Must match the one the MFA manager uses (tools default: 30). */
export const TOTP_PERIOD_SECONDS = 30

/** The time step the clock is in right now. */
export function currentStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS)
}

/**
 * Normalizes what a manager's `verify` returned into a validity and an ABSOLUTE step.
 *
 * - A number is a delta: the step consumed is `currentStep + delta`.
 * - `null` and `false` are an invalid code.
 * - `true` is a legacy manager that validates without saying which step it matched, so there is
 *   nothing to write down and replay protection cannot apply to it. Saying so with `null` is
 *   honest; writing `0` would be the defect above.
 */
export function absoluteStep(result: number | boolean | null | undefined): { valid: boolean; counter: number | null } {
  if (result === null || result === undefined || result === false) return { valid: false, counter: null }
  if (typeof result === 'number') return { valid: true, counter: currentStep() + result }
  return { valid: true, counter: null }
}

/** True when this step was already spent: the same code presented a second time. */
export function isReplay(counter: number | null, lastUsed: number | null | undefined): boolean {
  if (counter === null || lastUsed === null || lastUsed === undefined) return false
  return counter <= Number(lastUsed)
}
