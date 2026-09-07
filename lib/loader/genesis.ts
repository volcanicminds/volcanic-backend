import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import type { DataHandle, DataProvider } from '../../types/global.js'
import { includesRole, isFounder } from '../util/authz.js'
import { isTenancyEnabled } from '../util/tenancy.js'

// Random credential for a generated founder. base64url is alphanumeric; the suffix
// satisfies any upper/lower/digit/symbol policy. Printed once; rotate after first login.
function generatePassword(): string {
  return crypto.randomBytes(24).toString('base64url') + 'aA1!'
}

/**
 * Whether this container already has a sovereign.
 *
 * Asked of the data, not of the environment: that is the whole of T-4.3. A container that
 * predates the column simply has none, and the next genesis run gives it one.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function founderExists(um: any, ctx: DataHandle): Promise<boolean> {
  try {
    return Number(await um.countQuery(ctx, { 'isFounder:eq': true })) > 0
  } catch (e) {
    // A manager that cannot answer the question must not be read as "no founder yet": that
    // would be the answer that mints one.
    if (log?.e) log.error(`Startup: could not check for an existing founder: ${(e as Error)?.message}`)
    return true
  }
}

export interface GenesisOptions {
  // Called instead of process.exit(1) on the fail-fast path (injected by tests).
  onFatal?: (message: string) => void
}

/**
 * Ensure the instance never boots with zero admins (single-tenant only; multi-tenant
 * tenant admins come from provisioning and the system founder is seeded out-of-band).
 * Runs against the default connection (public schema) via the injected userManager.
 *
 * - `ADMIN_EMAIL` set → create it (as the sovereign founder) if missing, or promote it
 *   to admin if it exists without the role; no-op if it is already an admin.
 * - `ADMIN_EMAIL` unset → allowed only when an admin already exists, otherwise fail-fast.
 */
export async function ensureGenesisAdmin(server: FastifyInstance, opts: GenesisOptions = {}): Promise<void> {
  // The handle is asked for, not assumed (T-3.3). v4 read `global.connection` here, which
  // is the same implicit context invariant 3 forbids at request time; worse, once that
  // global stopped existing the guard turned this whole reconciliation into a no-op, and
  // an instance could boot with no administrator at all without saying so.
  const provider = (server as unknown as Record<string, DataProvider | undefined>)['provider']
  if (!provider) return // no live data layer (e.g. a core-only boot)
  const ctx = (await provider.control()) as DataHandle

  // Which apex the deployment needs (T-4.1). With tenants declared, the first identity to
  // exist is a PLATFORM one: a tenant admin is provisioned with its tenant, and seeding one
  // here would put an application user in the container that administers the application.
  if (isTenancyEnabled()) return await ensureGenesisSystemAdmin(server, ctx, opts)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const um = (server as any)?.['userManager']
  if (!um?.isImplemented?.()) return

  const onFatal =
    opts.onFatal ||
    ((message: string) => {
      if (log?.f) log.fatal(message)
      process.exit(1)
    })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminCode = (global as any).roles?.admin?.code || 'admin'
  const email = process.env.ADMIN_EMAIL?.trim()

  if (!email) {
    const count = Number(await um.countQuery(ctx, { 'roles:in': adminCode }))
    if (count === 0) {
      onFatal('Startup: no admin exists and ADMIN_EMAIL is not set to bootstrap one. Set ADMIN_EMAIL.')
    }
    return
  }

  const existing = await um.retrieveUserByEmail(ctx, email)
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (!includesRole(existing.roles, adminCode)) {
      patch.roles = [...(existing.roles || []), adminCode]
    }

    // The sovereignty is written into the row, once (T-4.3). If some other row already
    // carries it, this one does NOT get it: changing an environment variable must not be
    // able to mint a second sovereign, which is the whole reason the flag stopped being an
    // env comparison. Moving it is a deliberate act, not a redeploy.
    if (!isFounder(existing) && !(await founderExists(um, ctx))) {
      patch.isFounder = true
    } else if (!isFounder(existing) && log?.w) {
      log.warn(`Startup: ${email} is admin, but the sovereign founder is another row. ADMIN_EMAIL no longer moves it.`)
    }

    if (Object.keys(patch).length) {
      await um.updateUserById(ctx, existing.getId(), patch)
      if (log?.i) log.info(`Startup: reconciled ${email} (${Object.keys(patch).join(', ')}).`)
    }
    return
  }

  const envPassword = process.env.ADMIN_PASSWORD
  const password = envPassword || generatePassword()
  const created = await um.createUser(ctx, {
    email,
    username: email,
    password,
    roles: [adminCode],
    // The first identity on an empty container is the sovereign one, and from here on the
    // question "is this the founder?" is answered by this column and never by the
    // environment (defect D-27).
    isFounder: !(await founderExists(um, ctx))
  })
  await um.userConfirmation(ctx, created)
  if (!envPassword) {
    // The generated secret goes to stdout only — never through the structured logger,
    // which may be shipped, retained, or indexed. Set ADMIN_PASSWORD to avoid disclosure.
    process.stdout.write(
      `\n[genesis] Created sovereign founder ${email} with a generated password: ${password}\n[genesis] Rotate it after first login.\n\n`
    )
    if (log?.w) log.warn(`Startup: created sovereign founder ${email} with a generated password (printed to stdout).`)
  } else if (log?.i) {
    log.info(`Startup: created sovereign founder ${email}.`)
  }
}

