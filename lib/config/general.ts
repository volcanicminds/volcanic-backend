export default {
  name: 'general',
  options: {
    allow_multiple_admin: false,
    admin_can_change_passwords: false,
    reset_external_id_on_login: false,
    scheduler: false,
    embedded_auth: true,
    mfa_policy: process.env.MFA_POLICY || 'OPTIONAL', // OPTIONAL, MANDATORY, ONE_WAY
    mfa_admin_forced_reset_email: null,
    mfa_admin_forced_reset_until: null
  }
}
