//
// The generation entry for the CONTROL set on SQLite and libSQL (T-9.1).
//
// The twin of `control.pg.ts`, and it exists because the SQL is genuinely different rather
// than decorative: `timestamp with time zone` against an integer of epoch milliseconds,
// `boolean` against 0/1, `text[]` against JSON text, `USING btree` against nothing at all.
// Translating one into the other at apply time would mean a schema nobody has read in the
// language the database speaks, which is the opposite of why migrations are committed SQL.
//
// There is no schema factory here: SQLite has no schemas, so a container is a file and the
// connection already opened it.
//
// This module exists for the generator and is never imported at runtime.
//
import { appTables, registryTables } from '../sqlite.js'

const app = appTables()
const registry = registryTables()

export const user = app.user
export const token = app.token
export const change = app.change
export const migration = app.migration
export const session = app.session
export const authFlow = app.authFlow
export const externalIdentity = app.externalIdentity
export const accessLog = app.accessLog

export const tenant = registry.tenant
export const systemUser = registry.systemUser
export const impersonation = registry.impersonation
export const destructionRequest = registry.destructionRequest
export const identityProvider = registry.identityProvider
export const setting = app.setting
