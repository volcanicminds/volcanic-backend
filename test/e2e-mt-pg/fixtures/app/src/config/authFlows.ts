//
// The flows of the bench (T-12.39): the framework's, plus `oidc` as an identifier of the tenant
// plane, so that each tenant can log in through its own identity provider. The providers are the
// tenants' own, written through `/tenants/:id/identity-providers`: the deployment declares none.
//
// The password login of the other benches is unchanged: the second factor is the framework's
// optional TOTP, and no seeded account has one.
//
export default {
  tenant: {
    identify: ['password', 'oidc'],
    flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'], optional: true }] }],
    returnUrl: 'https://console.bench.test/login/return'
  },
  control: {
    identify: ['password'],
    flows: [{ roles: ['*'], stages: [{ anyOf: ['totp'], optional: true }] }]
  }
}
