//
// The lock of a data layer in memory, as PGlite holds it: a name taken twice answers null, the
// second caller does not wait. `held` lets a test hold a name from outside, as another process would.
//
export function fakeLock() {
  const held = new Set<string>()
  return {
    held,
    async withLock<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
      if (held.has(name)) return null
      held.add(name)
      try {
        return await fn()
      } finally {
        held.delete(name)
      }
    }
  }
}
