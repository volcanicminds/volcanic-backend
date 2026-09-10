//
// The generation entry for the TENANT set on SQLite and libSQL (T-9.1).
//
// A customer's container holds application data and its own audit trail, and nothing about
// the platform: no registry, no platform identities, no impersonation log. That is invariant
// 7 expressed as a file list rather than as a rule someone has to remember, and it holds on
// every engine or it does not hold at all.
//
import { appTables } from '../sqlite.js'

const app = appTables()

export const user = app.user
export const token = app.token
export const change = app.change
export const migration = app.migration
