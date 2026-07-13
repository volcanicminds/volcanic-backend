import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { includesRole } from '../util/authz.js'

// Random credential for a generated founder. base64url is alphanumeric; the suffix
// satisfies any upper/lower/digit/symbol policy. Printed once; rotate after first login.
function generatePassword(): string {
  return crypto.randomBytes(24).toString('base64url') + 'aA1!'
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const um = (server as any)?.['userManager']
  if (!um?.isImplemented?.()) return
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(global as any).connection) return // no live data layer (e.g. core-only boot)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((global as any).config?.options?.multi_tenant?.enabled) return

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
    const count = Number(await um.countQuery({ 'roles:in': adminCode }))
    if (count === 0) {
      onFatal('Startup: no admin exists and ADMIN_EMAIL is not set to bootstrap one. Set ADMIN_EMAIL.')
    }
    return
  }

  const existing = await um.retrieveUserByEmail(email)
  if (existing) {
    if (!includesRole(existing.roles, adminCode)) {
      await um.updateUserById(existing.getId(), { roles: [...(existing.roles || []), adminCode] })
      if (log?.i) log.info(`Startup: promoted ${email} to admin (sovereign founder).`)
    }
    return
  }

  const envPassword = process.env.ADMIN_PASSWORD
  const password = envPassword || generatePassword()
  const created = await um.createUser({ email, username: email, password, roles: [adminCode] })
  await um.userConfirmation(created)
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
