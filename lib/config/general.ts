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
    // The emergency MFA reset of the admin is NOT configured here (T-10.6). It is a break-glass
    // action bounded to ten minutes, so it lives in the environment of one deploy
    // (`MFA_ADMIN_FORCED_RESET_EMAIL`, `MFA_ADMIN_FORCED_RESET_UNTIL`, read in `index.ts`) and
    // never in a committed file. The two keys that stood here were read by nobody.
    // Quanto dura una sessione di impersonificazione, in secondi (T-4.2). Trenta minuti,
    // non le ventiquattro ore della v4: la durata è la sola cosa che limita una sessione che
    // nessuno revoca a mano. Il massimo assoluto è quattro ore ed è applicato in codice.
    impersonation_ttl: Number(process.env.IMPERSONATION_TTL) || 1800,
    // Dove finiscono gli export dei contenitori (T-6.2). È configurazione e non un campo
    // della richiesta: una rotta raggiungibile via HTTP non sceglie dove si scrive su disco.
    export_directory: process.env.EXPORT_DIRECTORY || './data/exports',
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
