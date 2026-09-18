'use strict'

import dotenv from 'dotenv'
dotenv.config()

import dayjs from 'dayjs'
import yn from './lib/util/yn.js'
import logger from './lib/util/logger.js'
import * as mark from './lib/util/mark.js'
import { TranslatedError } from './lib/util/errors.js'
import * as loaderPlugins from './lib/loader/plugins.js'
import * as loaderRoles from './lib/loader/roles.js'
import * as loaderRouter from './lib/loader/router.js'
import { generateManifest } from './lib/manifest/generator.js'
import * as loaderHooks from './lib/loader/hooks.js'
import * as loaderSchemas from './lib/loader/schemas.js'
import * as loaderTracking from './lib/loader/tracking.js'
import * as loaderTranslation from './lib/loader/translation.js'
import * as loaderConfig from './lib/loader/general.js'
import { ensureGenesisAdmin } from './lib/loader/genesis.js'
import { assertControlSchemaCurrent } from './lib/loader/schemaVersion.js'
import * as loaderSchedules from './lib/loader/schedules.js'
import * as loaderTenant from './lib/loader/tenant.js'

import fastify, { FastifyInstance } from 'fastify'
import jwtValidator from '@fastify/jwt'
import swagger from '@fastify/swagger'
import swaggerUI from '@fastify/swagger-ui'
import { fastifySchedule } from '@fastify/schedule'

import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import compress from '@fastify/compress'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import rawBody from 'fastify-raw-body'
import cookie from '@fastify/cookie'

import require from './lib/util/require.js'
import { assertSecretStrength } from './lib/util/secret.js'
import { assertCorsOptions, withTenantHeader } from './lib/util/cors.js'
import { tenantsConfig } from './lib/util/tenancy.js'
import { assertPolicies, controlPolicy, floorPolicy, mfaAvailable, unavailableMandatory } from './lib/util/mfaPolicy.js'
import { configureCache, cache } from './lib/util/cache.js'

import type { TransferManagement } from './types/global.js'
// `lib/config/general.js` is deliberately NOT imported here (T-10.4). It is the framework's
// layer of defaults and `loaderConfig.load()` merges it with the project's; reading it directly
// skips that merge. A static import is also hoisted above `dotenv.config()`, so the
// `process.env` reads inside it ran before `.env` was loaded.
import { MfaPolicy } from './lib/config/constants.js'
import { isCookieMode } from './lib/util/credential.js'
import {
  defaultUserManager,
  defaultTokenManager,
  defaultTrackingManager,
  defaultMfaManager,
  defaultTransferManager,
  defaultTenantManager,
  defaultSystemUserManager,
  defaultImpersonationManager,
  defaultDestructionManager,
  defaultSessionManager
} from './lib/defaults/managers.js'

global.log = logger

// The logger was built while the imports above were evaluated, which is BEFORE `dotenv.config()`
// ran: ESM hoists every import above the body of the module. A `LOG_LEVEL` or `NODE_ENV` that
// lives in `.env` was therefore invisible to it, and production defaulted to `debug`. Now that
// the file is loaded, the level is asked again. After `global.log`, because the logger's
// level-change listener writes through it.
if (logger.level !== logger.getLogLevel()) {
  logger.level = logger.getLogLevel()
  logger.updateLevel()
}

async function addFastifyRouting(server: FastifyInstance) {
  log.trace('Add server routes')

  await loaderTenant.apply(server)
  await loaderHooks.apply(server)
  await loaderSchemas.apply(server)
  await loaderRouter.apply(server)
}

