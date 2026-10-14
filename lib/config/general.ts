export default {
  name: 'general',
  options: {
    allow_multiple_admin: false,
    allow_admin_change_password_users: false,
    // opt-in: users created by an admin (POST /users) start confirmed and can log in
    // immediately, unless the payload explicitly sends confirmed:false.
    allow_admin_create_confirmed_users: false,
    reset_external_id_on_login: false,
    scheduler: false,
    embedded_auth: true,
    mfa_policy: process.env.MFA_POLICY || 'OPTIONAL', // OFF, OPTIONAL, MANDATORY, ONE_WAY
    // The control plane may be stricter than the rest of the deployment, never looser: operators
    // are the ones who can destroy a customer's container. Absent, it takes the value above, which
    // acts as a floor; a tenant does the same in the `config` of its registry row, and a policy
    // weaker than the floor is refused.
    system_mfa_policy: process.env.SYSTEM_MFA_POLICY || undefined,
    // How long a /auth/forgot-password reset token stays usable, in seconds.
    // Checked against `user.resetPasswordTokenAt` by /auth/reset-password.
    reset_password_token_ttl: Number(process.env.RESET_PASSWORD_TOKEN_TTL) || 3600,
    // The emergency MFA reset of the admin is NOT configured here. It is a break-glass
    // action bounded to ten minutes, so it lives in the environment of one deploy
    // (`MFA_ADMIN_FORCED_RESET_EMAIL`, `MFA_ADMIN_FORCED_RESET_UNTIL`, read in `index.ts`) and
    // never in a committed file.
    // How long an impersonation session lasts, in seconds. Thirty minutes: the duration is the
    // only thing that bounds a session nobody revokes by hand. The absolute maximum is four hours
    // and it is enforced in code.
    impersonation_ttl: Number(process.env.IMPERSONATION_TTL) || 1800,
    // Where container exports end up. It is configuration and not a request field: a route
    // reachable over HTTP does not choose where it writes on disk.
    export_directory: process.env.EXPORT_DIRECTORY || './data/exports',
    // Where the platform's data lives: the tenant registry, the system users and, when there are
    // no tenants, the application's data. See docs/CONFIGURATION_V5.md §1.
    control: {
      engine: process.env.CONTROL_ENGINE || 'postgres',
      url: process.env.DATABASE_URL || undefined,
      schema: process.env.DB_SCHEMA || 'public',
      pool: {
        max: Number(process.env.DB_POOL_MAX) || 10,
        idleTimeoutMs: Number(process.env.DB_POOL_IDLE_MS) || 30000
      },
      // pglite only: unset, the database lives in memory and ends with the process.
      dataDir: process.env.PGLITE_DATA_DIR || undefined
    },
    // Absent = single tenant, and that is the default. Declaring the block IS enabling tenancy:
    // there is no `enabled` flag that could contradict the strategy.
    tenants: null,
    manifest: {
      // opt-in: exposes GET /admin/manifest (gated by the `manifest` capability) for the admin console
      enabled: false
    },
    cache: {
      // opt-in: in-memory LRU+TTL cache for routes that declare `cache:`.
      // When enabled, ttl (default 3600s) and maxEntries (default 1000) can be set here.
      enabled: false
    },
    // The session registry. On whenever the data layer is there: without a registry, renewal does
    // not exist, rather than existing and not protecting. The durations are in seconds, and each
    // answers a different question: `idleTtl` closes a session nobody uses, `absoluteTtl` closes a
    // session that renews forever, `graceSeconds` is the tolerance that keeps two tabs renewing
    // together from being mistaken for a theft.
    sessions: {
      idleTtl: Number(process.env.SESSION_IDLE_TTL) || 2592000,
      absoluteTtl: Number(process.env.SESSION_ABSOLUTE_TTL) || 15552000,
      graceSeconds: Number(process.env.SESSION_GRACE_SECONDS) || 10
    },
    // The access log. The two retentions differ because they answer to different readers:
    // 90 days cover a quarterly review and the usual time an incident takes to be noticed, 180
    // for platform operators follow the Italian DPA's rule on system administrators (27 November
    // 2008), which asks for at least six months. A reading for the consumer's privacy adviser to
    // confirm, not legal advice. `ip: 'none'` stores no address at all.
    // Who may create an account in a tenant: the modes a tenant may choose from, and the one
    // that applies until its administrator chooses. The control plane may replace both at runtime
    // for every tenant, and the set for a single tenant; a tenant picks inside the set. Closed by
    // default: `invite` means accounts are made by an administrator.
    accountCreation: {
      allowed: process.env.ACCOUNT_CREATION_ALLOWED || 'invite,approval,open',
      default: process.env.ACCOUNT_CREATION_DEFAULT || 'invite'
    },
    accessLog: {
      ip: process.env.ACCESS_LOG_IP === 'none' ? 'none' : 'truncate',
      retentionDays: Number(process.env.ACCESS_LOG_RETENTION_DAYS) || 90,
      controlRetentionDays: Number(process.env.ACCESS_LOG_CONTROL_RETENTION_DAYS) || 180
    }
  }
}
