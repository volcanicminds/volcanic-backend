/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { start as startServer } from '@volcanicminds/backend'
import { start as startDatabase, DataSource, userManager } from '@volcanicminds/typeorm'

export const DEFAULT_ADMIN_EMAIL = 'admin@user.com'
export const DEFAULT_ADMIN_PASSWORD = '71iD$k%3X#m4'
export const COMPANY2_SUPERUSER_EMAIL = 'user@volcanicminds.ai'
export const COMPANY2_SUPERUSER_PASSWORD = '44O$^yWqn@R4'

let server: any

const startStuffServer = true

export async function startUp() {
  try {
    log.level = 'trace'

    if (startStuffServer) {
      server = await startServer({ userManager: userManager })
    }
  } catch (err) {
    console.log(err)
    throw err
  }
}

export async function uploadData() {
  // logic removed
}

export async function tearDown() {
  if (startStuffServer) {
    await server.close()
  }
  process.exit(0)
}

export function buildTasks() {
  const taskToSkip = (process.env.MOCHA_SKIP_TASK || '').toLowerCase().split(',')

  return {
    demo: !taskToSkip.includes('demo'),
    unit: !taskToSkip.includes('unit'),
    e2e: !taskToSkip.includes('e2e')
  }
}
