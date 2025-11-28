/* eslint-disable @typescript-eslint/no-explicit-any */
import { startUp, uploadData, tearDown, buildTasks } from './common/bootstrap.js'
import { createRequire } from 'module'

import demo from './demo/index.js'
import unit from './unit/index.js'
import e2e from './e2e/index.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const beforeAll = (global as any).beforeAll || global.before
const afterAll = (global as any).afterAll || global.after

beforeAll(async () => {
  await startUp()
  await uploadData()
})
afterAll(async () => await tearDown())

describe(`Test: ${pkg.name}@${pkg.version} on node@${process.version}`, async () => {
  const tasks = buildTasks()
  if (tasks.e2e) await e2e()
  if (tasks.unit) await unit()
  if (tasks.demo) await demo()
})
