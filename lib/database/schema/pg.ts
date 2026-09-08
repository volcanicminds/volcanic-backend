import { pgSchema, pgTable, text, boolean, integer, jsonb, timestamp, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { uuidv7 } from '../uuid.js'

//
// Postgres schema (docs/SCHEMA_V5.md). Two factories, because a table's home is decided at
// runtime: the control plane lives in one schema, every tenant container in its own.
//
// The factories are what makes T-3.1 possible. Drizzle prints the schema name into the SQL
// it builds — `select ... from "tenant_acme"."user"` — so choosing a container is choosing a
// table object, not mutating a connection. Nothing is left on the session, so nothing has to
// be reset before the connection goes back to the pool, which is the whole of D-01.
//
// Conventions applied everywhere: snake_case in the database, camelCase in TypeScript,
// declared explicitly rather than derived; timestamptz, never a naive timestamp; identifiers
// generated in process (see ../uuid.ts).
//
const stamps = () => ({
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true })
})

/**
 * Drizzle refuses `pgSchema('public')`, because Postgres already resolves unqualified names
 * there. So a container in `public` produces unqualified SQL, which by definition depends on
 * `search_path` — the one thing v5 does not want to depend on.
 *
 * Two answers, both applied. Any schema OTHER than `public` is qualified, which is the case
 * for every tenant container and the recommended shape for the control plane too. For
 * `public` the adapter pins `search_path` on the connection itself, once, at connect time
 * (`options=-c search_path=...` in T-2.2): a value that is identical for every connection and
 * that no request ever changes is not session state, it is configuration.
 */
const tableFactory = (schemaName: string): typeof pgTable =>
  (schemaName && schemaName !== 'public' ? pgSchema(schemaName).table : pgTable) as typeof pgTable

/**
 * The tables that live inside a container: a tenant's schema, or the control plane itself
 * when the deployment has no tenants.
 */
export function appTables(schemaName: string) {
  const table = tableFactory(schemaName)

  const user = table(
    'user',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      // Public identifier and JWT subject: rotating it invalidates every token of the user.
      externalId: text('external_id').notNull().$defaultFn(uuidv7),
      username: text('username'),
      email: text('email').notNull(),
      password: text('password').notNull(),
      confirmed: boolean('confirmed').notNull().default(false),
      confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
      passwordChangedAt: timestamp('password_changed_at', { withTimezone: true }),
      blocked: boolean('blocked').notNull().default(false),
      blockedReason: text('blocked_reason'),
      blockedAt: timestamp('blocked_at', { withTimezone: true }),
      resetPasswordToken: text('reset_password_token'),
      resetPasswordTokenAt: timestamp('reset_password_token_at', { withTimezone: true }),
      confirmationToken: text('confirmation_token'),
      roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
      // Founder is a property of the row in its container, not of a process environment
      // variable: with the v4 comparison the same address was founder inside every tenant (D-27).
      isFounder: boolean('is_founder').notNull().default(false),
      mfaEnabled: boolean('mfa_enabled').notNull().default(false),
      mfaSecret: text('mfa_secret'),
      mfaType: text('mfa_type'),
      mfaRecoveryCodes: text('mfa_recovery_codes').array(),
      // Absolute TOTP step already consumed: rejects a replay inside the validity window.
      mfaLastUsedCounter: integer('mfa_last_used_counter'),
      version: integer('version').notNull().default(1),
      ...stamps()
    },
    (t) => [
      uniqueIndex('user_email_uq').on(t.email),
      uniqueIndex('user_external_id_uq').on(t.externalId),
      uniqueIndex('user_username_uq').on(t.username).where(sql`${t.username} is not null`),
      index('user_reset_token_idx').on(t.resetPasswordToken),
      index('user_confirmation_token_idx').on(t.confirmationToken),
      index('user_deleted_at_idx').on(t.deletedAt)
    ]
  )

  const token = table(
    'token',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      externalId: text('external_id').notNull().$defaultFn(uuidv7),
      name: text('name').notNull(),
      description: text('description'),
      blocked: boolean('blocked').notNull().default(false),
      blockedReason: text('blocked_reason'),
      blockedAt: timestamp('blocked_at', { withTimezone: true }),
      roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
      // Nullable, but the API requires the caller to say so: a machine credential without an
      // expiry must be a decision, not an omission.
      expiresAt: timestamp('expires_at', { withTimezone: true }),
      version: integer('version').notNull().default(1),
      ...stamps()
    },
    (t) => [uniqueIndex('token_external_id_uq').on(t.externalId), index('token_deleted_at_idx').on(t.deletedAt)]
  )

  // Append-only: a change record that can be updated is not an audit trail. No updatedAt,
  // no deletedAt.
  const change = table(
    'change',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      userId: text('user_id'),
      tokenId: text('token_id'),
      // Which impersonation session wrote this, when one did (T-4.2). A column and not a
      // key inside `contents`: an audit trail whose actor is buried in a JSON blob cannot be
      // indexed, queried or joined, which is most of what an audit trail is for.
      impersonationId: text('impersonation_id'),
      status: text('status').notNull(),
      entityName: text('entity_name').notNull(),
      entityId: text('entity_id').notNull(),
      contents: jsonb('contents').notNull()
    },
    (t) => [index('change_entity_idx').on(t.entityName, t.entityId), index('change_created_at_idx').on(t.createdAt)]
  )

  //
  // The schema version of THIS container (T-5.1, docs/SCHEMA_V5.md §2.4).
  //
  // One table per container and never a central registry: when a tenant is restored from a
  // backup its schema version has to travel back with it, and a central table would say the
  // container is at a version its tables no longer have.
  //
  // `set` exists because the control plane applies two sets: its own (the registry, the
  // platform identities) and the application one, which in a single-tenant deployment lives
  // there too. A tenant container only ever carries the second.
  //
  const migration = table(
    'migration',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      set: text('set').notNull(),
      name: text('name').notNull(),
      // The file's checksum, so an edited migration is caught instead of silently skipped.
      hash: text('hash').notNull(),
      appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow()
    },
    (t) => [uniqueIndex('migration_set_name_uq').on(t.set, t.name)]
  )

  return { user, token, change, migration }
}

