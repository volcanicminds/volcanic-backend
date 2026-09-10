/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-10.9: the container limits, read along the path a real boot takes.
//
// T-9.4 wired `TENANT_CONTAINERS_MAX_OPEN` and `TENANT_CONTAINERS_DIR` back into the adapters as
// `configured ?? environment ?? default`, and its tests proved the environment helper. What no
// test followed was the value from the loader to the adapter: `normalizeOptions` filled
// `tenants.containers.maxOpen` and `.directory` with the defaults for every deployment that
// declared tenants, so "configured" was always true and the `??` never reached the
// environment. The variables were unread again, in the one case where they matter.
//
// So these tests start where a boot starts, from `normalizeOptions`, and read what the provider
// ended up with. Constructing a provider opens nothing: the pools are lazy.
//
import { expect } from 'expect'
import { normalizeOptions } from '../../lib/loader/general.js'
import { createPostgresProvider } from '../../lib/database/adapters/postgres/index.js'
import { createSqliteProvider } from '../../lib/database/adapters/sqlite/index.js'

;(global as any).log = (global as any).log || {}

const withEnv = async (name: string, value: string | undefined, fn: () => Promise<void> | void) => {
  const previous = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    await fn()
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

const declared = (tenants: any) =>
  normalizeOptions({ control: { engine: 'postgres', url: 'postgres://x:y@127.0.0.1:1/z' }, tenants } as any)

describe('container limits · from the loader to the adapter (T-10.9)', () => {
  it('reads TENANT_CONTAINERS_MAX_OPEN when the configuration does not say', async () => {
    await withEnv('TENANT_CONTAINERS_MAX_OPEN', '7', async () => {
      const provider: any = createPostgresProvider(declared({ strategy: 'schema', engine: 'postgres' }))
      try {
        expect(provider.maxOpenContainers).toBe(7)
      } finally {
        await provider.shutdown()
      }
    })
  })

  it('lets the configuration win over the environment', async () => {
    await withEnv('TENANT_CONTAINERS_MAX_OPEN', '7', async () => {
      const provider: any = createPostgresProvider(
        declared({ strategy: 'schema', engine: 'postgres', containers: { maxOpen: 4 } })
      )
      try {
        expect(provider.maxOpenContainers).toBe(4)
      } finally {
        await provider.shutdown()
      }
    })
  })

  it('falls back to the documented default when neither says', async () => {
    await withEnv('TENANT_CONTAINERS_MAX_OPEN', undefined, async () => {
      const provider: any = createPostgresProvider(declared({ strategy: 'schema', engine: 'postgres' }))
      try {
        expect(provider.maxOpenContainers).toBe(20)
      } finally {
        await provider.shutdown()
      }
    })
  })

  it('reads TENANT_CONTAINERS_DIR for the per-tenant files on SQLite', async () => {
    await withEnv('TENANT_CONTAINERS_DIR', '/tmp/volcanic-t-10-9', () => {
      const options: any = normalizeOptions({
        control: { engine: 'sqlite', url: ':memory:' },
        tenants: { strategy: 'container', engine: 'sqlite' }
      } as any)
      const provider: any = createSqliteProvider(options)
      expect(provider.directory).toBe('/tmp/volcanic-t-10-9')
    })
  })
})