async function addFastifySwagger(server: FastifyInstance) {
  const { SWAGGER, SWAGGER_TITLE, SWAGGER_DESCRIPTION, SWAGGER_VERSION, SWAGGER_PREFIX_URL, SWAGGER_HOST } = process.env

  const loadSwagger = yn(SWAGGER, false)
  if (loadSwagger) {
    log.trace('Add swagger plugin')

    const fs = require('fs').promises
    const path = require('path')
    const logoPath = path.resolve(process.cwd(), 'logo-dark.png')

    let content = ''
    try {
      content = await fs.readFile(logoPath, { encoding: 'base64' })
    } catch (_e) {
      if (log.w) log.warn('Swagger logo not found at ' + logoPath)
    }

    await server.register(swagger, {
      swagger: {
        info: {
          title: SWAGGER_TITLE || 'Volcanic API Documentation',
          description: SWAGGER_DESCRIPTION || 'List of available APIs and schemes to use',
          version: SWAGGER_VERSION || '0.0.1'
        },
        host: SWAGGER_HOST || 'localhost:2230',
        schemes: ['https', 'http'],
        consumes: ['application/json'],
        produces: ['application/json']
      },
      openapi: {
        info: {
          title: SWAGGER_TITLE || 'Volcanic API Documentation',
          description: SWAGGER_DESCRIPTION || 'List of available APIs and schemes to use',
          version: SWAGGER_VERSION || '0.0.1'
        },
        servers: [
          {
            url: SWAGGER_HOST || 'http://localhost:2230'
          }
        ],
        components: {
          securitySchemes: {
            Bearer: {
              type: 'http',
              scheme: 'bearer'
            }
          }
        }
      }
    })

    await server.register(swaggerUI, {
      routePrefix: SWAGGER_PREFIX_URL || '/api-docs',
      uiConfig: {
        docExpansion: 'list',
        deepLinking: true,
        defaultModelsExpandDepth: 1
      },
      logo: {
        type: 'image/png',
        content: Buffer.from(content, 'base64')
      },
      theme: {
        title: SWAGGER_TITLE
      }
    })
  }
}

async function addFastifySchedule(server: FastifyInstance) {
  const { scheduler = false } = global.config?.options || {}
  if (scheduler) {
    log.trace('Add scheduler plugin')

    await server.register(fastifySchedule)
  }
}

const preload = async () => {
  global.config = await loaderConfig.load()
  global.t = loaderTranslation.load()
  global.roles = await loaderRoles.load()
  // The control catalogue is a separate map, not extra entries in `roles` (T-4.1): a role
  // that can suspend a customer and a role that can read a customer's orders are not two
  // rows of one list.
  global.systemRoles = await loaderRoles.loadSystem()
}

