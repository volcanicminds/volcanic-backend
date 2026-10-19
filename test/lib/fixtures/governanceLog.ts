/* eslint-disable @typescript-eslint/no-explicit-any */
//
// A governance log in memory, for the suites that mount governance routes on fakes. `within`
// is the real contract in miniature: the rows recorded inside a change that throws are dropped,
// as a rollback drops them.
//
import { operatorFor } from '../../../lib/database/query/operators.js'
import type { GovernanceLogEntry, GovernanceLogManagement } from '../../../types/global.js'

export interface FakeGovernanceLog extends GovernanceLogManagement {
  readonly rows: (GovernanceLogEntry & { id: string })[]
}

export function fakeGovernanceLog(): FakeGovernanceLog {
  const rows: (GovernanceLogEntry & { id: string })[] = []
  let next = 0
  return {
    rows,
    isImplemented: () => true,
    async record(_ctx, entry) {
      const row = { ...entry, id: `gov-${++next}`, occurredAt: new Date() }
      rows.push(row)
      return row
    },
    async within(ctx, change) {
      const mark = rows.length
      try {
        return await change(ctx)
      } catch (error) {
        rows.splice(mark)
        throw error
      }
    },
    // The part of Magic Query the export's quota asks: equalities, `occurredAt:ge`, `_sort=-occurredAt`, `_pageSize`.
    // An operator is named through the real catalogue, so a name Postgres would refuse is refused here too.
    async findQuery(_ctx, query: Record<string, unknown> = {}) {
      for (const key of Object.keys(query).filter((k) => k.includes(':'))) {
        const [field, name] = key.split(':')
        operatorFor(name)
        if (`${field}:${name}` !== 'occurredAt:ge') throw new Error(`The fake governance log does not implement '${key}'`)
      }
      const since = query['occurredAt:ge'] ? new Date(String(query['occurredAt:ge'])).getTime() : -Infinity
      const found = rows.filter(
        (row: any) =>
          new Date(row.occurredAt).getTime() >= since &&
          Object.entries(query).every(([key, value]) => key.startsWith('_') || key.includes(':') || row[key] === value)
      )
      if (query._sort === '-occurredAt') found.reverse()
      return { headers: {}, records: query._pageSize ? found.slice(0, Number(query._pageSize)) : found } as any
    },
    async countQuery() {
      return rows.length
    }
  }
}
