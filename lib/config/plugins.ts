import { corsOriginFromEnv, corsCredentialsFor } from '../util/cors.js'
import { isCookieMode } from '../util/credential.js'

// The allowlist is a deployment decision, not a source-code one: it changes between the
// developer's laptop, the staging host and production, and a value compiled into the
// framework would be wrong in at least two of the three (defect D-16). `credentials` follows
// the allowlist and is never granted against a wildcard, because no browser honours that pair.
const corsOrigin = corsOriginFromEnv(process.env.CORS_ORIGINS)

export default [
  {
    name: 'cors',
    enable: true,
    options: {
      origin: corsOrigin,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      maxAge: 31536000,
      credentials: corsCredentialsFor(corsOrigin),
      allowedHeaders: [
        'Accept',
        'Accept-Language',
        'Content-Language',
        'Content-Type',
        'Content-Length',
        'Authorization',
        'Origin',
        'v-total',
        'v-count',
        'v-page',
        'v-pageSize',
        'v-pageCount'
      ],
      exposedHeaders: [
        'Accept',
        'Accept-Language',
        'Content-Language',
        'Content-Type',
        'Content-Length',
        'Authorization',
        'Origin',
        'v-total',
        'v-count',
        'v-page',
        'v-pageSize',
        'v-pageCount'
      ]
    }
  },
  {
    name: 'rateLimit',
    // Registered with `global: false`: it limits only the routes that declare `rateLimit`, which
    // every route taking a secret does (`lib/api/auth/routes.ts`, `lib/api/system/routes.ts`).
    // The store is in process memory, so behind several instances each one counts on its own.
    enable: true,
    options: { global: false }
  },
  {
    name: 'helmet',
    enable: true,
    options: {}
  },
  {
    name: 'compress',
    enable: false,
    options: {}
  },
  {
    name: 'multipart',
    enable: false,
    options: {}
  },
  {
    // Serve a static folder (e.g. public uploads in dev; nginx/CDN in prod).
    // Options are @fastify/static's: { root, prefix?, decorateReply? }, or an array
    // of them for multiple mounts. Disabled by default.
    name: 'static',
    enable: false,
    options: {}
  },
  {
    name: 'rawBody',
    enable: false,
    options: {}
  },
  {
    name: 'cookie',
    // Required by the default mode (T-10.37). A project that disables it while in cookie
    // mode is refused at boot, not at its first login.
    enable: isCookieMode(),
    options: {
      secret: process.env.COOKIE_SECRET,
      parseOptions: {}
    }
  }
]
