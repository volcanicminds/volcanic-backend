import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'
import { uuidv7 } from '../uuid.js'

//
// SQLite and libSQL schema (docs/SCHEMA_V5.md §1). The logical shape is the one in ./pg.ts;
// only the type mapping differs, and it differs in exactly three places:
//
//   - identifiers are `text`, since there is no uuid type;
//   - booleans are integers 0/1;
//   - timestamps are integers, epoch MILLISECONDS, always UTC. No local time ever reaches
//     the database, which is the same guarantee timestamptz gives on Postgres;
//   - string arrays and free-form objects are JSON text.
//
// There is no schema factory here, and that is not an omission: SQLite has no schemas, so a
// container is a file. `schema` as a tenancy strategy is refused at boot by the capability
// matrix rather than emulated with table prefixes, which would be the `row` strategy under
// another name (decision 5).
//
const stamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' })
}

export function appTables() {
  const user = sqliteTable(
    'user',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      externalId: text('external_id').notNull().$defaultFn(uuidv7),
      username: text('username'),
      email: text('email').notNull(),
      password: text('password').notNull(),
      confirmed: integer('confirmed', { mode: 'boolean' }).notNull().default(false),
      confirmedAt: integer('confirmed_at', { mode: 'timestamp_ms' }),
      passwordChangedAt: integer('password_changed_at', { mode: 'timestamp_ms' }),
      blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
      blockedReason: text('blocked_reason'),
      blockedAt: integer('blocked_at', { mode: 'timestamp_ms' }),
      resetPasswordToken: text('reset_password_token'),
      resetPasswordTokenAt: integer('reset_password_token_at', { mode: 'timestamp_ms' }),
      confirmationToken: text('confirmation_token'),
      roles: text('roles', { mode: 'json' }).$type<string[]>().notNull().default([]),
      isFounder: integer('is_founder', { mode: 'boolean' }).notNull().default(false),
      mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
      mfaSecret: text('mfa_secret'),
      mfaType: text('mfa_type'),
      mfaRecoveryCodes: text('mfa_recovery_codes', { mode: 'json' }).$type<string[]>(),
      mfaLastUsedCounter: integer('mfa_last_used_counter'),
      version: integer('version').notNull().default(1),
      ...stamps
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

  const token = sqliteTable(
    'token',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      externalId: text('external_id').notNull().$defaultFn(uuidv7),
      name: text('name').notNull(),
      description: text('description'),
      blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
      blockedReason: text('blocked_reason'),
      blockedAt: integer('blocked_at', { mode: 'timestamp_ms' }),
      roles: text('roles', { mode: 'json' }).$type<string[]>().notNull().default([]),
      expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
      version: integer('version').notNull().default(1),
      ...stamps
    },
    (t) => [uniqueIndex('token_external_id_uq').on(t.externalId), index('token_deleted_at_idx').on(t.deletedAt)]
  )

  const change = sqliteTable(
    'change',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      userId: text('user_id'),
      tokenId: text('token_id'),
      // Which impersonation session wrote this, when one did (T-4.2). A column and not a
      // key inside `contents`: an audit trail whose actor is buried in a JSON blob cannot be
      // indexed, queried or joined, which is most of what an audit trail is for.
      impersonationId: text('impersonation_id'),
      status: text('status').notNull(),
      entityName: text('entity_name').notNull(),
      entityId: text('entity_id').notNull(),
      contents: text('contents', { mode: 'json' }).notNull()
    },
    (t) => [index('change_entity_idx').on(t.entityName, t.entityId), index('change_created_at_idx').on(t.createdAt)]
  )

  return { user, token, change }
}

export function registryTables() {
  const tenant = sqliteTable(
    'tenant',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      name: text('name').notNull(),
      slug: text('slug').notNull(),
      strategy: text('strategy').notNull(),
      engine: text('engine').notNull(),
      locator: text('locator').notNull(),
      config: text('config', { mode: 'json' }).notNull().default({}),
      status: text('status').notNull().default('active'),
      schemaVersion: text('schema_version'),
      ...stamps
    },
    (t) => [
      uniqueIndex('tenant_slug_uq').on(t.slug),
      uniqueIndex('tenant_locator_uq').on(t.engine, t.locator),
      index('tenant_status_idx').on(t.status)
    ]
  )

  const systemUser = sqliteTable(
    'system_user',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      externalId: text('external_id').notNull().$defaultFn(uuidv7),
      email: text('email').notNull(),
      password: text('password').notNull(),
      blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
      blockedReason: text('blocked_reason'),
      blockedAt: integer('blocked_at', { mode: 'timestamp_ms' }),
      roles: text('roles', { mode: 'json' }).$type<string[]>().notNull().default([]),
      mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).notNull().default(false),
      mfaSecret: text('mfa_secret'),
      mfaType: text('mfa_type'),
      mfaRecoveryCodes: text('mfa_recovery_codes', { mode: 'json' }).$type<string[]>(),
      mfaLastUsedCounter: integer('mfa_last_used_counter'),
      version: integer('version').notNull().default(1),
      ...stamps
    },
    (t) => [uniqueIndex('system_user_email_uq').on(t.email), uniqueIndex('system_user_external_id_uq').on(t.externalId)]
  )

  const impersonation = sqliteTable(
    'impersonation',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      systemUserId: text('system_user_id').notNull(),
      tenantId: text('tenant_id').notNull(),
      targetUserId: text('target_user_id').notNull(),
      reason: text('reason').notNull(),
      ip: text('ip'),
      userAgent: text('user_agent'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
      revokedAt: integer('revoked_at', { mode: 'timestamp_ms' })
    },
    (t) => [
      index('impersonation_tenant_idx').on(t.tenantId, t.createdAt),
      index('impersonation_actor_idx').on(t.systemUserId)
    ]
  )

  const destructionRequest = sqliteTable(
    'destruction_request',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      tenantId: text('tenant_id').notNull(),
      systemUserId: text('system_user_id').notNull(),
      tokenHash: text('token_hash').notNull(),
      preview: text('preview', { mode: 'json' }).notNull(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
      consumedAt: integer('consumed_at', { mode: 'timestamp_ms' }),
      exportRef: text('export_ref')
    },
    (t) => [index('destruction_tenant_idx').on(t.tenantId), index('destruction_expires_idx').on(t.expiresAt)]
  )

  return { tenant, systemUser, impersonation, destructionRequest }
}

export type AppTables = ReturnType<typeof appTables>
export type RegistryTables = ReturnType<typeof registryTables>
