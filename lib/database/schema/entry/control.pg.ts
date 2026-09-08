//
// The generation entry for the CONTROL set (T-5.1).
//
// `drizzle-kit` reads a static module and emits SQL from it, so the factories are called
// once here with `public`, which `tableFactory` deliberately leaves UNQUALIFIED: the SQL
// that comes out names no schema, and the runner puts it inside whichever container it is
// applied to. That is what lets one file serve a thousand tenants.
//
// This module exists for the generator and is never imported at runtime.
//
import { appTables, registryTables } from '../pg.js'

const app = appTables('public')
const registry = registryTables('public')

// The control plane carries both: its own tables, and the application ones, which live here
// too when the deployment has no tenants.
export const user = app.user
export const token = app.token
export const change = app.change
export const migration = app.migration

export const tenant = registry.tenant
export const systemUser = registry.systemUser
export const impersonation = registry.impersonation
export const destructionRequest = registry.destructionRequest
