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
      approved: integer('approved', { mode: 'boolean' }).notNull().default(true),
      approvedAt: integer('approved_at', { mode: 'timestamp_ms' }),
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

  // The schema version of THIS container (T-5.1). See the Postgres file for why it is per
  // container and why it carries a `set`.
  const migration = sqliteTable(
    'migration',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      set: text('set').notNull(),
      name: text('name').notNull(),
      hash: text('hash').notNull(),
      appliedAt: integer('applied_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (t) => [uniqueIndex('migration_set_name_uq').on(t.set, t.name)]
  )

  // A live session (T-11.1). The logical shape and the reasons are in ./pg.ts: one row per
  // session, the secret kept only as its SHA-256, a grace window for the tabs that renew
  // together, and two clocks instead of one.
  const session = sqliteTable(
    'session',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      sid: text('sid').notNull().$defaultFn(uuidv7),
      subjectId: text('subject_id').notNull(),
      scope: text('scope').notNull().default('tenant'),
      secretHash: text('secret_hash').notNull(),
      generation: integer('generation').notNull().default(1),
      previousSecretHash: text('previous_secret_hash'),
      rotatedAt: integer('rotated_at', { mode: 'timestamp_ms' }),
      lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      idleExpiresAt: integer('idle_expires_at', { mode: 'timestamp_ms' }).notNull(),
      absoluteExpiresAt: integer('absolute_expires_at', { mode: 'timestamp_ms' }).notNull(),
      revokedAt: integer('revoked_at', { mode: 'timestamp_ms' }),
      revokedReason: text('revoked_reason'),
      ip: text('ip'),
      userAgent: text('user_agent'),
      impersonationId: text('impersonation_id'),
      authMethods: text('auth_methods', { mode: 'json' }).$type<string[]>(),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`)
    },
    (t) => [
      uniqueIndex('session_sid_uq').on(t.sid),
      index('session_secret_idx').on(t.secretHash),
      index('session_previous_secret_idx').on(t.previousSecretHash),
      index('session_subject_idx').on(t.subjectId, t.revokedAt),
      index('session_absolute_expires_idx').on(t.absoluteExpiresAt)
    ]
  )

  // A login in progress (F37), an identity at a provider (F40) and the access log (F44). The
  // shapes and the reasons are in ./pg.ts.
  const authFlow = sqliteTable(
    'auth_flow',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      flowId: text('flow_id').notNull(),
      scope: text('scope').notNull().default('tenant'),
      subjectId: text('subject_id'),
      candidateSubjectId: text('candidate_subject_id'),
      secretHash: text('secret_hash').notNull(),
      flowName: text('flow_name'),
      stageIndex: integer('stage_index').notNull().default(0),
      satisfied: text('satisfied', { mode: 'json' }).$type<string[]>().notNull().default([]),
      challengeMethod: text('challenge_method'),
      challengeHash: text('challenge_hash'),
      challengeExpiresAt: integer('challenge_expires_at', { mode: 'timestamp_ms' }),
      challengeAttempts: integer('challenge_attempts').notNull().default(0),
      challengeSends: integer('challenge_sends').notNull().default(0),
      lastSentAt: integer('last_sent_at', { mode: 'timestamp_ms' }),
      stateHash: text('state_hash'),
      external: text('external'),
      externalResult: text('external_result', { mode: 'json' }),
      version: integer('version').notNull().default(1),
      ip: text('ip'),
      userAgent: text('user_agent'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
    },
    (t) => [
      uniqueIndex('auth_flow_flow_id_uq').on(t.flowId),
      uniqueIndex('auth_flow_subject_uq').on(t.subjectId, t.scope).where(sql`${t.subjectId} is not null`),
      index('auth_flow_state_idx').on(t.stateHash),
      index('auth_flow_candidate_idx').on(t.candidateSubjectId, t.lastSentAt),
      index('auth_flow_expires_idx').on(t.expiresAt)
    ]
  )

  const externalIdentity = sqliteTable(
    'external_identity',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      scope: text('scope').notNull().default('tenant'),
      subjectId: text('subject_id').notNull(),
      provider: text('provider').notNull(),
      issuer: text('issuer').notNull(),
      subject: text('subject').notNull(),
      emailAtLink: text('email_at_link'),
      createdAt: integer('created_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      lastUsedAt: integer('last_used_at', { mode: 'timestamp_ms' })
    },
    (t) => [
      uniqueIndex('external_identity_key_uq').on(t.scope, t.provider, t.issuer, t.subject),
      index('external_identity_subject_idx').on(t.subjectId, t.scope)
    ]
  )

  const accessLog = sqliteTable(
    'access_log',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      occurredAt: integer('occurred_at', { mode: 'timestamp_ms' })
        .notNull()
        .default(sql`(unixepoch() * 1000)`),
      scope: text('scope').notNull().default('tenant'),
      event: text('event').notNull(),
      outcome: text('outcome').notNull(),
      code: text('code'),
      subjectId: text('subject_id'),
      methods: text('methods', { mode: 'json' }).$type<string[]>(),
      provider: text('provider'),
      flowId: text('flow_id'),
      sid: text('sid'),
      ip: text('ip')
    },
    (t) => [
      index('access_log_occurred_idx').on(t.occurredAt),
      index('access_log_subject_idx').on(t.subjectId, t.occurredAt)
    ]
  )

  const setting = sqliteTable('setting', {
    key: text('key').primaryKey(),
    value: text('value', { mode: 'json' }).notNull(),
    updatedBy: text('updated_by'),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .default(sql`(unixepoch() * 1000)`)
  })

  return { user, token, change, migration, session, authFlow, externalIdentity, accessLog, setting }
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

  // A tenant's own identity provider (F38). See ./pg.ts.
  const identityProvider = sqliteTable(
    'identity_provider',
    {
      id: text('id').primaryKey().$defaultFn(uuidv7),
      tenantId: text('tenant_id').notNull(),
      key: text('key').notNull(),
      type: text('type').notNull().default('oidc'),
      status: text('status').notNull().default('active'),
      config: text('config', { mode: 'json' }).notNull().default({}),
      secretEnc: text('secret_enc'),
      createdAt: stamps.createdAt,
      updatedAt: stamps.updatedAt
    },
    (t) => [uniqueIndex('identity_provider_tenant_key_uq').on(t.tenantId, t.key)]
  )

  return { tenant, systemUser, impersonation, destructionRequest, identityProvider }
}

export type AppTables = ReturnType<typeof appTables>
export type RegistryTables = ReturnType<typeof registryTables>
