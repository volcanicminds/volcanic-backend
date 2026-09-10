/* eslint-disable @typescript-eslint/no-explicit-any */
import { FastifyReply, FastifyRequest } from 'fastify'
import { httpError } from '../util/httpError.js'

//
// The apex of whichever plane the request is on (T-4.1).
//
// `admin` inside a tenant, `system:admin` on the platform. Asking only for the tenant `admin`
// would mean a control route guarded by this middleware is unreachable by the only identity
// that is allowed to act on the platform.
//
export function preHandler(req: FastifyRequest, res: FastifyReply, done: any) {
  try {
    const isTenantAdmin = !!req.user?.id && req.hasRole(roles.admin)
    const isPlatformAdmin = !!req.systemUser?.id && req.roles().includes('system:admin')
    if (isTenantAdmin || isPlatformAdmin) {
      return done()
    }

    throw new Error('User without this privilege')
  } catch (err) {
    if (log.e) log.error(`Upps, something just happened ${err}`)
    // Structured body so the 403 status is preserved (see isAuthenticated note).
    res.code(403).send(httpError(403, 'User without this privilege', 'FORBIDDEN'))
  }
}
