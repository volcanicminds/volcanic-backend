/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FastifyInstance } from 'fastify'
import type { DataHandle, OnUserCreated, UserManagement, UserOrigin } from '../../types/global.js'

//
// Every `user` row the framework creates goes through `createUserWith`, so the project's
// `onUserCreated` runs for each of them, in the transaction that inserts it, whichever door the
// user came in by. A new creation path that calls the manager directly leaves the project's
// table without a row for that user.
//

export function createUserWith(
  hook: OnUserCreated | null | undefined,
  users: UserManagement,
  ctx: DataHandle,
  data: Record<string, unknown>,
  origin: UserOrigin,
  fields: Record<string, unknown> = {}
): Promise<any> {
  return users.createUser(ctx, data, hook ? (tx, user) => hook(tx, user, { origin, fields }) : undefined)
}

/**
 * The body's values for the properties a project added to the framework's schema `id`, and only
 * those: the framework's own fields (`base`) never reach the hook, and neither does a key the
 * schema does not declare, which the caller wrote and nobody validated.
 */
export function projectFields(
  server: FastifyInstance,
  id: string,
  base: Record<string, unknown>,
  data: Record<string, unknown>
): Record<string, unknown> {
  const declared = (server.getSchema(id) as { properties?: Record<string, unknown> } | undefined)?.properties
  const fields: Record<string, unknown> = {}
  for (const key of Object.keys(declared ?? {})) {
    if (key in base || data[key] === undefined) continue
    fields[key] = data[key]
  }
  return fields
}
