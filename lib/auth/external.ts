import { randomBytes } from 'crypto'
import type {
  AccessEvent,
  AuthContext,
  AuthSubject,
  ControlHandle,
  ExternalAuthResult,
  ExternalIdentityKey
} from '../../types/global.js'
import type { ResolvedProvider } from './providers.js'
import { mayLogIn, toSubject } from './subjects.js'

//
// Who an identity from a provider is here (F40, T-12.27): the resolution a return from an IdP goes
// through before the flow may trust it.
//
// In this order, and nothing else: an existing link on the four keys (plane, provider, issuer,
// subject), never on the address alone; then a link by email, only where the provider declares it,
// only for an address the provider says it verified, only in a domain the provider lists; then a
// user created just in time, only where the provider turns it on, only on the tenant plane, only
// for an address the provider verified, as the tenant's account creation mode allows (F49), never
// with the admin role; otherwise `IDP_IDENTITY_NOT_LINKED`. `sub` is unique per issuer only, and an
// address changes, gets recycled and is unverified on many providers: linking by address is the
// classic door to an account takeover, which is why each of these steps is opt-in.
//
// The answer carries the event for the access log instead of writing it: the caller is the engine,
// which owns the flow id and the plane the row goes to.
//

export type ExternalResolution =
  | { outcome: 'resolved'; subject: AuthSubject; event: Extract<AccessEvent, 'idp.linked' | 'idp.provisioned'> | null }
  | {
      outcome: 'refused'
      reason: 'IDP_IDENTITY_NOT_LINKED' | 'ACCOUNT_PENDING_APPROVAL'
      event: Extract<AccessEvent, 'idp.rejected' | 'account.pending'>
      cause: string
      /** The account the refusal is about, when there is one: the waiting one of F49. */
      subjectId?: string
    }

const refused = (cause: string): ExternalResolution => ({ outcome: 'refused', reason: 'IDP_IDENTITY_NOT_LINKED', event: 'idp.rejected', cause })

// A distinct code, unlike a password login that meets a waiting account: here the provider has
// already authenticated the person, the account is theirs, and «not linked» would send them to
// register again. Nobody learns anything about an account they did not just prove to own.
const waiting = (subjectId: string, event: 'idp.rejected' | 'account.pending', cause: string): ExternalResolution => ({
  outcome: 'refused',
  reason: 'ACCOUNT_PENDING_APPROVAL',
  event,
  cause,
  subjectId
})

const domainOf = (email: string) => email.slice(email.lastIndexOf('@') + 1).toLowerCase()

/** A subject of the plane, when it may log in. */
async function usable(ctx: AuthContext, row: unknown): Promise<AuthSubject | null> {
  if (!row || typeof row !== 'object') return null
  const { blocked } = row as { blocked?: unknown }
  if (ctx.plane === 'control') return blocked ? null : toSubject('control', row)
  return (await mayLogIn(ctx.managers.userManager, row)) ? toSubject('tenant', row) : null
}

async function byExternalId(ctx: AuthContext, externalId: string) {
  return ctx.plane === 'control'
    ? await ctx.managers.systemUserManager.retrieveSystemUserByExternalId(ctx.handle as ControlHandle, externalId)
    : await ctx.managers.userManager.retrieveUserByExternalId(ctx.handle, externalId)
}

async function byEmail(ctx: AuthContext, email: string) {
  return ctx.plane === 'control'
    ? await ctx.managers.systemUserManager.retrieveSystemUserByEmail(ctx.handle as ControlHandle, email)
    : await ctx.managers.userManager.retrieveUserByEmail(ctx.handle, email)
}

