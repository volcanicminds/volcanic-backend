/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-10.9: the container limits, read along the path a real boot takes.
//
// T-9.4 wired `TENANT_CONTAINERS_MAX_OPEN` back into the adapter as
// `configured ?? environment ?? default`, and its tests proved the environment helper. What no
// test followed was the value from the loader to the adapter: `normalizeOptions` filled
// `tenants.containers.maxOpen` with the default for every deployment that declared tenants,
// so "configured" was always true and the `??` never reached the environment. The variable
// was unread again, in the one case where it matters.
//
// So these tests start where a boot starts, from `normalizeOptions`, and read what the provider
// ended up with. Constructing a provider opens nothing: the pools are lazy.
//
import { expect } from 'expect'
import { normalizeOptions } from '../../lib/loader/general.js'
import { createPostgresProvider } from '../../lib/database/adapters/postgres/index.js'

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
      const provider: any = await createPostgresProvider(declared({ strategy: 'schema', engine: 'postgres' }))
      try {
        expect(provider.maxOpenContainers).toBe(7)
      } finally {
        await provider.shutdown()
      }
    })
  })

  it('lets the configuration win over the environment', async () => {
    await withEnv('TENANT_CONTAINERS_MAX_OPEN', '7', async () => {
      const provider: any = await createPostgresProvider(
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
      const provider: any = await createPostgresProvider(declared({ strategy: 'schema', engine: 'postgres' }))
      try {
        expect(provider.maxOpenContainers).toBe(20)
      } finally {
        await provider.shutdown()
      }
    })
  })
})
