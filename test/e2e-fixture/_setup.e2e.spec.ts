// Root hooks: boot the consumer-app fixture (framework + ./test/fixtures/app/src)
// once for the whole e2e-fixture run.
import { setup, teardown } from './harness.js'

before(async function () {
  this.timeout(60000)
  await setup()
})

after(async () => await teardown())
