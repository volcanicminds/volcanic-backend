// Root hooks: boot the multi-tenant app + embedded PGlite ONCE for the whole
// e2e-mt run (shared by every *.e2e.spec.ts here), torn down at the end.
import { setup, teardown } from './harness.js'

before(async function () {
  this.timeout(60000)
  await setup()
})

after(async () => await teardown())
