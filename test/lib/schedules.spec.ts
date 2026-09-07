/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-3.4: a job declares where it runs, and receives the handle.
//
// Defect D-07 was not "the job used the wrong connection", it was that the job had no way
// to ask for the right one: it was called with no arguments and everything it read went
// through a global. So these tests assert on WHAT EACH INVOCATION RECEIVED, which is the
// only observable that distinguishes the fix from a comment.
//
import { expect } from 'expect'
import path from 'path'
import { fileURLToPath } from 'url'
import { load, runnerFor } from '../../lib/loader/schedules.js'

;(global as any).log = {}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, './fixtures/schedules')

const CONTROL: any = { kind: 'control' }

const REGISTRY: any[] = [
  { id: 'id-acme', slug: 'acme', status: 'active', locator: 'tenant_acme' },
  { id: 'id-globex', slug: 'globex', status: 'active', locator: 'tenant_globex' },
  { id: 'id-dormant', slug: 'dormant', status: 'suspended', locator: 'tenant_dormant' }
]

function fakeServer(over: any = {}) {
  const released: string[] = []
  const provider = {
    released,
    control: async () => CONTROL,
    tenant: async (tenantId: string, scope?: any) => ({ kind: 'tenant', tenantId, scope }) as any,
    releaseRequestScope: async (scope: any) => {
      released.push(scope.requestId)
    },
    shutdown: async () => {}
  }
  const tenantManager = {
    isImplemented: () => true,
    getTenantBySlug: async (_ctx: any, slug: string) => REGISTRY.find((t) => t.slug === slug) ?? null,
    listTenants: async (_ctx: any, query: any) => ({
      records: query?._page === 1 ? REGISTRY.filter((t) => t.status === 'active') : [],
      headers: {}
    })
  }
  return { provider, tenantManager, ...over } as any
}

/** Records the handle and the run info of every invocation. */
function recorder() {
  const seen: any[] = []
  const fn = async (ctx: any, run: any) => {
    seen.push({ ctx, tenant: run.tenant?.slug, jobName: run.jobName, aborted: run.signal.aborted })
  }
  return { seen, fn }
}

const never = new AbortController().signal

describe('loader/schedules · where a job runs (T-3.4)', () => {
  it('runs on the control plane when the schedule declares nothing', async () => {
    const server = fakeServer()
    const { seen, fn } = recorder()
    await runnerFor(server, 'plain', {} as any, fn, never)()

    expect(seen.length).toBe(1)
    expect(seen[0].ctx).toBe(CONTROL)
    expect(seen[0].tenant).toBe(undefined)
  })

  it('runs inside the named container, and gives it back', async () => {
    const server = fakeServer()
    const { seen, fn } = recorder()
    await runnerFor(server, 'nightly', { scope: 'tenant', tenant: 'acme' } as any, fn, never)()

    expect(seen[0].ctx.kind).toBe('tenant')
    expect(seen[0].ctx.tenantId).toBe('id-acme')
    expect(seen[0].tenant).toBe('acme')
    // The lease is released whether the job succeeded or not: a job is not a request, but
    // it borrows a container the same way (T-3.1).
    expect(server.provider.released.length).toBe(1)
  })

  it('refuses a tenant that is not active instead of falling back', async () => {
    const server = fakeServer()
    const { seen, fn } = recorder()
    await expect(runnerFor(server, 'nightly', { scope: 'tenant', tenant: 'dormant' } as any, fn, never)()).rejects.toThrow(
      /is suspended/
    )
    expect(seen.length).toBe(0)
  })

  it('refuses an unknown tenant', async () => {
    const server = fakeServer()
    const { fn } = recorder()
    await expect(runnerFor(server, 'nightly', { scope: 'tenant', tenant: 'nowhere' } as any, fn, never)()).rejects.toThrow(
      /not in the registry/
    )
  })

  it('runs once per active tenant, each with its own container', async () => {
    const server = fakeServer()
    const { seen, fn } = recorder()
    await runnerFor(server, 'sweep', { scope: 'every-tenant', concurrency: 2 } as any, fn, never)()

    expect(seen.map((s) => s.tenant).sort()).toEqual(['acme', 'globex'])
    expect(seen.every((s) => s.ctx.kind === 'tenant')).toBe(true)
    expect(new Set(seen.map((s) => s.ctx.tenantId)).size).toBe(2)
    // Suspended tenants are not part of the fleet a job walks.
    expect(seen.some((s) => s.tenant === 'dormant')).toBe(false)
    expect(server.provider.released.length).toBe(2)
  })

  it('does not let one tenant cancel the others, and reports them all', async () => {
    const server = fakeServer()
    const visited: string[] = []
    const fn = async (_ctx: any, run: any) => {
      visited.push(run.tenant.slug)
      if (run.tenant.slug === 'acme') throw new Error('disk full')
    }

    await expect(runnerFor(server, 'sweep', { scope: 'every-tenant' } as any, fn, never)()).rejects.toThrow(
      /failed on 1 of 2 tenants[\s\S]*acme: disk full/
    )
    // globex ran anyway: a fan-out that stops halfway is the hardest kind to notice.
    expect(visited.sort()).toEqual(['acme', 'globex'])
    expect(server.provider.released.length).toBe(2)
  })

  it('stops the fan-out when the server closes', async () => {
    const server = fakeServer()
    const closing = new AbortController()
    closing.abort()
    const { seen, fn } = recorder()

    await runnerFor(server, 'sweep', { scope: 'every-tenant' } as any, fn, closing.signal)()
    expect(seen.length).toBe(0)
  })

  it('refuses to run at all without a data layer', async () => {
    const { fn } = recorder()
    await expect(runnerFor({} as any, 'plain', {} as any, fn, never)()).rejects.toThrow(/no data layer is loaded/)
  })
})

describe('loader/schedules · what loads and what does not (T-3.4)', () => {
  const cwd = process.cwd()

  before(() => {
    ;(global as any).config = { options: { tenants: { strategy: 'schema', engine: 'postgres' } } }
    process.chdir(FIXTURES)
  })

  after(() => {
    process.chdir(cwd)
    ;(global as any).config = undefined
  })

  it('loads a job that names a plane, and refuses the ones that do not', () => {
    const jobs = load()
    const names = jobs.map((j: any) => j.jobName).sort()

    // `plain` declares nothing and is kept: its plane is the control plane, by default.
    expect(names).toEqual(['good.job', 'plain.job'])
    expect(jobs.find((j: any) => j.jobName === 'good.job').schedule.concurrency).toBe(2)
    expect(jobs.find((j: any) => j.jobName === 'plain.job').schedule.scope).toBe('control')
  })
})
