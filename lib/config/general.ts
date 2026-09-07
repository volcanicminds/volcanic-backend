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
    mfa_policy: process.env.MFA_POLICY || 'OPTIONAL', // OPTIONAL, MANDATORY, ONE_WAY
    // How long a /auth/forgot-password reset token stays usable, in seconds.
    // Checked against `user.resetPasswordTokenAt` by /auth/reset-password.
    reset_password_token_ttl: Number(process.env.RESET_PASSWORD_TOKEN_TTL) || 3600,
    mfa_admin_forced_reset_email: null,
    mfa_admin_forced_reset_until: null,
    // Dove vivono i dati della piattaforma: registro dei tenant, utenti di sistema e, quando
    // i tenant non ci sono, i dati dell'applicazione. Vedi docs/CONFIGURATION_V5.md §1.
    control: {
      engine: process.env.CONTROL_ENGINE || 'postgres',
      url: process.env.DATABASE_URL || undefined,
      schema: process.env.DB_SCHEMA || 'public',
      pool: {
        max: Number(process.env.DB_POOL_MAX) || 10,
        idleTimeoutMs: Number(process.env.DB_POOL_IDLE_MS) || 30000
      }
    },
    // Assente = single tenant, ed è il default. Dichiarare il blocco È abilitare la tenancy:
    // non esiste un flag `enabled` che possa contraddire la strategia (in v4 esisteva, e il
    // resolver dichiarato non era quello eseguito: difetto D-11).
    tenants: null,
    manifest: {
      // opt-in: exposes GET /admin/manifest (gated by the `manifest` capability) for the admin console
      enabled: false
    },
    cache: {
      // opt-in: in-memory LRU+TTL cache for routes that declare `cache:`.
      // When enabled, ttl (default 3600s) and maxEntries (default 1000) can be set here.
      enabled: false
    }
  }
}
