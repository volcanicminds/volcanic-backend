// ┌──────────────── (optional) second (0 - 59)
// │ ┌────────────── minute (0 - 59)
// │ │ ┌──────────── hour (0 - 23)
// │ │ │ ┌────────── day of month (1 - 31)
// │ │ │ │ ┌──────── month (1 - 12, JAN-DEC)
// │ │ │ │ │ ┌────── day of week (0 - 6, SUN-Mon)
// │ │ │ │ │ │       (0 to 6 are Sunday to Saturday; 7 is Sunday, the same as 0)
// │ │ │ │ │ │
// * * * * * *

import { JobSchedule } from '../../types/global'

// totalIntervalMs = milliseconds +
// seconds * 1000 +
// minutes * 60 * 1000 +
// hours * 60 * 60 * 1000 +
// days * 24 * 60 * 60 * 1000

export const schedule: JobSchedule = {
  active: false,
  interval: {
    seconds: 2
  }
}

export async function job() {
  log.info('tick job TEST every 2 seconds')
}
