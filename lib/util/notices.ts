import type { FastifyReply, FastifyRequest } from 'fastify'
import type { ControlHandle, DataHandle, Notice, NoticeManagement, NoticePlane, NoticeReader, NoticeSource, ServedNotice } from '../../types/global.js'
import { httpError } from './httpError.js'
import { dataContext, isPlatformRoute } from './tenancy.js'

//
// The administrators' notices (`NoticeSource`), read at `/notices` on the tenant plane and at
// `/system/notices` on the control one.
//
// The server sends no text: a notice is a kind and its data, and the console writes the sentence.
// What the framework keeps is which notice each reader has seen, as `<source>:<id>`: a mark whose
// notice is no longer current is deleted on the next read, so a notice that clears and comes back
// is new again. A source that fails is named in `failed` and its marks are kept, because a source
// that could not answer says nothing about what cleared.
//

const NAME = /^[A-Za-z0-9_-]+$/
const PLANES: readonly NoticePlane[] = ['tenant', 'control']
const LEVELS: readonly Notice['level'][] = ['info', 'warning']

/**
 * Checked at boot: the name prefixes every id a reader's marks are kept under, so one that holds
 * the separator, or two sources with the same one, would mix the marks of two sources.
 */
export function noticeSourcesOf(given: readonly NoticeSource[] | undefined): readonly NoticeSource[] {
  const sources = [...(given ?? [])]
  const seen = new Set<string>()
  for (const source of sources) {
    const name = String(source?.name ?? '')
    if (!NAME.test(name)) throw new Error(`noticeSources: '${name}' is not a valid name (letters, digits, '-' and '_')`)
    if (seen.has(name)) throw new Error(`noticeSources: '${name}' is given twice`)
    seen.add(name)
    if (typeof source.notices !== 'function') throw new Error(`noticeSources: '${name}' has no notices(req, plane)`)
    const planes = source.planes
    if (!Array.isArray(planes) || planes.length === 0 || planes.some((plane) => !PLANES.includes(plane))) {
      throw new Error(`noticeSources: '${name}' must declare its planes, among ${PLANES.join(', ')}`)
    }
  }
  return Object.freeze(sources)
}

const isInstant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * What a source answered, held to the contract. A notice the console could not place (no id, no
 * kind, an unknown level, an `at` that is not an instant) fails the whole source: serving the rest
 * would delete the marks of the notice that came out malformed.
 */
export function checked(answer: unknown): Notice[] {
  if (!Array.isArray(answer)) throw new Error('notices() did not answer a list')
  const ids = new Set<string>()
  return answer.map((notice: Partial<Notice>) => {
    if (!isRecord(notice)) throw new Error('a notice is not an object')
    const { id, kind, level, at, data } = notice
    if (typeof id !== 'string' || id === '') throw new Error('a notice has no id')
    if (ids.has(id)) throw new Error(`the id '${id}' is given twice`)
    ids.add(id)
    if (typeof kind !== 'string' || kind === '') throw new Error(`the notice '${id}' has no kind`)
    if (!LEVELS.includes(level as Notice['level'])) throw new Error(`the notice '${id}' has an unknown level`)
    if (at !== undefined && !isInstant(at)) throw new Error(`the notice '${id}' has an 'at' that is not an instant`)
    if (data !== undefined && !isRecord(data)) throw new Error(`the notice '${id}' has a 'data' that is not an object`)
    return { id, kind, level: level as Notice['level'], ...(at === undefined ? {} : { at }), ...(data === undefined ? {} : { data }) }
  })
}

/** Asks each source in parallel; a throw is logged with the source's name and does not reach the others. */
async function ask(req: FastifyRequest, plane: NoticePlane, sources: readonly NoticeSource[]) {
  const settled = await Promise.allSettled(sources.map(async (source) => checked(await source.notices(req, plane))))
  const answered = new Map<string, Notice[]>()
  const failed: string[] = []
  settled.forEach((outcome, i) => {
    const { name } = sources[i]
    if (outcome.status === 'fulfilled') {
      answered.set(name, outcome.value)
      return
    }
    failed.push(name)
    if (log.w) log.warn(`Notices: source '${name}' failed on the ${plane} plane (${(outcome.reason as Error)?.message ?? outcome.reason})`)
  })
  return { answered, failed }
}

