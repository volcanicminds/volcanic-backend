/* eslint-disable @typescript-eslint/no-explicit-any */
//
// MFA E2E harness. Boots the real app over embedded PGlite and injects a
// CONTROLLABLE mfaManager stub (the backend ships only a "Not implemented"
// default — a real TOTP manager lives in volcanic-tools, which the backend must
// not depend on in its own tests).
//
// The stub honours the MfaManagement contract exactly: verify() returns a NUMBER
// delta on success (otplib's checkDelta shape) or null on failure. We encode the
// delta in the token ("ok<delta>") so a test can drive distinct time-steps and
// exercise the real anti-replay logic in auth.ts deterministically, without
// waiting 30s for a fresh TOTP window.
//
import { start as startServer } from '../../index.js'
import { start as startDatabase, closeEmbedded, userManager } from '../../typeorm.js'
import { UserSchema, UserClass } from '../e2e/userEntity.js'

export const USER = { email: 'mfa-user@e2e.test', password: 'Mfa-pw-123456', roles: ['public'] }

// "ok0" -> delta 0, "ok1" -> delta 1, ...  anything else -> invalid (null).
export const codeForDelta = (d: number) => `ok${d}`

const mfaManagerStub = {
  async generateSetup(appName: string, email: string) {
    return {
      secret: 'STUBSECRET234567',
      uri: `otpauth://totp/${appName}:${email}?secret=STUBSECRET234567`,
      qrCode: 'data:image/png;base64,stub'
    }
  },
  verify(token: string, _secret: string): number | null {
    if (typeof token === 'string' && token.startsWith('ok')) {
      const d = parseInt(token.slice(2), 10)
      return Number.isFinite(d) ? d : 0
    }
    return null
  }
}

let ds: any
let server: any

export async function setup() {
  if (server) return server
  ds = await startDatabase({ type: 'pglite', synchronize: false, logging: false, entities: [UserSchema] })
  await ds.synchronize()
  ;(global as any).entity = { User: UserClass }

  const u: any = await userManager.createUser(USER as any)
  await userManager.updateUserById(u.id, { confirmed: true, confirmedAt: new Date() } as any)

  server = await startServer({ userManager, mfaManager: mfaManagerStub })
  await server.ready()
  return server
}

export async function teardown() {
  if (server) await server.close()
  if (ds?.isInitialized) await ds.destroy()
  await closeEmbedded()
}

export function app() {
  return server
}

export function setMfaPolicy(policy: 'OPTIONAL' | 'MANDATORY' | 'ONE_WAY') {
  ;(global as any).config.options.mfa_policy = policy
}

/** Standard (non-MFA) login → returns the full access token. */
export async function login(email = USER.email, password = USER.password): Promise<string> {
  const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}
