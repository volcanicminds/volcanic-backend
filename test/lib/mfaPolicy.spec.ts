/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-10.19: the second factor, plane by plane and tenant by tenant.
//
// One value for the whole deployment was a floor nobody could raise, and the control plane read
// none at all: `MANDATORY` obliged the users of every customer and none of the operators who can
// destroy a customer. These tests pin the three levels and the rule that keeps them honest, the
// floor a tenant may only tighten, because a policy that can be loosened from below is not one.
//
import { expect } from 'expect'
import { MfaPolicy } from '../../lib/config/constants.js'
import {
  allowsEnrolment,
  allowsSelfDisable,
  assertPolicies,
  checkTenantPolicy,
  controlPolicy,
  floorPolicy,
  mfaAvailable,
  parsePolicy,
  tenantPolicy,
  unavailableMandatory
} from '../../lib/util/mfaPolicy.js'

/** The options the framework reads, swapped in for one assertion and put back afterwards. */
function withOptions<T>(options: Record<string, unknown>, run: () => T): T {
  const saved = (global as any).config
  ;(global as any).config = { options }
  try {
    return run()
  } finally {
    ;(global as any).config = saved
  }
}

describe('MFA policy · the three levels (T-10.19)', () => {
  it('reads the four policies, whatever the case they were written in, and nothing else', () => {
    expect(parsePolicy('mandatory')).toBe(MfaPolicy.MANDATORY)
    expect(parsePolicy(' Off ')).toBe(MfaPolicy.OFF)
    expect(parsePolicy('sometimes')).toBeUndefined()
    expect(parsePolicy(undefined)).toBeUndefined()
  })

  it('takes the deployment value as the floor, and OPTIONAL when nobody wrote one', () => {
    expect(withOptions({}, floorPolicy)).toBe(MfaPolicy.OPTIONAL)
    expect(withOptions({ mfa_policy: 'ONE_WAY' }, floorPolicy)).toBe(MfaPolicy.ONE_WAY)
  })

  it('lets the control plane tighten the floor, and refuses to let it loosen', () => {
    // The operators are the ones who can destroy a container: their plane may ask for more.
    expect(withOptions({ mfa_policy: 'OPTIONAL', system_mfa_policy: 'MANDATORY' }, controlPolicy)).toBe(MfaPolicy.MANDATORY)
    // And a weaker value read here does not lower what the deployment already requires.
    expect(withOptions({ mfa_policy: 'MANDATORY', system_mfa_policy: 'OPTIONAL' }, controlPolicy)).toBe(MfaPolicy.MANDATORY)
    expect(withOptions({ mfa_policy: 'ONE_WAY' }, controlPolicy)).toBe(MfaPolicy.ONE_WAY)
  })

  it('reads a tenant policy from its registry row, still under the floor', () => {
    const acme = { config: { mfa_policy: 'MANDATORY' } }
    const globex = { config: { mfa_policy: 'OFF' } }

    expect(withOptions({ mfa_policy: 'OPTIONAL' }, () => tenantPolicy(acme))).toBe(MfaPolicy.MANDATORY)
    expect(withOptions({ mfa_policy: 'ONE_WAY' }, () => tenantPolicy(globex))).toBe(MfaPolicy.ONE_WAY)
    expect(withOptions({ mfa_policy: 'ONE_WAY' }, () => tenantPolicy(null))).toBe(MfaPolicy.ONE_WAY)
  })

  it('refuses a tenant policy weaker than the floor when it is written, not when it is read', () => {
    const verdict = withOptions({ mfa_policy: 'MANDATORY' }, () => checkTenantPolicy('OPTIONAL'))
    expect(verdict.ok).toBe(false)
    expect((verdict as any).code).toBe('MFA_POLICY_WEAKER')

    const tighter = withOptions({ mfa_policy: 'OPTIONAL' }, () => checkTenantPolicy('MANDATORY'))
    expect(tighter).toEqual({ ok: true, policy: MfaPolicy.MANDATORY })
    // Saying nothing is allowed: the tenant then follows the floor.
    expect(withOptions({ mfa_policy: 'OPTIONAL' }, () => checkTenantPolicy(undefined))).toEqual({ ok: true })
  })

  it('refuses a value that is not a policy at all, with a code of its own', () => {
    const verdict = withOptions({ mfa_policy: 'OPTIONAL' }, () => checkTenantPolicy('yes please'))
    expect(verdict.ok).toBe(false)
    expect((verdict as any).code).toBe('MFA_POLICY_INVALID')
  })

  it('closes enrolment under OFF, and leaves a factor already enrolled alone', () => {
    expect(allowsEnrolment(MfaPolicy.OFF)).toBe(false)
    for (const policy of [MfaPolicy.OPTIONAL, MfaPolicy.ONE_WAY, MfaPolicy.MANDATORY]) {
      expect(allowsEnrolment(policy)).toBe(true)
    }
    // Only where the factor is optional may its owner remove it: under OFF the way out is a reset.
    expect(allowsSelfDisable(MfaPolicy.OPTIONAL)).toBe(true)
    for (const policy of [MfaPolicy.OFF, MfaPolicy.ONE_WAY, MfaPolicy.MANDATORY]) {
      expect(allowsSelfDisable(policy)).toBe(false)
    }
  })

  it('refuses a new enrolment under OFF, with a code a console can act on', async () => {
    // The route the platform console calls to start an enrolment. Under OFF it must refuse before
    // touching the MFA manager, and say so with a code, not with prose.
    const { mfaSetup } = await import('../../lib/api/system/controller/systemAuth.js')
    const answers: any[] = []
    const reply: any = {
      status(code: number) {
        answers.push({ code })
        return this
      },
      send(body: any) {
        answers[answers.length - 1].body = body
        return this
      }
    }
    const req: any = {
      server: { systemUserManager: { isImplemented: () => true } },
      control: {},
      systemUser: { id: 'sys-1', email: 'operator@system.test' },
      data: () => ({})
    }

    const saved = (global as any).config
    ;(global as any).config = { options: { mfa_policy: 'OFF' } }
    try {
      await mfaSetup(req, reply)
    } finally {
      ;(global as any).config = saved
    }

    expect(answers[0].code).toBe(403)
    expect(answers[0].body.code).toBe('MFA_DISABLED')
  })

  it('stops the boot when MANDATORY is demanded and no MFA manager can issue a factor', () => {
    // The trap this closes: the login answers «enrol first» and the enrolment has nothing to enrol
    // with, so every account is locked out at the first login, on both planes.
    const gap = unavailableMandatory({ floor: MfaPolicy.MANDATORY, control: MfaPolicy.MANDATORY, implemented: false })
    expect(gap).toContain('MFA_POLICY=MANDATORY')

    const platformOnly = unavailableMandatory({ floor: MfaPolicy.OPTIONAL, control: MfaPolicy.MANDATORY, implemented: false })
    expect(platformOnly).toContain('SYSTEM_MFA_POLICY=MANDATORY')

    // With a manager, or with a policy that demands no enrolment, there is nothing to refuse.
    expect(unavailableMandatory({ floor: MfaPolicy.MANDATORY, control: MfaPolicy.MANDATORY, implemented: true })).toBeNull()
    expect(unavailableMandatory({ floor: MfaPolicy.ONE_WAY, control: MfaPolicy.ONE_WAY, implemented: false })).toBeNull()
  })

  it('reads the Null Object for what it is, instead of calling it and getting a 500', () => {
    expect(mfaAvailable({ isImplemented: () => false })).toBe(false)
    expect(mfaAvailable({ isImplemented: () => true })).toBe(true)
    expect(mfaAvailable(undefined)).toBe(false)
  })

  it('answers MFA_NOT_AVAILABLE when an enrolment is asked of a build that has no manager', async () => {
    const { mfaSetup } = await import('../../lib/api/system/controller/systemAuth.js')
    const answers: any[] = []
    const reply: any = {
      status(code: number) {
        answers.push({ code })
        return this
      },
      send(body: any) {
        answers[answers.length - 1].body = body
        return this
      }
    }
    const req: any = {
      server: { systemUserManager: { isImplemented: () => true }, mfaManager: { isImplemented: () => false } },
      control: {},
      systemUser: { id: 'sys-1', email: 'operator@system.test' },
      data: () => ({})
    }

    const saved = (global as any).config
    ;(global as any).config = { options: { mfa_policy: 'OPTIONAL' } }
    try {
      await mfaSetup(req, reply)
    } finally {
      ;(global as any).config = saved
    }

    expect(answers[0].code).toBe(503)
    expect(answers[0].body.code).toBe('MFA_NOT_AVAILABLE')
  })

  it('stops the boot when a policy is written and is not one', () => {
    // As a bad `AUTH_MODE` does: reading it as "the default" is how a setting comes to mean the
    // opposite of what it says.
    expect(() => withOptions({ mfa_policy: 'SOMETIMES' }, assertPolicies)).toThrow(/is not an MFA policy/)
    expect(() => withOptions({ system_mfa_policy: 'NEVER' }, assertPolicies)).toThrow(/is not an MFA policy/)
    expect(() => withOptions({ mfa_policy: 'MANDATORY', system_mfa_policy: '' }, assertPolicies)).not.toThrow()
    expect(() => withOptions({}, assertPolicies)).not.toThrow()
  })
})
