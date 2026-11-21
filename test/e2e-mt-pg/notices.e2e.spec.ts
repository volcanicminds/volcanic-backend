/* eslint-disable @typescript-eslint/no-explicit-any */
//
// The administrators' notices over HTTP on real Postgres, under both strategies: a source
// registered on both planes answers each tenant's administrator with that tenant's notices and the
// platform's with the control plane's, never the other way round; a mark of seen outlives the
// session it was made in, is kept in the reader's own container, and goes when its notice clears,
// so the notice is new when it comes back; a failing source does not take the others down.
//
import { expect } from 'expect'
import type { FastifyRequest } from 'fastify'
import type { Notice, NoticePlane, NoticeSource } from '../../types/global.js'
import { setup, teardown, inject, systemToken, createTenant, login, sql, bearer, inTenantDatabase, ACME, GLOBEX, HEADER } from './harness.js'

const body = (res: any) => JSON.parse(res.body)

/** Whether the tenant notice is current: a test clears it and brings it back. */
let standing = true

const fake: NoticeSource = {
  name: 'fake',
  planes: ['tenant', 'control'],
  async notices(req: FastifyRequest, plane: NoticePlane): Promise<Notice[]> {
    if (plane === 'control') return [{ id: 'platform', kind: 'platform', level: 'warning', at: '2026-11-21T10:00:00.000Z' }]
    const slug = String(req.headers[HEADER])
    return standing ? [{ id: `hello-${slug}`, kind: 'hello', level: 'info', data: { slug } }] : []
  }
}

const broken: NoticeSource = {
  name: 'broken',
  planes: ['tenant'],
  async notices() {
    throw new Error('down')
  }
}

for (const strategy of ['schema', 'container'] as const) {
  describe(`The administrators' notices, a ${strategy === 'schema' ? 'schema' : 'database'} each (T-7.18)`, function () {
    this.timeout(60000)

    let system: string

    /** A query on a container from outside the application, its unqualified names resolved there. */
    const inContainer = async (locator: string, text: string, params: unknown[] = []) => {
      if (strategy === 'container') return (await inTenantDatabase(locator, (c) => c.query(text, params))).rows
      const client = await sql().connect()
      try {
        await client.query('begin')
        await client.query(`set local search_path to "${locator}"`)
        const { rows } = await client.query(text, params)
        await client.query('commit')
        return rows
      } catch (error) {
        await client.query('rollback')
        throw error
      } finally {
        client.release()
      }
    }
    const read = async (token: string, slug?: string, url = '/notices') => {
      const res = await inject({ method: 'GET', url, headers: bearer(token, slug) })
      expect(res.statusCode).toBe(200)
      return body(res)
    }
    const markSeen = (token: string, ids: string[], slug?: string, url = '/notices/seen') =>
      inject({ method: 'POST', url, headers: bearer(token, slug), payload: { ids } })

    before(async () => {
      standing = true
      await setup({ noticeSources: [fake, broken] }, { strategy })
      system = await systemToken()
      await createTenant(system, ACME)
      await createTenant(system, GLOBEX)
    })

    after(async () => await teardown())

    it("serves each tenant's administrator its own notices, names the failing source, and never the platform's", async () => {
      const acme = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      const answer = await read(acme, ACME.slug)
      expect(answer.failed).toEqual(['broken'])
      expect(answer.notices).toEqual([{ source: 'fake', id: 'fake:hello-acme', kind: 'hello', level: 'info', data: { slug: 'acme' }, seen: false }])

      const globex = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)
      expect((await read(globex, GLOBEX.slug)).notices.map((n: any) => n.id)).toEqual(['fake:hello-globex'])
    })

    it("keeps a mark in the reader's container, past the session it was made in, and ignores an id not served", async () => {
      const acme = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      expect((await markSeen(acme, ['fake:hello-acme', 'fake:hello-globex', 'fake:never'], ACME.slug)).statusCode).toBe(204)

      const again = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      expect((await read(again, ACME.slug)).notices.map((n: any) => [n.id, n.seen])).toEqual([['fake:hello-acme', true]])
      expect((await inContainer(ACME.locator, 'select notice, scope from notice_seen order by notice')).map((r: any) => [r.notice, r.scope])).toEqual([
        ['fake:hello-acme', 'tenant']
      ])
      // Globex's administrator has not seen its own, and nothing of Acme's is in its container.
      const globex = await login(GLOBEX.slug, GLOBEX.adminEmail, GLOBEX.adminPassword)
      expect((await read(globex, GLOBEX.slug)).notices.map((n: any) => n.seen)).toEqual([false])
      expect(await inContainer(GLOBEX.locator, 'select notice from notice_seen')).toEqual([])
    })

    it('forgets the mark when the notice clears, so the notice is new when it comes back', async () => {
      const acme = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      standing = false
      expect((await read(acme, ACME.slug)).notices).toEqual([])
      standing = true
      expect((await read(acme, ACME.slug)).notices.map((n: any) => [n.id, n.seen])).toEqual([['fake:hello-acme', false]])
    })

    it("serves the platform's administrator the control plane's notices, kept apart from every tenant's", async () => {
      const answer = await read(system, undefined, '/system/notices')
      expect(answer.failed).toEqual([])
      expect(answer.notices).toEqual([
        { source: 'fake', id: 'fake:platform', kind: 'platform', level: 'warning', at: '2026-11-21T10:00:00.000Z', seen: false }
      ])
      expect((await markSeen(system, ['fake:platform'], undefined, '/system/notices/seen')).statusCode).toBe(204)
      expect((await read(system, undefined, '/system/notices')).notices.map((n: any) => n.seen)).toEqual([true])
      // The control plane lives in the main database's public schema under both strategies.
      const { rows } = await sql().query('select notice, scope from public.notice_seen')
      expect(rows.map((r: any) => [r.notice, r.scope])).toEqual([['fake:platform', 'system']])
    })

    it('refuses each plane to the credentials of the other', async () => {
      const acme = await login(ACME.slug, ACME.adminEmail, ACME.adminPassword)
      expect((await inject({ method: 'GET', url: '/system/notices', headers: bearer(acme, ACME.slug) })).statusCode).toBeGreaterThanOrEqual(400)
      expect((await inject({ method: 'GET', url: '/notices', headers: bearer(system, ACME.slug) })).statusCode).toBeGreaterThanOrEqual(400)
      expect((await inject({ method: 'GET', url: '/notices', headers: { [HEADER]: ACME.slug } })).statusCode).toBe(401)
    })
  })
}
