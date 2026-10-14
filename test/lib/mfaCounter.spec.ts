/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The anti-replay counter of a TOTP verification.
//
// A verifier answers with a DELTA, how far from now the accepted code was, which is zero for a
// code typed in its own window. Stored as if it were a position in time, that delta makes the
// first successful verification write `0` and every later code, also a delta of zero, fail
// `counter <= last`: an operator who enrolled a second factor could never log in again.
//
// These tests hold the converted form, because that is the property: what gets written down is a
// position in time, comparable with the next one.
//
import { expect } from 'expect'
import { absoluteStep, currentStep, isReplay, TOTP_PERIOD_SECONDS } from '../../lib/util/mfaCounter.js'

describe('mfa · the anti-replay counter is a step, not a delta (T-10.20)', () => {
  it('turns the delta of a code typed in its own window into the step it belongs to', () => {
    const { valid, counter } = absoluteStep(0)
    expect(valid).toBe(true)
    // The delta would be 0 here: what is stored is the current step.
    expect(counter).toBe(currentStep())
    expect(counter).toBeGreaterThan(1_000_000)
  })

  it('places a code from the window before and the window after where they belong', () => {
    expect(absoluteStep(-1).counter).toBe(currentStep() - 1)
    expect(absoluteStep(1).counter).toBe(currentStep() + 1)
  })

  it('reads an invalid code as invalid, whichever shape the manager answers with', () => {
    for (const bad of [null, undefined, false]) {
      expect(absoluteStep(bad as any)).toEqual({ valid: false, counter: null })
    }
  })

  it('accepts a legacy manager that only says yes, and writes nothing down for it', () => {
    // `true` carries no step, so there is nothing to compare a later code against. Saying so with
    // null is honest; writing 0 is what locked the operator out.
    expect(absoluteStep(true)).toEqual({ valid: true, counter: null })
  })

  it('calls a code a replay only when its step was already spent', () => {
    const step = currentStep()
    expect(isReplay(step, step)).toBe(true)
    expect(isReplay(step - 1, step)).toBe(true)
    expect(isReplay(step + 1, step)).toBe(false)
    // Nothing recorded yet, and a manager that reports no step, are both "not a replay".
    expect(isReplay(step, null)).toBe(false)
    expect(isReplay(null, step)).toBe(false)
  })

  it('keeps a step exactly one period wide, which is what makes the comparison mean anything', () => {
    // Measured from the START of a step, or the second assertion would depend on when the test
    // happens to run: a second before a boundary, "one period minus a second later" is already
    // the next step.
    const start = currentStep() * TOTP_PERIOD_SECONDS * 1000
    expect(currentStep(start + TOTP_PERIOD_SECONDS * 1000)).toBe(currentStep(start) + 1)
    expect(currentStep(start + (TOTP_PERIOD_SECONDS - 1) * 1000)).toBe(currentStep(start))
  })
})
