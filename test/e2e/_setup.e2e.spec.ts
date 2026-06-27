// Root hooks: boot the app + embedded PGlite ONCE for the whole e2e run, and
// tear it down at the end. All other e2e specs use `app()` from the harness.
import { setup, teardown } from './harness.js'

before(async function () {
  this.timeout(60000)
  await setup()
})

after(async () => await teardown())