const sourcesOf = (req: FastifyRequest, plane: NoticePlane): readonly NoticeSource[] =>
  (req.server.noticeSources ?? []).filter((source) => source.planes.includes(plane))

const manager = (req: FastifyRequest): NoticeManagement => req.server.noticeManager

/**
 * The reader and its container, or the refusal already sent. A notice is for a person: an
 * integration token holding the capability has no marks to keep.
 */
function readerOf(req: FastifyRequest, reply: FastifyReply, plane: NoticePlane): { ctx: DataHandle; reader: NoticeReader } | null {
  const control = plane === 'control'
  if (!manager(req)?.isImplemented?.() || (control && !req.control)) {
    reply.status(404).send(httpError(404, 'This build keeps no notices', 'NOT_FOUND'))
    return null
  }
  // A control route of a deployment without tenants is read by the application's own users
  // (isPlatformRoute), so the reader is whoever authenticated, kept apart by its table.
  const reader: NoticeReader | null =
    control && isPlatformRoute(req)
      ? personOf(req.systemUser?.id, 'system')
      : personOf(req.user?.id, 'tenant')
  if (!reader) {
    reply.status(403).send(httpError(403, 'Notices are read by a person, and this credential is not one', 'FORBIDDEN'))
    return null
  }
  return { ctx: control ? (req.control as ControlHandle) : dataContext(req), reader }
}

const personOf = (id: unknown, scope: NoticeReader['scope']): NoticeReader | null =>
  typeof id === 'string' && id !== '' ? { id, scope } : null

/** Newest first; a notice without `at` after every one that has it, in the order its source gave. */
const newestFirst = (a: ServedNotice, b: ServedNotice) => {
  if (a.at === undefined || b.at === undefined) return (a.at === undefined ? 1 : 0) - (b.at === undefined ? 1 : 0)
  return Date.parse(b.at) - Date.parse(a.at)
}

export async function find(req: FastifyRequest, reply: FastifyReply, plane: NoticePlane) {
  const who = readerOf(req, reply, plane)
  if (!who) return
  const { answered, failed } = await ask(req, plane, sourcesOf(req, plane))

  const served: ServedNotice[] = []
  for (const [source, notices] of answered) {
    for (const notice of notices) served.push({ ...notice, source, id: `${source}:${notice.id}`, seen: false })
  }
  const current = served.map((notice) => notice.id)
  if (answered.size) await manager(req).forgetCleared(who.ctx, who.reader, [...answered.keys()], current)
  const seen = new Set(current.length ? await manager(req).seenOf(who.ctx, who.reader, current) : [])
  for (const notice of served) notice.seen = seen.has(notice.id)

  return reply.send({ notices: served.sort(newestFirst), failed })
}

/**
 * Marks the ids the reader has seen. Only an id its source serves now is kept: one already cleared,
 * of a source not registered on the plane or of a source that fails, is ignored, so a mark is never
 * waiting for a notice that has not happened yet.
 */
export async function seen(req: FastifyRequest, reply: FastifyReply, plane: NoticePlane) {
  const who = readerOf(req, reply, plane)
  if (!who) return
  const ids = [...new Set((req.body as { ids: string[] }).ids)]
  const named = new Set(ids.map((id) => id.slice(0, id.indexOf(':'))))
  const { answered } = await ask(req, plane, sourcesOf(req, plane).filter((source) => named.has(source.name)))

  const current = new Set([...answered].flatMap(([source, notices]) => notices.map((notice) => `${source}:${notice.id}`)))
  const kept = ids.filter((id) => current.has(id))
  if (kept.length) await manager(req).markSeen(who.ctx, who.reader, kept)
  return reply.status(204).send()
}
