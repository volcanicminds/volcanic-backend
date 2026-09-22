//
// T-12.33: the fan-out behind `npx volcanic <sessions|auth-flows|access-log> --purge --tenants`.
// The registry is paged, and the loop has to reach the containers past any page boundary: a fixed
// ceiling would skip them without saying so.
//
import { expect } from 'expect'
import { purgeContainers, PURGE_PAGE_SIZE } from '../../lib/database/purge.js'

function fleet(size: number) {
  const tenants = Array.from({ length: size }, (_, i) => ({ id: `t-${i + 1}`, status: 'active' }))
  const queries: Array<Record<string, unknown>> = []
  const layer = {
    provider: { control: () => ({ kind: 'control' }) as never, tenant: (id: string) => ({ kind: 'tenant', id }) as never },
    tenantManager: {
      listTenants: async (_ctx: unknown, query: Record<string, unknown> = {}) => {
        queries.push(query)
        const page = Number(query._page)
        const size = Number(query._pageSize)
        return { records: tenants.slice((page - 1) * size, page * size) as never, headers: {} as never }
      }
    }
  }
  return { layer, queries }
}

describe('database · the purge fan-out over the fleet (T-12.33)', () => {
  it('passes over every active container past the first thousand, the control plane included', async () => {
    const { layer, queries } = fleet(1050)
    const visited: string[] = []
    const result = await purgeContainers(layer, { purgeExpired: async (ctx) => (visited.push((ctx as { id?: string }).id ?? 'control'), 2) }, { tenants: true })

    expect(result).toEqual({ removed: 1051 * 2, containers: 1051 })
    expect(visited[0]).toBe('control')
    expect(new Set(visited.slice(1)).size).toBe(1050)
    expect(visited).toContain('t-1050')
    expect(queries.every((q) => q['status:eq'] === 'active' && q._pageSize === PURGE_PAGE_SIZE)).toBe(true)
  })

  it('stops on an exact page boundary with one empty page, not before', async () => {
    const { layer, queries } = fleet(2 * PURGE_PAGE_SIZE)
    const result = await purgeContainers(layer, { purgeExpired: async () => 0 }, { tenants: true })
    expect(result.containers).toBe(2 * PURGE_PAGE_SIZE + 1)
    expect(queries.map((q) => q._page)).toEqual([1, 2, 3])
  })

  it('touches the control plane alone without --tenants', async () => {
    const { layer, queries } = fleet(5)
    expect(await purgeContainers(layer, { purgeExpired: async () => 3 })).toEqual({ removed: 3, containers: 1 })
    expect(queries).toEqual([])
  })
})
