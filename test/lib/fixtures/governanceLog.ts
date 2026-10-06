/* eslint-disable @typescript-eslint/no-explicit-any */
//
// A governance log in memory (F76), for the suites that mount governance routes on fakes. `within`
// is the real contract in miniature: the rows recorded inside a change that throws are dropped,
// as a rollback drops them.
//
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
    async findQuery() {
      return { headers: {}, records: [...rows] } as any
    },
    async countQuery() {
      return rows.length
    }
  }
}