/**
 * The first platform administrator, on a deployment that has tenants.
 *
 * Same contract as the single-tenant apex and the same reason for existing: an instance that
 * boots with nobody able to administer it has no way back in, and one that boots with an
 * administrator nobody asked for is worse. So `ADMIN_EMAIL` creates the founding system user
 * if it is missing, and its absence is fatal only when no system user exists at all.
 *
 * This is also the one place `ADMIN_EMAIL` is still allowed to decide who is sovereign
 * (T-4.3): from here on, being a founder is a property of a row, not of the environment the
 * process happens to have been started with.
 */
async function ensureGenesisSystemAdmin(
  server: FastifyInstance,
  ctx: DataHandle,
  opts: GenesisOptions
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sm = (server as any)?.['systemUserManager']
  if (!sm?.isImplemented?.()) return

  const onFatal =
    opts.onFatal ||
    ((message: string) => {
      if (log?.f) log.fatal(message)
      process.exit(1)
    })

  const email = process.env.ADMIN_EMAIL?.trim()

  if (!email) {
    const count = Number(await sm.countQuery(ctx, {}))
    if (count === 0) {
      onFatal('Startup: this deployment has tenants and no platform administrator, and ADMIN_EMAIL is not set to bootstrap one.')
    }
    return
  }

  const existing = await sm.retrieveSystemUserByEmail(ctx, email)
  if (existing) {
    if (!includesRole(existing.roles, 'system:admin')) {
      await sm.updateSystemUserById(ctx, existing.id, { roles: [...(existing.roles || []), 'system:admin'] })
      if (log?.i) log.info(`Startup: promoted ${email} to system:admin.`)
    }
    return
  }

  const envPassword = process.env.ADMIN_PASSWORD
  const password = envPassword || generatePassword()
  await sm.createSystemUser(ctx, { email, password, roles: ['system:admin'] })

  if (!envPassword) {
    // stdout only, never the structured logger, which may be shipped, retained or indexed.
    process.stdout.write(
      `\n[genesis] Created platform administrator ${email} with a generated password: ${password}\n[genesis] Rotate it after first login.\n\n`
    )
    if (log?.w) log.warn(`Startup: created platform administrator ${email} with a generated password (printed to stdout).`)
  } else if (log?.i) {
    log.info(`Startup: created platform administrator ${email}.`)
  }
}
