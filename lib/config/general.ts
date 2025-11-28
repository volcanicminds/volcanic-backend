export default {
  name: 'general',
  enable: true,
  options: {
    allow_multiple_admin: false,
    reset_external_id_on_login: false,
    scheduler: false,
    embedded_auth: true,
    mfa_policy: process.env.MFA_POLICY || 'OPTIONAL' // OPTIONAL, MANDATORY, ONE_WAY
  }
}
