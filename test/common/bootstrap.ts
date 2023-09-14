const { start: startServer } = require('../../index')

export const DEFAULT_ADMIN_EMAIL = 'admin@user.com'
export const DEFAULT_ADMIN_PASSWORD = '71iD$k%3X#m4'
export const COMPANY2_SUPERUSER_EMAIL = 'user@volcanicminds.ai'
export const COMPANY2_SUPERUSER_PASSWORD = '44O$^yWqn@R4'

let server: any

export async function startUp() {
  try {
    global.log.level = 'warn'
    server = await startServer()
  } catch (err) {
    console.log(err)
    throw err
  }
}

export async function tearDown() {
  await server.close()
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
