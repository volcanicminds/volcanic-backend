/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * In-memory LRU + TTL cache backing the per-route `cache` capability.
 *
 * No external dependency: a JS `Map` preserves insertion order, so LRU is
 * "delete + reinsert on read" (marks most-recently-used) and "evict the first key
 * on overflow" (the least-recently-used). TTL is enforced lazily on read plus a
 * periodic background sweep.
 *
 * Entries are keyed as `keyGroup :: container :: subject|roles :: method url`. The
 * CONTAINER comes first and is always written out (T-3.6): `control` for the platform,
 * `tenant:<id>` inside a customer's container. It could be inferred from the rest of the key
 * in most shapes, and that is exactly why it is stated instead: defect D-15 was a cache key
 * that happened to be unique until the day the SQL stopped differing between tenants. A key
 * that isolates by accident isolates until something else changes.
 *
 * The store is configured once at boot from `global.config.options.cache`
 * (see index.ts) and exposed both as `global.cache` and via the package root
 * exports `invalidateCache` / `cache`.
 *
 * KNOWN LIMIT, and it is a decision rather than an oversight (defect D-26): the store is in
 * memory, per process. An invalidation declared by a route reaches the instance that served
 * the request and no other, so behind more than one instance a stale entry survives until it
 * expires. A deployment that needs real cross-instance invalidation wants a shared store,
 * which is a port and an adapter this framework does not ship today. The README says so too.
 *
 * So the default TTL is not one number: it follows the shape of the deployment the framework
 * can actually see. Without a `tenants` block the instance is a single application and one
 * hour is the useful default it has always been; with tenants declared the deployment is the
 * one that gets scaled horizontally, and the window in which an invalidation can fail to
 * arrive has to be short. The residual case is honest and worth stating: a SINGLE-tenant
 * application can also run behind several instances, and there the one-hour default is the
 * unsafe one. Set `cache.ttl` explicitly when that is the shape you run.
 */
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { NormalizedRouteCache, RouteCache } from '../../types/global.js'
import { isTenancyEnabled } from './tenancy.js'

interface Entry {
  value: any
  expires: number // epoch ms; Infinity when no TTL
}

interface CacheSettings {
  enabled: boolean
  ttl: number // default TTL (seconds) for routes without an explicit ttl
  maxEntries: number // LRU cap
}

// Single source of truth for the cache defaults. `enabled` is opt-in (off by
// default, consistent with the other optional features like `manifest` /
// `multi_tenant`); `ttl`/`maxEntries` are the numeric fallbacks applied per-field
// by configureCache, so no other module needs to restate them.
const TTL_SINGLE_TENANT = 3600
const TTL_MULTI_TENANT = 60

const DEFAULTS: CacheSettings = { enabled: false, ttl: TTL_SINGLE_TENANT, maxEntries: 1000 }

/**
 * The default TTL, chosen by the deployment shape (D-26).
 *
 * One hour where the framework sees a single application, one minute where it sees tenants:
 * that is the deployment that gets replicated, and an invalidation that reaches one instance
 * out of four must not leave the other three an hour behind. Exported so the number is
 * assertable rather than folded into a boot log.
 */
export const defaultTtlFor = (tenancy: boolean): number => (tenancy ? TTL_MULTI_TENANT : TTL_SINGLE_TENANT)

let settings: CacheSettings = { ...DEFAULTS }
const store = new Map<string, Entry>()
let hits = 0
let misses = 0
let sweepTimer: ReturnType<typeof setInterval> | null = null

const nowMs = () => Date.now()

function startSweep(intervalMs = 60_000) {
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = setInterval(() => {
    const t = nowMs()
    for (const [k, e] of store) if (e.expires <= t) store.delete(k)
  }, intervalMs)
  // Never keep the event loop alive just for the sweep.
  sweepTimer.unref?.()
}

