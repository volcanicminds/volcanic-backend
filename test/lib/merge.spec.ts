/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-1.1: the configuration merge. The first test is the regression for D-21, where a
// consumer declaring one key inside a nested block silently lost that block's siblings.
//
import { expect } from 'expect'
import { deepMerge } from '../../lib/util/merge.js'
import { normalizeOptions } from '../../lib/loader/general.js'

describe('lib/util/merge · deepMerge', () => {
  it('keeps the siblings a consumer did not mention (D-21)', () => {
    const base = { tenants: { strategy: 'container', resolver: 'header', headerKey: 'x-tenant-id' } }
    const merged = deepMerge(base, { tenants: { strategy: 'schema' } })

    expect(merged.tenants).toEqual({ strategy: 'schema', resolver: 'header', headerKey: 'x-tenant-id' })
  })

  it('merges more than one level down', () => {
    const base = { tenants: { containers: { maxOpen: 20, poolMax: 2 } } }
    const merged = deepMerge(base, { tenants: { containers: { maxOpen: 5 } } })

    expect(merged.tenants.containers).toEqual({ maxOpen: 5, poolMax: 2 })
  })

  it('replaces arrays instead of concatenating them', () => {
    const merged = deepMerge({ origins: ['a', 'b'] }, { origins: ['c'] })

    // An allowlist the consumer writes is the allowlist. Appending to a framework default
    // would silently keep an origin they meant to drop.
    expect(merged.origins).toEqual(['c'])
  })

  it('clears with null and ignores undefined', () => {
    const base = { a: 1, b: 2 }
    expect(deepMerge(base, { a: null }).a).toBeNull()
    expect(deepMerge(base, { b: undefined }).b).toBe(2)
  })

  it('does not walk into the prototype', () => {
    const merged: any = deepMerge({ safe: true }, JSON.parse('{"__proto__": {"polluted": true}}'))

    expect(merged.safe).toBe(true)
    expect(({} as any).polluted).toBeUndefined()
    expect(Object.getPrototypeOf(merged).polluted).toBeUndefined()
  })

  it('replaces non-plain values wholesale', () => {
    const when = new Date('2026-09-07T00:00:00Z')
    expect(deepMerge({ when: new Date(0) }, { when }).when).toBe(when)
  })
})

describe('lib/loader/general · normalizeOptions', () => {
  it('leaves a single-tenant deployment single-tenant', () => {
    expect(normalizeOptions({ tenants: null } as any).tenants).toBeNull()
    expect(normalizeOptions({} as any).tenants).toBeUndefined()
  })

  it('fills the tenant defaults only when the block is declared', () => {
    const options: any = normalizeOptions({ tenants: { strategy: 'schema', engine: 'postgres' } } as any)

    expect(options.tenants.resolver).toBe('header')
    expect(options.tenants.headerKey).toBe('x-tenant-id')
    expect(options.tenants.containers.maxOpen).toBe(20)
    expect(options.tenants.migrations.checkOnResolve).toBe(true)
  })

  it('does not overwrite what the consumer declared', () => {
    const options: any = normalizeOptions({
      tenants: { strategy: 'schema', engine: 'postgres', resolver: 'subdomain', containers: { maxOpen: 4 } }
    } as any)

    expect(options.tenants.resolver).toBe('subdomain')
    expect(options.tenants.containers.maxOpen).toBe(4)
    expect(options.tenants.containers.poolMax).toBe(2) // il default sopravvive accanto
  })
})
