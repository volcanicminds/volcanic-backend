import { isTenancyEnabled } from '../../util/tenancy.js'
import { exportRateLimit } from '../../util/tenantExport.js'

//
// A tenant's admin takes the tenant's data out: one `client` package, which replaces the previous
// one of this plane, and its download (lib/util/tenantExport.ts). The tenant is the token's, never
// a parameter's. Mounted only where there are tenants: without them the data is the platform's,
// and its export is the control plane's.
//
export default {
  config: {
    title: 'Exports',
    description: "The tenant's own data, as a package to download",
    controller: 'controller',
    tags: ['exports'],
    enable: isTenancyEnabled(),
    version: false
  },
  routes: [
    {
      method: 'POST',
      path: '/',
      roles: ['admin'],
      handler: 'exports.create',
      middlewares: ['global.isAuthenticated'],
      freshAuth: true,
      rateLimit: exportRateLimit(),
      config: {
        title: 'Export this tenant',
        description:
          'Writes a client package of this tenant: the dump without credentials, the parts of its packages and a manifest. It replaces the previous export of this plane, and counts against TENANT_EXPORT_MAX'
      }
    },
    {
      method: 'GET',
      path: '/:package',
      roles: ['admin'],
      handler: 'exports.download',
      middlewares: ['global.isAuthenticated'],
      freshAuth: true,
      rateLimit: exportRateLimit(),
      config: {
        title: 'Download an export',
        description: 'One tar file of a client package of this tenant, checked against its manifest first; any other package answers 404',
        params: { $ref: 'exportPackageParamsSchema#' }
      }
    }
  ]
}