/** (Re)configure the cache from global options and log the effective config. */
export function configureCache(opts?: CacheSettings | Partial<CacheSettings>): CacheSettings {
  const tenancy = isTenancyEnabled()
  const declaredTtl = Number(opts?.ttl) > 0
  settings = {
    // Opt-in master switch: enabled only when explicitly set to true.
    enabled: opts?.enabled === true,
    ttl: declaredTtl ? Number(opts?.ttl) : defaultTtlFor(tenancy),
    maxEntries: Number(opts?.maxEntries) > 0 ? Number(opts?.maxEntries) : DEFAULTS.maxEntries
  }
  store.clear()
  hits = 0
  misses = 0
  if (settings.enabled) {
    startSweep()
    if (log?.i) {
      const why = declaredTtl ? 'configured' : tenancy ? 'default with tenants' : 'default, single tenant'
      log.info(`Cache 🧊 enabled: ttl ${settings.ttl}s (${why}), maxEntries ${settings.maxEntries}, strategy LRU+TTL`)
    }
    // The store is per process, so an invalidation does not travel. Said once, at boot, on
    // the deployment where it can actually bite (D-26).
    if (tenancy && !declaredTtl && log?.w) {
      log.warn('Cache 🧊 is per process: an invalidation reaches this instance only. TTL bounds the staleness.')
    }
  } else {
    if (sweepTimer) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
    if (log?.i) log.info('Cache 🧊 disabled')
  }
  return settings
}

export const cacheEnabled = () => settings.enabled
export const defaultTtl = () => settings.ttl

export function cacheGet(key: string): any {
  const e = store.get(key)
  if (!e) {
    misses++
    return undefined
  }
  if (e.expires <= nowMs()) {
    store.delete(key)
    misses++
    return undefined
  }
  // LRU touch: re-insert to mark as most-recently used.
  store.delete(key)
  store.set(key, e)
  hits++
  return e.value
}

export function cacheSet(key: string, value: any, ttlSec?: number): void {
  const ttl = Number(ttlSec) > 0 ? Number(ttlSec) : settings.ttl
  if (store.has(key)) store.delete(key)
  store.set(key, { value, expires: ttl > 0 ? nowMs() + ttl * 1000 : Infinity })
  // Evict least-recently-used entries beyond the cap.
  while (store.size > settings.maxEntries) {
    const oldest = store.keys().next().value
    if (oldest === undefined) break
    store.delete(oldest)
  }
}

/**
 * Invalidate cached entries. With no argument clears everything; otherwise removes every
 * entry belonging to the given key-group(s).
 *
 * `container` narrows the sweep to one container, and the route hooks always pass it: a
 * write inside one customer's container cannot have staled another customer's data, so
 * flushing theirs is throwing away work for no reason. Called by hand without it, the sweep
 * still covers every container, because that is a deliberate administrative act.
 *
 * Returns the number removed.
 */
export function invalidateCache(keyGroups?: string | string[], container?: string): number {
  if (keyGroups == null) {
    const n = store.size
    store.clear()
    if (log?.d) log.debug(`Cache 🧊 flushAll: ${n} entries removed`)
    return n
  }
  const list = Array.isArray(keyGroups) ? keyGroups : [keyGroups]
  const prefixes = list.map((g) => (container ? `${g}::${container}::` : `${g}::`))
  let n = 0
  for (const k of [...store.keys()]) {
    if (prefixes.some((p) => k.startsWith(p))) {
      store.delete(k)
      n++
    }
  }
  if (log?.d) log.debug(`Cache 🧊 invalidate [${list.join(', ')}]${container ? ` in ${container}` : ''}: ${n} entries removed`)
  return n
}

export function cacheStats() {
  return { size: store.size, hits, misses, ...settings }
}

/** Facade exposed as `global.cache` and re-exported from the package root. */
export const cache = {
  get: cacheGet,
  set: cacheSet,
  del: (key: string) => store.delete(key),
  invalidate: invalidateCache,
  flushAll: () => invalidateCache(),
  stats: cacheStats,
  enabled: cacheEnabled
}

// ---------------------------------------------------------------------------
// Route-config normalization + request scoping + Fastify hook factory
// ---------------------------------------------------------------------------

/** Normalize the authored `cache` prop (`true` | number | object) into the stored
 *  form, resolving the key-group to the api folder (area) when omitted. Returns
 *  undefined when there is nothing to do (absent/false and no invalidation). */
export function normalizeRouteCache(
  input: boolean | number | RouteCache | undefined,
  defaultKeyGroup: string
): NormalizedRouteCache | undefined {
  if (input == null || input === false) return undefined
  const obj: RouteCache = input === true ? {} : typeof input === 'number' ? { ttl: input } : input
  const enabled = obj.enabled !== false
  const invalidates =
    obj.invalidates == null ? undefined : Array.isArray(obj.invalidates) ? obj.invalidates : [obj.invalidates]
  if (!enabled && !invalidates?.length) return undefined
  return {
    enabled,
    ttl: typeof obj.ttl === 'number' && obj.ttl > 0 ? obj.ttl : undefined,
    keyGroup: obj.keyGroup || defaultKeyGroup,
    invalidates
  }
}

