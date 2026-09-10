/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.5: the five loaders that decide what a consuming project can override, and how.
//
// None of them had a test, and each one implements a different override rule — which is
// exactly the kind of thing that is impossible to remember and cheap to get wrong:
//
//   schemas     deep merge on a matching `$id`, framework properties kept
//   hooks       ADDED to the framework's, never instead of them
//   plugins     REPLACE the framework's entry of the same name, whole
//   tracking    merged, with defaults persisted rather than left undefined
//   translation dictionaries merged, the consumer's phrase winning
//
// A project that guessed wrong here does not get an error, it gets a framework default it
// thought it had replaced, or a replacement where it wanted an addition.
//
import path from 'path'
import { fileURLToPath } from 'url'
import { expect } from 'expect'
import * as loaderSchemas from '../../lib/loader/schemas.js'
import * as loaderHooks from '../../lib/loader/hooks.js'
import * as loaderPlugins from '../../lib/loader/plugins.js'
import * as loaderTracking from '../../lib/loader/tracking.js'
import * as loaderTranslation from '../../lib/loader/translation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CONSUMER = path.resolve(__dirname, './fixtures/consumer')

//
// A log with the METHODS present and the level flags off: these loaders call `log.error(...)`
// and `log.trace(...)` unguarded in places, so `{}` is not a stand-in for "quiet", it is a
// stand-in for "crash". (The guarded `if (log.x)` form is the convention; the unguarded calls
// are why this double has to be complete.)
//
// Installed in `before` and taken back in `after`, not at module load: mocha runs every spec
// file in one process, so a global assigned while modules load is assigned for everybody and
// the last file to load wins. This suite passed alone and failed in the full run for exactly
// that reason.
//
const QUIET = { fatal: () => {}, error: () => {}, warn: () => {}, info: () => {}, debug: () => {}, trace: () => {} }

describe('loaders · what a consuming project may override (T-9.5)', () => {
  const cwd = process.cwd()
  let savedLog: any

  before(() => {
    savedLog = (global as any).log
    ;(global as any).log = QUIET
    process.chdir(CONSUMER)
  })

  after(() => {
    process.chdir(cwd)
    ;(global as any).log = savedLog
  })

  it('registers the framework schemas, adds the consumer ones, and DEEP MERGES a shared $id', async () => {
    const added: any[] = []
    await loaderSchemas.apply({ addSchema: (s: any) => added.push(s) })

    const byId = new Map(added.map((s) => [s.$id, s]))

    // The consumer's own is registered as-is.
    expect(byId.has('consumerOwnSchema')).toBe(true)

    // The shared one is registered ONCE, in its merged form: the consumer's property is
    // there, and so are the framework's. An override that replaced would have dropped `id`,
    // and every `$ref: 'onlyIdSchema#'` in the framework's routes would validate nothing.
    const merged: any = byId.get('onlyIdSchema')
    expect(merged).toBeTruthy()
    expect(merged.properties.tenantSlug).toBeTruthy()
    expect(merged.properties.id).toBeTruthy()
    // Required is a UNION: neither side silently loses a constraint it declared.
    expect([...merged.required].sort()).toEqual(['id', 'tenantSlug'])

    // A schema with no `$id` cannot be referenced, so registering it would be registering
    // something unreachable.
    expect(added.some((s) => s.properties?.orphan)).toBe(false)

    // Registered once, not twice: the second registration would throw inside Fastify.
    expect(added.filter((s) => s.$id === 'onlyIdSchema').length).toBe(1)
  })

  it('adds the consumer hooks to the framework ones instead of replacing them', async () => {
    const added: Array<[string, unknown]> = []
    await loaderHooks.apply({ addHook: (name: string, fn: unknown) => added.push([name, fn]) })

    const perName = added.reduce<Record<string, number>>((acc, [name]) => {
      acc[name] = (acc[name] ?? 0) + 1
      return acc
    }, {})

    // The framework's own onRequest is where authentication happens. A consumer hook that
    // replaced it would disable authentication by declaring a file.
    expect(perName.onRequest).toBeGreaterThan(1)
    expect(perName.preHandler).toBeGreaterThan(0)
    // And a hook nobody declared is not registered at all: an empty array must not become an
    // empty hook, which Fastify would still call on every request.
    expect(perName.onTimeout).toBeUndefined()
  })

  it('lets a consumer plugin entry replace the framework one, whole', async () => {
    const plugins: any = await loaderPlugins.load()

    // Disabled here, so it is `false` and not "the framework's options": that is what makes
    // "not writing the block" the way to keep a default.
    expect(plugins.cors).toBe(false)
    expect(plugins.helmet).toEqual({ global: false })
    expect(plugins.somethingOfOurOwn).toEqual({ mine: true })
    // A framework plugin the consumer did not mention keeps whatever the framework said.
    expect('rateLimit' in plugins).toBe(true)
  })

  it('persists the tracking defaults rather than leaving them undefined', async () => {
    const { tracking, trackingConfig } = await loaderTracking.load()

    expect(trackingConfig.primaryKey).toBe('uuid')

    const entry: any = Object.values(tracking).find((t: any) => t.path === '/products/:id')
    expect(entry).toBeTruthy()
    // `enable` was not written in the fixture. The runtime gate reads `tc.enable`, so leaving
    // it undefined would mean a change entry that looks configured and never tracks.
    expect(entry.enable).toBe(true)
    expect(entry.primaryKey).toBe('uuid')

    // GET is not a tracked method: dropped, rather than stored and ignored later.
    expect(Object.values(tracking).some((t: any) => t.method === 'GET')).toBe(false)
  })

  it('merges the consumer dictionaries over the framework ones', () => {
    const i18n: any = loaderTranslation.load()
    // With a locale set, `getCatalog()` answers with THAT locale's phrases, not with a map of
    // every locale — a detail worth pinning, because reading it the other way silently gives
    // an empty object and every assertion after it passes vacuously.
    const en = i18n.getCatalog('en')

    // The framework's own phrases are still there: a consumer dictionary adds, it does not
    // take over the file.
    expect(en.greeting?.formal).toBe('Hello')
    expect(en.complex).toBeTruthy()

    // The consumer's are added, and win on a shared key — the whole point of shipping one.
    expect(en.consumer?.greeting).toBe('Hello from the consumer')
    expect(en.hello).toBe('Overridden by the consumer')

    // Translation goes through the same catalogue, which is what `global.t` is handed. And
    // `objectNotation` is on, so a dotted phrase is a PATH: a consumer shipping a flat
    // `"consumer.greeting"` key would get the key back and no error, which is the trap this
    // assertion documents by using the nested form the framework's own dictionary uses.
    expect(i18n.__({ phrase: 'consumer.greeting', locale: 'en' })).toBe('Hello from the consumer')
    expect(i18n.__({ phrase: 'greeting.informal', locale: 'en' })).toBe('Hi')

    // The default locale is set before the loader returns: an i18n with no locale answers
    // every phrase with the phrase.
    expect(i18n.getLocale()).toBe('en')
  })

  it('picks up a locale the framework does not ship, from the consumer alone', () => {
    // `fr.json` exists only in the fixture, and `fr` is not one of the two locales the
    // framework declares. It is registered anyway, which is the behaviour a project shipping
    // its own languages needs — and the opposite of it would be silent: a dictionary added, no
    // error, and English served.
    const i18n: any = loaderTranslation.load()
    expect(i18n.getLocales().sort()).toEqual(['en', 'fr', 'it'])
    expect(i18n.getCatalog('fr').consumer?.greeting).toBe('Bonjour')
  })
})
