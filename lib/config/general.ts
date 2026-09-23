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
    // Il piano di controllo può essere più stretto del resto del deployment, mai più largo
    // (T-10.19): gli operatori sono quelli che possono distruggere il contenitore di un cliente.
    // Assente vale il valore qui sopra, che fa da pavimento; un tenant fa lo stesso nel `config`
    // della sua riga di registro, e una politica più debole del pavimento viene rifiutata.
    system_mfa_policy: process.env.SYSTEM_MFA_POLICY || undefined,
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
    },
    // Il registro delle sessioni (T-11.13). Acceso quando il data layer c'è: senza registro il
    // rinnovo non esiste, invece di esistere e non proteggere (F28). Le durate sono in secondi,
    // e ognuna risponde a una domanda diversa: `idleTtl` chiude una sessione che nessuno usa,
    // `absoluteTtl` chiude una sessione che si rinnova per sempre, `graceSeconds` è la
    // tolleranza che evita di scambiare due schede che rinnovano insieme per un furto.
    sessions: {
      idleTtl: Number(process.env.SESSION_IDLE_TTL) || 2592000,
      absoluteTtl: Number(process.env.SESSION_ABSOLUTE_TTL) || 15552000,
      graceSeconds: Number(process.env.SESSION_GRACE_SECONDS) || 10
    },
    // The access log (F44). The two retentions differ because they answer to different readers:
    // 90 days cover a quarterly review and the usual time an incident takes to be noticed, 180
    // for platform operators follow the Italian DPA's rule on system administrators (27 November
    // 2008), which asks for at least six months. A reading for the consumer's privacy adviser to
    // confirm, not legal advice. `ip: 'none'` stores no address at all.
    // Who may create an account in a tenant (F49): the modes a tenant may choose from, and the one
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
