import { startUp, tearDown, buildTasks } from './common/bootstrap'

import demo from './demo'
import unit from './unit'
import e2e from './e2e'

const pkg = require('../package.json')

const beforeAll = global.beforeAll || global.before
const afterAll = global.afterAll || global.after

beforeAll(async () => await startUp())
afterAll(async () => await tearDown())

describe(`Test: ${pkg.name}@${pkg.version} on node@${process.version}`, async () => {
  const tasks = buildTasks()
  tasks.e2e && (await e2e())
  tasks.unit && (await unit())
  tasks.demo && (await demo())
})
