import { JobSchedule } from '../../types/global'

export const schedule: JobSchedule = {
  active: false,
  interval: {
    seconds: 10
  }
}

export async function job() {
  log.info('tick job TEST every 10 seconds')
}