const start = async (decorators = {}) => {
  if (!global.config) await preload()

  const begin = new Date().getTime()
  mark.print(logger)

  // Configure the in-memory per-route cache and expose it (`global.cache` + the
  // `invalidateCache`/`cache` package exports). Logs the effective config.
  configureCache(global.config?.options?.cache)
  global.cache = cache

  const { tracking, trackingConfig } = await loaderTracking.load()
  global.tracking = tracking
  global.trackingConfig = trackingConfig

  // Fastify's own request logger, off unless asked for (T-10.10). `LOG_FASTIFY` was in the
  // README's environment table while the only line reading it was commented out, so setting
  // it did nothing: a documented variable read by nobody, which is D-11 again.
  const server: FastifyInstance = fastify({ logger: yn(process.env.LOG_FASTIFY, false) })
  global.server = server

  const { HOST: host = '0.0.0.0', PORT: port = '2230' } = process.env
  // One hour, not fifteen days (T-10.39): the browser session renews itself from the refresh
  // token, so the access token only has to outlive a request, and a stolen one is worth an hour.
  // Lowered only once renewal existed in both modes, or the default would have been a logout.
  const {
    JWT_SECRET = '',
    JWT_EXPIRES_IN = '1h',
    JWT_REFRESH_SECRET = '',
    JWT_REFRESH_EXPIRES_IN = '180d'
  } = process.env

  // Read before anything is registered: a value that is not a mode stops the boot here, not
  // at the first request (lib/util/credential.ts).
  const cookieMode = isCookieMode()
  const plugins = await loaderPlugins.load()

  if (plugins?.rawBody) await server.register(rawBody, plugins.rawBody || {})
  if (cookieMode && !plugins?.cookie) {
    // Cookie mode is the default (T-10.37), so this is what a project meets when its own
    // config/plugins.ts disables the plugin: every login would fail on `reply.setCookie`.
    throw new Error('AUTH_MODE=COOKIE, the default, needs the `cookie` plugin: enable it in config/plugins.ts or set AUTH_MODE=BEARER')
  }
  if (plugins?.cookie) {
    // Signed cookies (the sessions in COOKIE mode) require a strong secret.
    if (cookieMode) {
      assertSecretStrength('COOKIE_SECRET', process.env.COOKIE_SECRET, {
        prod: process.env.NODE_ENV === 'production'
      })
    }
    await server.register(cookie, plugins.cookie || {})
  }
  if (plugins?.helmet) await server.register(helmet, plugins.helmet || {})

  if (plugins?.rateLimit) {
    await server.register(rateLimit, plugins.rateLimit || {})
    server.setNotFoundHandler(
      {
        preHandler: server.rateLimit({
          max: 30,
          timeWindow: 30000
        })
      },
      function (_req, reply) {
        reply.code(404).send()
      }
    )
  }

  server.setErrorHandler(function (error, _req, reply) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = error as any
    // Preserve the status a controller already set via `reply.status(4xx)` before
    // sending an Error. Without this, `reply.status(403).send(new Error(...))`
    // collapses to 500 (Fastify only auto-derives the status when it is still 200).
    const fromReply = reply.statusCode && reply.statusCode >= 400 ? reply.statusCode : 0
    const statusCode = err.statusCode || err.status || err.err?.statusCode || err.err?.status || fromReply || 500
    const errorType = err.error || err.err?.error || err.code || err.name || 'Error'
    const hide = yn(process.env.HIDE_ERROR_DETAILS, process.env.NODE_ENV === 'production')

    const body = {
      statusCode,
      error: errorType,
      ...(err?.code && typeof err.code === 'string' ? { code: err.code } : {}),
      ...(!hide && err?.message ? { message: err.message } : {})
    }

    if (statusCode >= 500) log.error(error)
    reply.code(statusCode).send(body)
  })

  if (plugins?.multipart) await server.register(multipart, plugins.multipart || {})
  if (plugins?.cors) {
    // Checked on the EFFECTIVE options, not on the framework default: a consuming project
    // that writes its own `config/plugins.ts` replaces that default whole, and the one
    // combination that must never reach production has to be caught wherever it was written.
    // The tenant header joins the allowlist where the backend reads it (T-10.15): without it a
    // browser console on another origin cannot even send its login.
    const corsOptions = withTenantHeader(plugins.cors, tenantsConfig())
    assertCorsOptions(corsOptions, { prod: process.env.NODE_ENV === 'production' })
    await server.register(cors, corsOptions || {})
  }
  if (plugins?.compress) await server.register(compress, plugins.compress || {})
  // Static file serving (e.g. a public uploads folder in dev; behind nginx/CDN in
  // prod). Dynamically imported so consumers that don't use it needn't install it.
  // Accepts a single options object or an array of them (multiple roots/prefixes).
  if (plugins?.static) {
    const { default: fastifyStatic } = await import('@fastify/static')
    const mounts = Array.isArray(plugins.static) ? plugins.static : [plugins.static]
    for (let i = 0; i < mounts.length; i++) {
      await server.register(fastifyStatic, { decorateReply: i === 0, ...mounts[i] })
    }
  }

  // Fail fast on missing/weak signing secrets before registering JWT.
  // Missing is always fatal; weak is fatal in production, a warning otherwise.
  const prod = process.env.NODE_ENV === 'production'
  assertSecretStrength('JWT_SECRET', JWT_SECRET, { prod })

  if (log.t) log.trace(`Add JWT - expiresIn: ${JWT_EXPIRES_IN}`)
  await server.register(jwtValidator, {
    secret: JWT_SECRET,
    sign: { expiresIn: JWT_EXPIRES_IN }
  })

  // The refresh token stopped being a JWT in T-11.6: it is an opaque secret whose only meaning
  // is a row in the session registry, so there is no second namespace to register and no second
  // signing secret to keep strong. `JWT_REFRESH=false` still turns renewal off, and what decides
  // whether it is available at all is now the registry itself (F28, lib/util/renewal.ts).
  //
  // `JWT_REFRESH_SECRET` and `JWT_REFRESH_EXPIRES_IN` are read here only to refuse them out
  // loud: a deployment that sets them is describing a mechanism this version no longer has, and
  // silence would let it believe the session lasts what that variable says.
  if (JWT_REFRESH_SECRET || JWT_REFRESH_EXPIRES_IN !== '180d') {
    log.warn(
      'JWT_REFRESH_SECRET and JWT_REFRESH_EXPIRES_IN are ignored since 5.0: the refresh token is opaque and its ' +
        'lifetime comes from the `sessions` block (SESSION_IDLE_TTL, SESSION_ABSOLUTE_TTL). See docs/AUTHORIZATION_V5.md.'
    )
  }

  await addFastifySwagger(server)
  await addFastifyRouting(server)
  await addFastifySchedule(server)

  const schedules = loaderSchedules.load()

  // Decorators with Defaults (Null Object Pattern)
  decorators = {
    userManager: defaultUserManager,
    tokenManager: defaultTokenManager,
    trackingManager: defaultTrackingManager,
    mfaManager: defaultMfaManager,
    transferManager: defaultTransferManager,
    tenantManager: defaultTenantManager,
    systemUserManager: defaultSystemUserManager,
    impersonationManager: defaultImpersonationManager,
    destructionManager: defaultDestructionManager,
    sessionManager: defaultSessionManager,
    ...decorators
  }

  // Register decorators on Server instance (Dependency Injection)
  await Promise.all(
    Object.keys(decorators || {}).map(async (key) => {
      await server.decorate(key, (decorators as Record<string, unknown>)[key])
    })
  )

  // After the injection, because a project may bring its own manager: a policy that demands a
  // second factor this build cannot issue is a locked door with no key, and the first login is
  // where everyone would find out (T-10.19).
  const mfaGap = unavailableMandatory({
    floor: floorPolicy(),
    control: controlPolicy(),
    implemented: mfaAvailable((decorators as Record<string, unknown>).mfaManager)
  })
  if (mfaGap) throw new Error(mfaGap)

  // Before anything writes: an instance does not serve traffic on a schema its code does not
  // match (T-5.4). It runs BEFORE the genesis reconciliation on purpose, because that one
  // writes into tables whose shape this check is what guarantees.
  await assertControlSchemaCurrent(server)

  // Provision/verify the admin apex before serving (single-tenant, data layer present).
  await ensureGenesisAdmin(server)

  if (server['transferManager']) {
    const tm = server['transferManager'] as TransferManagement
    let transferPath: string | null = null
    if (tm?.isImplemented()) {
      try {
        transferPath = tm.getPath()
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (log.w) log.error(`Startup: TRANSFER MANAGER FAILED: ${message}`)
      }
    } else {
      if (log.w) log.warn('Transfer Manager 📂 not available')
    }

    global.transferPath = transferPath

    if (global.transferPath) {
      if (log.i) log.info(`Transfer Manager 📂 mounted at ${global.transferPath}`)

      // Register TUS route handler logic
      // Note: We bypass the body parser for this specific path to allow streaming
      await server.register(
        async (instance) => {
          instance.addContentTypeParser('*', (_req, _payload, done) => {
            done(null)
          })

          instance.all('*', async (req, reply) => {
            await tm.handle(req.raw, reply.raw)
            // We hijack because TUS writes the response directly
            reply.hijack()
          })
        },
        { prefix: global.transferPath }
      )
    }
  }
  // ------------------------------------

  // --- STARTUP CHECKS (Admin MFA Reset) ---
  const resetEmail = process.env.MFA_ADMIN_FORCED_RESET_EMAIL
  const resetUntil = process.env.MFA_ADMIN_FORCED_RESET_UNTIL

  if (resetEmail && resetUntil) {
    const now = dayjs()
    const untilDate = dayjs(resetUntil)

    if (untilDate.isValid()) {
      const diffMinutes = untilDate.diff(now, 'minute')

      if (diffMinutes < 0) {
        if (log.i) log.info('Startup: MFA Admin Reset window expired. Ignoring.')
      } else if (diffMinutes > 10) {
        if (log.f)
          log.fatal(
            `Startup Error: MFA_ADMIN_FORCED_RESET_UNTIL is too far in the future (>10 min). Fix configuration.`
          )
        process.exit(1)
      } else {
        if (log.w) log.warn(`Startup: executing FORCE MFA RESET for admin ${resetEmail}`)
        try {
          // `forceDisableMfaForAdmin(email)` was called here and exists on no manager: the
          // break-glass path threw on every boot that used it and reported a generic failure, so
          // it had never worked (found by typing the injected managers, F7). What the contract
          // has is `forceDisableMfa(ctx, userId)`, which needs a container and an id, resolved
          // the way the genesis resolves them (lib/loader/genesis.ts): the control plane, which
          // is where the platform's own administrator lives.
          const provider = (server as unknown as Record<string, { control(): Promise<unknown> } | undefined>)['provider']
          const users = server['userManager']
          if (!provider || !users?.isImplemented?.()) {
            if (log.e) log.error('Startup: no data layer is loaded, cannot reset MFA')
          } else {
            const ctx = (await provider.control()) as never
            const target = await users.retrieveUserByEmail(ctx, resetEmail)
            if (!target?.id) {
              if (log.e) log.error(`Startup: MFA RESET FAILED, no user with address ${resetEmail}`)
            } else {
              await users.forceDisableMfa(ctx, target.id)
              if (log.w) log.warn(`Startup: MFA RESET SUCCESSFUL for ${resetEmail}`)
            }
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (log.e) log.error(`Startup: MFA RESET FAILED: ${message}`)
        }
      }
    }
  }
  // -------------------------------------------------

  // --- MANIFEST DUMP (CI snapshot, decoupled from a live BE) ---
  // Opt-in via env: MANIFEST_DUMP=<path> writes the manifest to file. With
  // MANIFEST_DUMP_EXIT=true the server skips listen() and returns (pure dump command).
  const manifestDumpPath = process.env.MANIFEST_DUMP
  if (manifestDumpPath) {
    try {
      await server.ready()
      const { writeFileSync } = await import('node:fs')
      // One manifest per console plane (T-10.14): MANIFEST_DUMP_PLANE=control dumps the platform
      // console's, which a build cannot pull in cookie mode (no integration token on that plane).
      const plane = process.env.MANIFEST_DUMP_PLANE === 'control' ? 'control' : 'tenant'
      writeFileSync(manifestDumpPath, JSON.stringify(generateManifest(server, { plane }), null, 2))
      if (log.i) log.info(`Manifest 📄 dumped to ${manifestDumpPath}`)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (log.e) log.error(`Manifest dump failed: ${message}`)
    }
    if (yn(process.env.MANIFEST_DUMP_EXIT, false)) {
      await server.close()
      // Close the data-layer connection too, otherwise it keeps the event loop alive
      // and the process never exits. Runtime access only (no data-layer import).
      try {
        await (global as any).connection?.destroy?.()
      } catch {
        /* best-effort */
      }
      return server
    }
  }
  // -------------------------------------------------

  await server
    .listen({
      port: Number(port),
      host: host
    })
    .then((address) => {
      if (log.i) {
        // Milliseconds to seconds. It was divided by 100, so a boot of 1.5s printed "15s".
        const elapsed = (new Date().getTime() - begin) / 1000
        log.info(`All stuff loaded 🟢 in ${elapsed}s`)
      }

      // The policy the auth controllers ENFORCE, read from where they read it (T-10.4). This
      // used to read the framework's own defaults file, so a project that set
      // `mfa_policy: 'MANDATORY'` in its config was told at boot that MFA was optional.
      // Two planes since T-10.19: the deployment value is the floor, and the control plane may
      // be stricter. A tenant's own value lives in its registry row and is resolved per request.
      // A value that is written and is not a policy stops the boot, as a bad `AUTH_MODE` does:
      // reading it as "the default" is how a setting comes to mean the opposite of what it says.
      try {
        assertPolicies()
      } catch (error) {
        if (log.f) log.fatal(`Startup Security: ${(error as Error).message}`)
        process.exit(1)
      }
      const floor = floorPolicy()
      const controlPlane = controlPolicy()
      const stated = controlPlane === floor ? `${floor}` : `${floor}, control plane ${controlPlane}`
      if (log.w && (floor !== MfaPolicy.OPTIONAL || controlPlane !== floor)) {
        log.warn(`Security MFA 🔑 enforced to ${stated}`)
      } else if (log.i) {
        log.info(`Security MFA 🔑 set to ${stated}`)
      }

      // T-11.15. `reset_external_id_on_login` rotates the subject's public identifier at every
      // login, which was the only revocation v4 had. With a session registry it is the hammer
      // used as a routine: logging in from a phone drops the session on the laptop, and it also
      // changes an identifier that integrations may have stored. The option stays, because a
      // deployment may want exactly that, but it stops being a silent default nobody chose.
      if (log.w && config?.options?.reset_external_id_on_login) {
        log.warn(
          'Security 🔑 reset_external_id_on_login is on: every login closes the other sessions of that user ' +
            'and changes the externalId other systems may hold. With the session registry, /auth/sessions and ' +
            '/auth/invalidate-tokens do the same job without touching the identity.'
        )
      }

      if (log.i) {
        log.info(`Server up 🚀 at ${address}`)

        const loadSwagger = yn(process.env.SWAGGER, false)
        if (loadSwagger) {
          log.info(`Swagger ✨ available at ${address}${process.env.SWAGGER_PREFIX_URL || '/api-docs'}`)
        }
      }
    })

  await loaderSchedules.start(server, schedules)
  return server
}

