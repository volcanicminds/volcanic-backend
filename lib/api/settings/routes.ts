//
// The settings a tenant's administrator chooses for the tenant (F49), inside what the platform
// allows. Stored in the tenant's own container; the platform's side of each rule is under
// `/system/*` and on the tenant's registry row.
//
export default {
  config: {
    title: 'Tenant settings',
    description: "Choices of the tenant's administrator, inside the limits set by the platform",
    controller: 'controller',
    tags: ['settings'],
    version: false
  },
  routes: [
    {
      method: 'GET',
      path: '/account-creation',
      roles: ['admin'],
      handler: 'settings.getAccountCreation',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Read how accounts are created here',
        description: 'The modes the platform allows, the choice of this tenant and the mode that applies',
        response: { 200: { $ref: 'accountCreationStateSchema#' } }
      }
    },
    {
      method: 'PUT',
      path: '/account-creation',
      roles: ['admin'],
      handler: 'settings.setAccountCreation',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Choose how accounts are created here',
        description: 'One of the modes the platform allows: invite, approval, open',
        body: { $ref: 'accountCreationChoiceBodySchema#' },
        response: { 200: { $ref: 'accountCreationStateSchema#' } }
      }
    }
  ]
}
