import type { FastifyRequest } from 'fastify'
import type { TenantsConfig } from '../../types/global.js'

//
// The tenant a request DECLARES, as opposed to the one it proves (T-3.2).
//
// Two rules, and both come from D-03 and D-11.
//
// One source at a time. If the deployment resolves by subdomain, the header is not read: not
// as a fallback, not "if the subdomain is missing". Two concurrent sources for one decision
// is the original shape of D-03, where a header quietly outranked a token claim that was
// never actually compared.
//
// Never the query string. It was typed and documented in v4 and it is gone in v5 (decision
// 9): a tenant identifier in the query string ends up in access logs, in `Referer` headers
// and in browser history, which makes it a credential written on a postcard.
//
// What comes out of here is untrusted input. It names a tenant, it does not grant one: the
// caller checks it against the token when there is a token, and looks it up in the registry
// when there is not.
//
export function declaredTenant(req: FastifyRequest, tenants: TenantsConfig | null): string | undefined {
  if (!tenants) return undefined

  if ((tenants.resolver ?? 'header') === 'subdomain') {
    return subdomainOf(req, Number(tenants.subdomainLevel ?? 1))
  }

  const key = String(tenants.headerKey || 'x-tenant-id').toLowerCase()
  const value = req.headers?.[key]
  const raw = Array.isArray(value) ? value[0] : value
  return normalize(raw)
}

/**
 * The `level`-th label of the host, 1-based: `acme.example.com` at level 1 is `acme`.
 *
 * A label only counts as a subdomain when something remains after it, so the host needs at
 * least `level + 2` labels: `example.com` names no tenant at level 1, and neither does
 * `acme.localhost` or a bare IP. The rule is deliberately arithmetic rather than clever,
 * because the alternative is a public-suffix list, and a wrong guess there would resolve a
 * request to the wrong customer. A deployment on `localhost` uses the header resolver.
 */
function subdomainOf(req: FastifyRequest, level: number): string | undefined {
  const host = String((req.headers?.host as string) || '').split(':')[0]
  if (!host || level < 1) return undefined

  const labels = host.split('.')
  if (labels.length < level + 2) return undefined
  return normalize(labels[level - 1])
}

/** Trimmed, lowercased, and only if it still looks like a slug: the rest is rejected input. */
function normalize(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const value = raw.trim().toLowerCase()
  if (!value || value.length > 100) return undefined
  return /^[a-z0-9][a-z0-9_-]*$/.test(value) ? value : undefined
}
