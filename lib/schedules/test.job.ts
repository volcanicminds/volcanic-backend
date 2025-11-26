import type { JobSchedule } from '../../types/global.js'

export const schedule: JobSchedule = {
  active: false,
  interval: {
    seconds: 10
  }
}

export async function job() {
  log.info('tick job TEST every 10 seconds')
}
