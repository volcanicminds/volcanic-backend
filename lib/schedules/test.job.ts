import type { DataHandle, JobRun, JobSchedule } from '../../types/global.js'

//
// The shape of a job in v5 (T-3.4). Two things it does NOT do, and both are the point:
// it does not look a connection up, and it does not decide where it runs. The schedule
// declares the plane, the framework hands over the matching handle.
//
// `scope` defaults to 'control'. The alternatives are `scope: 'tenant'` with
// `tenant: '<slug>'`, and `scope: 'every-tenant'`, which runs the same job once per active
// tenant with the right container each time.
//
export const schedule: JobSchedule = {
  active: false,
  scope: 'control',
  interval: {
    seconds: 10
  }
}

export async function job(_ctx: DataHandle, run: JobRun) {
  log.info(`tick job ${run.jobName} every 10 seconds`)
}