export type {
  global,
  FastifyReply,
  FastifyRequest,
  FastifyInstance,
  AuthenticatedUser,
  AuthenticatedToken,
  Role,
  Data,
  Roles,
  Route,
  RouteConfig,
  GeneralConfig,
  ConfiguredRoute,
  UserManagement,
  TokenManagement,
  TrackingManagement,
  // The session registry (T-11.4). A consumer that injects its own store implements this, and
  // a consumer that lists a user's devices reads `Session` without describing it again.
  SessionManagement,
  Session,
  SessionScope,
  SessionLookup,
  MfaManagement,
  TransferManagement,
  TransferCallback,
  JobSchedule,
  // The handles a route receives. A consuming project types its own service layer with
  // these — without them the only way to name `req.tenant` is `any`, and a seam typed `any`
  // is a seam where the control plane and a container are interchangeable, which is exactly
  // the confusion the two brands exist to prevent.
  ControlHandle,
  TenantHandle,
  DataHandle,
  Tenant,
  JobRun,
  JobScope
} from './types/global.js'

export { MfaPolicy } from './lib/config/constants.js'

export { yn, preload, start, TranslatedError }

// The choice of container, as a function a consuming project can call (T-10.1).
//
// Until it was exported, the only way for an application to name the handle of a request was
// to write the choice again by hand, and the shortest way to write it is
// `req.tenant ?? req.control`: invariant 3 inverted, because with tenancy on a request that
// lost its context then reads the control plane instead of failing. `NoDataContextError`
// travels with it, because a consumer that catches it is catching a framework bug and not a
// bad request.
export { dataContext, NoDataContextError } from './lib/util/tenancy.js'
export { generateManifest, buildManifest } from './lib/manifest/generator.js'
export { invalidateCache, cache } from './lib/util/cache.js'
export type { RouteCache, NormalizedRouteCache } from './types/global.js'