export async function resolveExternal(ctx: AuthContext, provider: ResolvedProvider, external: ExternalAuthResult): Promise<ExternalResolution> {
  const links = ctx.managers.externalIdentityManager
  if (!links?.isImplemented?.()) return refused('no external identity store in this build')
  if (external.provider !== provider.key || !external.issuer || !external.subject) return refused('the result does not name this provider')

  const key: ExternalIdentityKey = { scope: ctx.plane, provider: provider.key, issuer: external.issuer, subject: external.subject }
  const email = typeof external.email === 'string' ? external.email.trim().toLowerCase() : ''
  const settings = provider.settings

  // 1. An existing link. The subject is judged as any login judges it: a blocked account stays out.
  const link = await links.findLink(ctx.handle, key)
  if (link) {
    const row = await byExternalId(ctx, link.subjectId)
    const subject = await usable(ctx, row)
    if (!subject) {
      const pending = ctx.plane === 'tenant' && (row as { approved?: unknown } | null)?.approved === false
      return pending ? waiting(link.subjectId, 'idp.rejected', 'the linked account awaits approval') : refused('the linked subject may not log in')
    }
    await links.touch(ctx.handle, link.id)
    return { outcome: 'resolved', subject, event: null }
  }

  // 2. By address, on the three conditions of the provider.
  const verified = external.emailVerified === true && Boolean(email)
  if (settings.linkByEmail === true) {
    const domains = (settings.emailDomains ?? []).map((d) => d.toLowerCase())
    if (verified && domains.includes(domainOf(email))) {
      const subject = await usable(ctx, await byEmail(ctx, email))
      if (subject) {
        await links.createLink(ctx.handle, { ...key, subjectId: subject.externalId, emailAtLink: email })
        return { outcome: 'resolved', subject, event: 'idp.linked' }
      }
    }
  }

  // 3. Just in time: tenant plane, turned on by the provider, verified address, allowed by the
  // tenant's account creation mode, never admin, never over an existing account.
  const jit = settings.jit
  if (ctx.plane === 'tenant' && jit?.enabled) {
    if (!email) return refused('just-in-time provisioning needs an address')
    // No account on an address the provider did not verify: it would be created unconfirmed and
    // hold the address, so its real owner could neither register nor be provisioned until an
    // administrator stepped in.
    if (!verified) return refused('just-in-time provisioning needs an address the provider verified')
    // F49. Under `invite` a provider creates accounts only for a directory someone listed: whoever
    // configured it with `emailDomains` authorized those addresses, and without a list the provider
    // would be an open registration by another door.
    const mode = ctx.accountCreation ? await ctx.accountCreation() : 'invite'
    if (mode === 'invite') {
      const domains = (settings.emailDomains ?? []).map((d) => d.toLowerCase())
      if (!domains.includes(domainOf(email))) return refused('accounts here are created by invitation, and the address is not in a listed domain')
    }
    const admin = global.roles?.admin?.code || 'admin'
    // Checked again here and not only when the provider was written: a row edited by hand, or a
    // deployment file nobody validated, must not mint an administrator from a login.
    if ((jit.roles ?? []).includes(admin)) return refused('just-in-time roles include the admin role')
    const users = ctx.managers.userManager
    if (await users.retrieveUserByEmail(ctx.handle, email)) return refused('an account with this address exists and is not linked')
    const created = await users.createUser(ctx.handle, {
      email,
      // A password nobody knows and nobody is shown: the column is required, the login is the IdP's.
      password: randomBytes(32).toString('base64url'),
      // The provider verified the address, which is what confirming it here would prove.
      confirmed: true,
      // Under `approval` the account waits for an administrator; the link is made now, so the
      // first login after the approval goes through it.
      approved: mode !== 'approval',
      roles: [...(jit.roles ?? [])]
    })
    await links.createLink(ctx.handle, { ...key, subjectId: String(created.externalId), emailAtLink: email })
    if (mode === 'approval') return waiting(String(created.externalId), 'account.pending', 'the provisioned account awaits approval')
    const subject = await usable(ctx, created)
    if (!subject) return refused('the provisioned account may not log in')
    return { outcome: 'resolved', subject, event: 'idp.provisioned' }
  }

  return refused(settings.linkByEmail ? 'no link, and the address does not qualify for one' : 'no link for this identity')
}
