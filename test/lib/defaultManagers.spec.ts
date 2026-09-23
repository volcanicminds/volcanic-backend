/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: the Null-Object managers, which are what "runs with no database" means.
//
// The framework promises to boot without a data layer, and these are the objects that keep
// that promise. Untested, the promise rests on a Proxy — and a Proxy that answers the wrong
// question is a specific, already-paid-for kind of bug: a catch-all version of this told
// Fastify it was a getter/setter when Fastify probed the decorator before registering it, and
// the manager was wired as something else entirely. Found by the isolation bench, not by
// anything here, which is the gap this file closes.
//
import { expect } from 'expect'
import {
  defaultUserManager,
  defaultTokenManager,
  defaultTrackingManager,
  defaultTenantManager,
  defaultSystemUserManager,
  defaultImpersonationManager,
  defaultDestructionManager,
  defaultMfaManager,
  defaultTransferManager,
  defaultSessionManager,
  defaultAuthFlowManager,
  defaultExternalIdentityManager,
  defaultIdentityProviderManager,
  defaultChallengeDeliveryManager,
  defaultAccessLogManager,
  defaultSettingManager
} from '../../lib/defaults/managers.js'

;(global as any).log = {}

const ALL: Array<[string, any]> = [
  ['userManager', defaultUserManager],
  ['tokenManager', defaultTokenManager],
  ['trackingManager', defaultTrackingManager],
  ['tenantManager', defaultTenantManager],
  ['systemUserManager', defaultSystemUserManager],
  ['impersonationManager', defaultImpersonationManager],
  ['destructionManager', defaultDestructionManager],
  ['mfaManager', defaultMfaManager],
  ['transferManager', defaultTransferManager],
  ['sessionManager', defaultSessionManager],
  ['authFlowManager', defaultAuthFlowManager],
  ['externalIdentityManager', defaultExternalIdentityManager],
  ['identityProviderManager', defaultIdentityProviderManager],
  ['challengeDeliveryManager', defaultChallengeDeliveryManager],
  ['accessLogManager', defaultAccessLogManager],
  ['settingManager', defaultSettingManager]
]

describe('defaults/managers · booting without a data layer (T-9.5)', () => {
  it('answers isImplemented() with false, which is the question the framework asks', () => {
    // Every path that needs persistence is gated on this. A default that answered true would
    // send the framework down the path and produce the failure one layer deeper, where the
    // message no longer says what is missing.
    const wrong = ALL.filter(([, m]) => m.isImplemented() !== false).map(([name]) => name)
    expect(wrong).toEqual([])
  })

  it('rejects every method of the contract it stands in for', async () => {
    // Sampled across the managers rather than one call on one of them: the factory builds all
    // of them from a list, so a name missing from a list is the failure mode, and it shows up as
    // `undefined is not a function` at the call site instead of as a readable refusal.
    const calls: Array<[string, Promise<unknown>]> = [
      ['userManager', (defaultUserManager as any).createUser({}, {})],
      ['tokenManager', (defaultTokenManager as any).retrieveTokenByExternalId({}, 'x')],
      ['trackingManager', (defaultTrackingManager as any).addChange({}, {})],
      ['tenantManager', (defaultTenantManager as any).listTenants({})],
      ['systemUserManager', (defaultSystemUserManager as any).retrieveSystemUserByEmail({}, 'x@y.z')],
      ['mfaManager', (defaultMfaManager as any).verify('123456', 'secret')],
      ['sessionManager', (defaultSessionManager as any).findBySecret({}, 'x', 10)],
      ['authFlowManager', (defaultAuthFlowManager as any).findBySecret({}, 'flow', 'secret')],
      ['externalIdentityManager', (defaultExternalIdentityManager as any).findLink({}, {})],
      ['identityProviderManager', (defaultIdentityProviderManager as any).get({}, 't', 'k')],
      ['challengeDeliveryManager', (defaultChallengeDeliveryManager as any).deliver({})],
      ['accessLogManager', (defaultAccessLogManager as any).record({}, {})],
      ['settingManager', (defaultSettingManager as any).get({}, 'k')]
    ]

    for (const [name, call] of calls) {
      await expect(call).rejects.toThrow(new RegExp(`${name}\\.\\w+ is not implemented`))
      // The message names the two ways out, because "not implemented" alone leaves the reader
      // to guess whether the framework is broken or their wiring is missing.
      await expect(call).rejects.toThrow(/start\(decorators\)/)
      await expect(call).rejects.toThrow(/@volcanicminds\/backend\/db/)
    }
  })

  it('does not answer a property the contract does not have', () => {
    // The bug this prevents, in one line. Fastify asks a decorator whether it is an accessor
    // before registering it; a catch-all Proxy said yes.
    // Collected and compared in one go: a per-manager assertion cannot carry a label with
    // this matcher, and a failure that does not say WHICH manager is a failure you have to
    // reproduce before you can read it.
    const answered = ALL.filter(([, m]) => {
      const any = m as any
      return [any.getter, any.setter, any.then, any.somethingInventedJustNow].some((v) => v !== undefined)
    }).map(([name]) => name)

    expect(answered).toEqual([])
  })

  it('answers nothing for a symbol, so it is not mistaken for a promise or an iterator', () => {
    const answered = ALL.filter(([, m]) => {
      const any = m as any
      return [any[Symbol.iterator], any[Symbol.asyncIterator], any[Symbol.toPrimitive]].some((v) => v !== undefined)
    }).map(([name]) => name)

    expect(answered).toEqual([])
  })
})
