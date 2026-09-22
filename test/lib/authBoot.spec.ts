//
// T-12.3 and T-12.4 through the real `start()`: no data layer, the framework's own flows.
//
// The promise is that the server boots with nothing injected. It is kept by the Null Objects and
// by a default configuration that asks for nothing a bare build cannot give, and only the real
// entry point proves both at once. `MANIFEST_DUMP_EXIT` stops it before `listen()`.
//
import { expect } from 'expect'
import os from 'node:os'
import path from 'node:path'
import { rmSync } from 'node:fs'
import type { FastifyInstance } from 'fastify'
import type { Authenticator } from '../../types/global.js'
import type logger from '../../lib/util/logger.js'

const GLOBAL_KEYS = ['log', 'config', 'roles', 'systemRoles', 't', 'server', 'tracking', 'trackingConfig', 'cache', 'transferPath', 'authFlows']
const ENV_KEYS = ['JWT_SECRET', 'MANIFEST_DUMP', 'MANIFEST_DUMP_EXIT', 'AUTH_MODE']

const bag = globalThis as unknown as Record<string, unknown>
const dump = path.join(os.tmpdir(), `volcanic-auth-boot-${process.pid}.json`)

type Start = (decorators?: object) => Promise<FastifyInstance>

describe('auth · booting with the default flows and no data layer (T-12.3, T-12.4)', () => {
  const savedGlobals: Record<string, unknown> = {}
  const savedEnv: Record<string, string | undefined> = {}
  let start: Start
  let preload: () => Promise<void>
  let level: string
  // The instance the entry wrote to `global.log`: under tsx an import from here can be a second copy.
  const log = () => bag.log as typeof logger

  before(async () => {
    for (const key of GLOBAL_KEYS) savedGlobals[key] = bag[key]
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.JWT_SECRET = 'unit-test-secret-please-change-32-chars-long'
    process.env.AUTH_MODE = 'BEARER'
    process.env.MANIFEST_DUMP = dump
    process.env.MANIFEST_DUMP_EXIT = 'true'
    const entry = await import('../../index.js')
    // After the import: the level-change listener writes through `global.log`, which the entry sets.
    level = log().level
    log().level = 'silent'
    log().updateLevel()
    start = entry.start as Start
    preload = entry.preload
  })

  after(() => {
    log().level = level
    log().updateLevel()
    for (const key of GLOBAL_KEYS) bag[key] = savedGlobals[key]
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    rmSync(dump, { force: true })
  })

  const boot = async (decorators: object = {}) => {
    await preload()
    return start(decorators)
  }

  it('boots, decorates the five new ports as Null Objects, and the registry beside them', async () => {
    const server = await boot()

    for (const key of [
      'authFlowManager',
      'externalIdentityManager',
      'identityProviderManager',
      'challengeDeliveryManager',
      'accessLogManager'
    ] as const) {
      expect(server[key].isImplemented()).toBe(false)
    }
    expect(server.authRegistry.list('tenant').map((a) => a.id)).toEqual(['password', 'totp', 'email-otp'])
    expect(server.authRegistry.list('control').map((a) => a.id)).toEqual(['password', 'totp', 'email-otp'])
  })

  it('takes `authenticators` from start() into the registry, not as a decorator', async () => {
    const sms: Authenticator = { id: 'sms', kind: 'verifier', planes: ['tenant'], verify: async () => ({ outcome: 'success' }) }
    const server = await boot({ authenticators: [sms] })

    expect(server.authRegistry.get('tenant', 'sms')).toBe(sms)
    expect(server.authRegistry.get('control', 'sms')).toBeUndefined()
    expect(server.hasDecorator('authenticators')).toBe(false)
  })

  it('validates the default flows at boot and loads them onto global.authFlows (T-12.5, T-12.6)', async () => {
    await boot()
    const flows = bag.authFlows as { tenant: { identify: string[] } }
    expect(flows.tenant.identify).toEqual(['password'])
    expect(Object.isFrozen(flows)).toBe(true)
  })

  it('refuses to boot on a flow this build cannot run', async () => {
    await preload()
    const frozen = bag.authFlows as Record<string, unknown>
    bag.authFlows = {
      ...frozen,
      tenant: { identify: ['password', 'email-otp'], flows: [{ roles: ['*'], stages: [] }] }
    }
    // `email-otp` is a built-in since T-12.22: what this build cannot run is a delivery nobody injected.
    await expect(start({})).rejects.toThrow("authFlows.tenant: lists 'email-otp' and no challenge delivery is injected")
  })

  it('keeps an injected manager over its default', async () => {
    const accessLogManager = { isImplemented: () => true }
    const server = await boot({ accessLogManager })
    expect(server.accessLogManager).toBe(accessLogManager)
  })
})
