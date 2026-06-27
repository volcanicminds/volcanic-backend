/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E harness: boots the real Fastify app on top of an embedded PGlite database,
// seeds a confirmed admin user, and exposes `server.inject` for HTTP-level tests
// (full pipeline: hooks, plugins, routing, schemas, serialization) with no TCP.
//
import { start as startServer } from '../../index.js'
import { start as startDatabase, closeEmbedded, userManager, tokenManager } from '../../typeorm.js'
import { UserSchema, UserClass } from './userEntity.js'
import { TokenSchema, TokenClass } from './tokenEntity.js'

export const ADMIN = { email: 'admin@e2e.test', password: 'Admin-pw-12345', roles: ['admin'] }
export const USER = { email: 'user@e2e.test', password: 'User-pw-123456', roles: ['public'] }

let ds: any
let server: any

async function seedUser(data: { email: string; password: string; roles: string[] }) {
  const u: any = await userManager.createUser(data as any)
  // Login requires a confirmed, valid user — confirm it directly.
  await userManager.updateUserById(u.id, { confirmed: true, confirmedAt: new Date() } as any)
  return u
}

/** Creates a confirmed throwaway user (for tests that mutate/disable a user). */
export async function seedConfirmedUser(email: string, password: string, roles: string[] = ['public']) {
  return seedUser({ email, password, roles })
}

/** Reads a user straight from the DB (e.g. to grab a confirmation token that the
 *  HTTP response schema does not expose). */
export async function getUserByEmail(email: string): Promise<any> {
  return userManager.retrieveUserByEmail(email)
}

/** Reads a token record straight from the DB (e.g. to assert `blocked`, which the
 *  tokenSchema response does not expose). */
export async function getTokenById(id: string): Promise<any> {
  return tokenManager.retrieveTokenById(id)
}

export async function setup() {
  if (server) return server // idempotent: one app/DB shared across all e2e specs

  ds = await startDatabase({ type: 'pglite', synchronize: false, logging: false, entities: [UserSchema, TokenSchema] })
  await ds.synchronize()
  // With a `target`, metadata is keyed by the class → expose the classes.
  ;(global as any).entity = { User: UserClass, Token: TokenClass }

  await seedUser(ADMIN)
  await seedUser(USER)

  server = await startServer({ userManager, tokenManager })
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

/** Logs in via the real /auth/login route and returns the bearer token. */
export async function login(email: string, password: string): Promise<string> {
  const res = await server.inject({ method: 'POST', url: '/auth/login', payload: { email, password } })
  if (res.statusCode !== 200) throw new Error(`login failed (${res.statusCode}): ${res.body}`)
  return JSON.parse(res.body).token
}

export function authHeader(token: string) {
  return { authorization: `Bearer ${token}` }
}
