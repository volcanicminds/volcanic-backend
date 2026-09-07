/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-1.4: the capability matrix refuses, at boot, every combination the framework cannot
// isolate. Each of these ran as a warning in v4 and then served traffic without isolation
// (D-04). `onFatal` is injected so a refusal does not kill the test process — the same
// pattern lib/util/secret.ts already uses.
//
import { expect } from 'expect'
import { assertSupported, supports, supportedCombinations, resolveTenancy } from '../../lib/database/capabilities.js'

const refusal = (options: any, opts: any = {}) => {
  let message: string | null = null
  assertSupported(options, { ...opts, onFatal: (m: string) => (message = m) })
  return message as string | null
}

describe('database/capabilities', () => {
  it('accepts the four combinations the framework actually builds', () => {
    expect(refusal({ control: { engine: 'postgres' } })).toBeNull()
    expect(refusal({ control: { engine: 'postgres' }, tenants: { strategy: 'schema', engine: 'postgres' } })).toBeNull()
    expect(refusal({ control: { engine: 'postgres' }, tenants: { strategy: 'container', engine: 'postgres' } })).toBeNull()
    expect(refusal({ control: { engine: 'postgres' }, tenants: { strategy: 'container', engine: 'sqlite' } })).toBeNull()
    expect(refusal({ control: { engine: 'libsql' } })).toBeNull()
  })

  it('refuses schema-per-tenant where schemas do not exist', () => {
    for (const engine of ['sqlite', 'libsql']) {
      const message = refusal({ control: { engine: 'postgres' }, tenants: { strategy: 'schema', engine } })
      expect(message).toContain(engine)
      expect(message).toContain('schema')
    }
  })

  it('refuses pglite as an engine for tenants, at any time', () => {
    // The matrix answers first: pglite has no container and no schema strategy at all.
    const message = refusal({ control: { engine: 'postgres' }, tenants: { strategy: 'container', engine: 'pglite' } })
    expect(message).toContain("'pglite' does not support strategy 'container'")
  })

  it('refuses a pglite control plane under tenancy in production', () => {
    // Reachable combination: the tenants live in files, the registry would live in pglite.
    const options = { control: { engine: 'pglite' }, tenants: { strategy: 'container', engine: 'sqlite' } }
    expect(refusal(options, { prod: true })).toContain('single shared connection')
    // Outside production it is a legitimate development setup, so it must NOT be refused.
    expect(refusal(options, { prod: false })).toBeNull()
  })

  it('names an unknown engine instead of guessing one', () => {
    // Mongo is not an adapter in v5: the data layer dropped it, and the matrix says so
    // instead of warning and serving requests without isolation, which is what v4 did.
    expect(refusal({ control: { engine: 'mongodb' } })).toContain("unknown engine 'mongodb'")
    expect(refusal({ tenants: { strategy: 'schema', engine: 'cassandra' } })).toContain("unknown engine 'cassandra'")
  })

  it('suggests a way out, not just a refusal', () => {
    const message = refusal({ control: { engine: 'postgres' }, tenants: { strategy: 'schema', engine: 'sqlite' } })
    expect(message).toContain('Supported combinations')
    expect(message).toContain('postgres + schema')
  })

  it('treats a missing tenants block as single tenant', () => {
    expect(resolveTenancy({ control: { engine: 'postgres' } } as any).strategy).toBe('none')
    expect(resolveTenancy({ control: { engine: 'postgres' }, tenants: null } as any).strategy).toBe('none')
  })

  it('is a property of the code: the matrix is not configurable', () => {
    expect(supports('postgres', 'schema')).toBe(true)
    expect(supports('sqlite', 'schema')).toBe(false)
    expect(supportedCombinations()).toContain('sqlite + container')
    expect(supportedCombinations()).not.toContain('sqlite + schema')
  })
})
