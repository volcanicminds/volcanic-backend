import type { DataRequestScope } from '../../types/global.js'

//
// Who is using which container, right now (T-3.1, point 4).
//
// Two things need this. The LRU that bounds live containers must not evict one a request is
// still holding: on SQLite that would close the file descriptor under it, on Postgres it
// would only churn the table cache, but the rule is the same and having it in one place is
// how it stays the same. And the release path needs to know what a request took, because
// "release everything this request borrowed" has to be answerable in one call: v4 released
// in two places, in the wrong order, and that is D-01.
//
// Deliberately not a refcount per container: the unit is the request, so a leaked
// decrement cannot pin a container forever. The scope is released once, whole, by the
// single point that owns it.
//
export class RequestLeases {
  private readonly byRequest = new Map<string, Set<string>>()
  private readonly holders = new Map<string, number>()

  /** Records that a request is using a container. Idempotent per request and locator. */
  take(scope: DataRequestScope | undefined, locator: string): void {
    if (!scope?.requestId) return
    let taken = this.byRequest.get(scope.requestId)
    if (!taken) {
      taken = new Set<string>()
      this.byRequest.set(scope.requestId, taken)
    }
    if (taken.has(locator)) return
    taken.add(locator)
    this.holders.set(locator, (this.holders.get(locator) || 0) + 1)
  }

  /** Gives back everything a request took. A second call is a no-op, never a double free. */
  release(scope: DataRequestScope | undefined): void {
    const requestId = scope?.requestId
    if (!requestId) return
    const taken = this.byRequest.get(requestId)
    if (!taken) return
    this.byRequest.delete(requestId)
    for (const locator of taken) {
      const left = (this.holders.get(locator) || 1) - 1
      if (left > 0) this.holders.set(locator, left)
      else this.holders.delete(locator)
    }
  }

  /** True while at least one live request is holding this container. */
  inUse(locator: string): boolean {
    return (this.holders.get(locator) || 0) > 0
  }

  /** Live requests holding something. Exposed for tests and for a shutdown that must not hang. */
  get size(): number {
    return this.byRequest.size
  }
}
