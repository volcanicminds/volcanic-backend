import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import type { ControlHandle, DataHandle, DataProvider } from '../../types/global.js'
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
 * Asked of the data, not of the environment. A container that
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

/**
 * Whether the plane already has its apex, asked before `ADMIN_EMAIL` promotes an existing row.
 *
 * A row the variable creates gets the deployment's password; a row it promotes keeps whatever
 * password its holder chose. So a promotion happens only on a plane with no apex at all, the
 * recovery it exists for: otherwise whoever can give an account that address (a `users` or a
 * `system-users` holder, a public registration) would name the next admin at the next restart.
 * A count that fails answers yes, the answer that promotes nobody.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function apexExists(manager: any, ctx: DataHandle, code: string, where: Record<string, unknown> = {}): Promise<boolean> {
  try {
    return Number(await manager.countQuery(ctx, { 'roles:arrayContains': code, ...where })) > 0
  } catch (e) {
    if (log?.e) log.error(`Startup: could not count the holders of ${code}: ${(e as Error)?.message}`)
    return true
  }
}

const promotesNobody = (email: string, code: string) => {
  if (log?.w) log.warn(`Startup: ${email} does not hold ${code} and others do, so ADMIN_EMAIL promotes nobody. Grant it through the API.`)
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
 *   to admin if it exists without the role and nobody holds it; no-op if it is already an admin.
 * - `ADMIN_EMAIL` unset → allowed only when an admin already exists, otherwise fail-fast.
 */
export async function ensureGenesisAdmin(server: FastifyInstance, opts: GenesisOptions = {}): Promise<void> {
  // The handle is asked for, not assumed: a global connection here would be the same implicit
  // context that is forbidden at request time.
  const provider = (server as unknown as Record<string, DataProvider | undefined>)['provider']
  if (!provider) return // no live data layer (e.g. a core-only boot)
  const ctx = await provider.control()

  // Which apex the deployment needs. With tenants declared, the first identity to
  // exist is a PLATFORM one: a tenant admin is provisioned with its tenant, and seeding one
  // here would put an application user in the container that administers the application.
  if (isTenancyEnabled()) return await ensureGenesisSystemAdmin(server, ctx, opts)

  const um = server?.userManager
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
    // `roles` is an array column: `in` compares the column itself and fails on a scalar value.
    const count = Number(await um.countQuery(ctx, { 'roles:arrayContains': adminCode }))
    if (count === 0) {
      onFatal('Startup: no admin exists and ADMIN_EMAIL is not set to bootstrap one. Set ADMIN_EMAIL.')
    }
    return
  }

  const existing = await um.retrieveUserByEmail(ctx, email)
  if (existing) {
    const patch: Record<string, unknown> = {}
    if (!includesRole(existing.roles, adminCode)) {
      if (await apexExists(um, ctx, adminCode)) return promotesNobody(email, adminCode)
      patch.roles = [...(existing.roles || []), adminCode]
    }

    // The sovereignty is written into the row, once. If some other row already carries it,
    // this one does NOT get it: changing an environment variable must not be able to mint a
    // second sovereign. Moving it is a deliberate act, not a redeploy.
    if (!isFounder(existing) && !(await founderExists(um, ctx))) {
      patch.isFounder = true
    } else if (!isFounder(existing) && log?.w) {
      log.warn(`Startup: ${email} is admin, but the sovereign founder is another row. ADMIN_EMAIL no longer moves it.`)
    }

    if (Object.keys(patch).length) {
      await um.updateUserById(ctx, existing.id, patch)
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
    // environment.
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
 * This is also the one place `ADMIN_EMAIL` is allowed to decide who is sovereign: from here on,
 * being a founder is a property of a row, not of the environment the process happens to have
 * been started with.
 */
async function ensureGenesisSystemAdmin(
  server: FastifyInstance,
  ctx: ControlHandle,
  opts: GenesisOptions
): Promise<void> {
  const sm = server?.systemUserManager
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
      // A blocked superuser does not count: it cannot sign in, and only a superuser unblocks one.
      if (await apexExists(sm, ctx, 'system:admin', { blocked: 'false' })) return promotesNobody(email, 'system:admin')
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