const HIT = Symbol('volcanic.cacheHit')
const HEADER_ALLOW = /^(content-type|v-)/i

/**
 * Which container a response belongs to, written out rather than implied (T-3.6).
 *
 * `control` and `tenant:<id>` are distinguishable strings on purpose: an empty segment used
 * to mean both "no tenants configured" and "a control-scope route in a deployment that has
 * tenants". Those are the same container today, and a key that relies on them staying the
 * same is a key that breaks quietly the day they do not.
 */
export function containerOf(req: any): string {
  const id = req.tenantInfo?.id
  return id ? `tenant:${id}` : 'control'
}

/** Isolates cached data by authenticated subject and role set, inside one container. */
function subjectScope(req: any): string {
  const subject = req.user?.externalId ?? req.token?.getId?.() ?? 'anon'
  const rolesList = typeof req.roles === 'function' ? req.roles() : []
  const rolesKey = [...(rolesList || [])].sort().join(',')
  return `${subject}|${rolesKey}`
}

export function keyFor(req: any, keyGroup: string): string {
  return `${keyGroup}::${containerOf(req)}::${subjectScope(req)}::${req.method} ${req.url}`
}

/** Skip caching when a tenant is expected (multi-tenant + tenantContext) but missing,
 *  to avoid ever leaking data across tenants. */
function tenantMissing(req: any): boolean {
  const tenantCtx = req.routeOptions?.config?.tenantContext
  return Boolean(isTenancyEnabled() && tenantCtx !== false && !req.tenantInfo)
}

/** Build the per-route read (preHandler) and write (onSend) hooks for a cached route. */
export function buildCacheHooks(routeCache: NormalizedRouteCache) {
  const cacheable = routeCache.enabled === true
  const keyGroup = routeCache.keyGroup
  const ttl = routeCache.ttl
  const invalidates = routeCache.invalidates

  const preHandler = cacheable
    ? async (req: FastifyRequest, reply: FastifyReply) => {
        if (!cacheEnabled() || (req as any).method !== 'GET' || tenantMissing(req)) return
        const hit = cacheGet(keyFor(req, keyGroup))
        if (hit) {
          for (const [h, v] of Object.entries(hit.headers as Record<string, any>)) reply.header(h, v as any)
          ;(req as any)[HIT] = true
          reply.code(hit.statusCode)
          if (log?.d) log.debug(`Cache 🧊 hit ${keyGroup} ${(req as any).method} ${(req as any).url}`)
          return reply.send(hit.payload)
        }
        if (log?.d) log.debug(`Cache 🧊 miss ${keyGroup} ${(req as any).method} ${(req as any).url}`)
      }
    : undefined

  const onSend = async (req: FastifyRequest, reply: FastifyReply, payload: any) => {
    // Master switch off: nothing to store and — on a volatile in-memory cache — nothing
    // to invalidate (the store is already empty), so skip the whole hook. Also avoids
    // scanning the store on every mutation when caching is globally disabled.
    if (!cacheEnabled()) return payload
    // Store fresh GET 2xx responses (skip replays and anything with Set-Cookie).
    if (
      cacheable &&
      !(req as any)[HIT] &&
      (req as any).method === 'GET' &&
      reply.statusCode >= 200 &&
      reply.statusCode < 300 &&
      typeof payload === 'string' &&
      !tenantMissing(req) &&
      !reply.getHeader('set-cookie')
    ) {
      const headers: Record<string, any> = {}
      const all = reply.getHeaders()
      for (const h of Object.keys(all)) if (HEADER_ALLOW.test(h)) headers[h] = all[h]
      cacheSet(keyFor(req, keyGroup), { payload, headers, statusCode: reply.statusCode }, ttl)
    }
    // Invalidate declared key-groups after a successful mutation.
    if (
      invalidates?.length &&
      (req as any).method !== 'GET' &&
      reply.statusCode >= 200 &&
      reply.statusCode < 300
    ) {
      invalidateCache(invalidates, containerOf(req))
    }
    return payload
  }

  return { preHandler, onSend }
}
