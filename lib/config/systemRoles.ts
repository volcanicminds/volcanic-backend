import type { SystemRole } from '../../types/global.js'

//
// The built-in control-scope roles (docs/AUTHORIZATION_V5.md §3).
//
// Three, and all protected: a consumer may relabel them, never redefine a code or the
// capabilities behind it. They live in their own catalogue, not next to `admin` and
// `public`: a role that can suspend a customer and a role that can read a customer's orders
// are not two entries of one list, and keeping them in one list is how the second silently
// becomes the first.
//
// `tenants:destroy` belongs to no built-in role except the superuser, on purpose: creating a
// tenant and destroying its data are not the same job, and an operator who does the first
// must not automatically do the second (§4).
//
const systemRoles: SystemRole[] = [
  {
    code: 'system:admin',
    name: 'System admin',
    description: 'Superuser of the control scope. Appended to every control route, as `admin` is in the tenant scope',
    // No list: the superuser holds the catalogue implicitly, exactly as `admin` does.
    capabilities: []
  },
  {
    code: 'system:operator',
    name: 'System operator',
    description: 'Day-to-day platform operations: the registry, provisioning, impersonation',
    capabilities: ['tenants', 'tenants:read', 'tenants:impersonate']
  },
  {
    code: 'system:auditor',
    name: 'System auditor',
    description: 'Read-only oversight of the platform',
    capabilities: ['tenants:read', 'manifest']
  }
]

export default systemRoles