/** The registry and the platform's own identities. Control plane only, never in a container. */
export function registryTables(schemaName: string) {
  const table = tableFactory(schemaName)

  const tenant = table(
    'tenant',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      name: text('name').notNull(),
      slug: text('slug').notNull(),
      strategy: text('strategy').notNull(),
      engine: text('engine').notNull(),
      // The one field that says where the data is: schema name, database name, or file path.
      locator: text('locator').notNull(),
      config: jsonb('config').notNull().default({}),
      status: text('status').notNull().default('active'),
      // Mirrored from the container's own migration log, for reporting. Not the source of
      // truth: a tenant restored from a backup brings its version back with it.
      schemaVersion: text('schema_version'),
      ...stamps()
    },
    (t) => [
      uniqueIndex('tenant_slug_uq').on(t.slug),
      uniqueIndex('tenant_locator_uq').on(t.engine, t.locator),
      index('tenant_status_idx').on(t.status)
    ]
  )

  const systemUser = table(
    'system_user',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      externalId: text('external_id').notNull().$defaultFn(uuidv7),
      email: text('email').notNull(),
      password: text('password').notNull(),
      blocked: boolean('blocked').notNull().default(false),
      blockedReason: text('blocked_reason'),
      blockedAt: timestamp('blocked_at', { withTimezone: true }),
      // System role codes only, all prefixed `system:` (docs/AUTHORIZATION_V5.md §3).
      roles: text('roles').array().notNull().default(sql`'{}'::text[]`),
      mfaEnabled: boolean('mfa_enabled').notNull().default(false),
      mfaSecret: text('mfa_secret'),
      mfaType: text('mfa_type'),
      mfaRecoveryCodes: text('mfa_recovery_codes').array(),
      mfaLastUsedCounter: integer('mfa_last_used_counter'),
      version: integer('version').notNull().default(1),
      ...stamps()
    },
    (t) => [uniqueIndex('system_user_email_uq').on(t.email), uniqueIndex('system_user_external_id_uq').on(t.externalId)]
  )

  const impersonation = table(
    'impersonation',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      systemUserId: text('system_user_id').notNull(),
      tenantId: text('tenant_id').notNull(),
      targetUserId: text('target_user_id').notNull(),
      // Required: an impersonation without a stated reason is refused, because the reason is
      // what makes the record worth keeping.
      reason: text('reason').notNull(),
      ip: text('ip'),
      userAgent: text('user_agent'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      revokedAt: timestamp('revoked_at', { withTimezone: true })
    },
    (t) => [index('impersonation_tenant_idx').on(t.tenantId, t.createdAt), index('impersonation_actor_idx').on(t.systemUserId)]
  )

  const destructionRequest = table(
    'destruction_request',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      tenantId: text('tenant_id').notNull(),
      systemUserId: text('system_user_id').notNull(),
      // Only the hash: the one-time token is shown once and never stored.
      tokenHash: text('token_hash').notNull(),
      preview: jsonb('preview').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      consumedAt: timestamp('consumed_at', { withTimezone: true }),
      exportRef: text('export_ref')
    },
    (t) => [index('destruction_tenant_idx').on(t.tenantId), index('destruction_expires_idx').on(t.expiresAt)]
  )

  return { tenant, systemUser, impersonation, destructionRequest }
}

export type AppTables = ReturnType<typeof appTables>
export type RegistryTables = ReturnType<typeof registryTables>
