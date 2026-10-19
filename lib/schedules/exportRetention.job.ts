import type { ControlHandle, DataHandle, GovernanceLogManagement, JobRun, JobSchedule } from '../../types/global.js'
import { exportRetention, expirePackages, type ContainerProvider } from '../util/tenantExport.js'

//
// The cleanup of the export directory: every hour, the packages of the two planes' slots older than
// TENANT_EXPORT_RETENTION_DAYS go, each with its `tenant.export_expired` event. Off by default, and
// off without the scheduler: the start says so where there are tenants (index.ts). A destruction's
// package has no slot and stays. A package on the server is not a backup: that is the infrastructure's.
//
export const schedule: JobSchedule = {
  // Read at each load, not at the first import: the module is cached, the configuration is not.
  get active() {
    return exportRetention().off === null
  },
  scope: 'control',
  interval: { hours: 1, runImmediately: true }
}

export async function job(ctx: DataHandle, run: JobRun) {
  const server = global.server as unknown as Record<string, unknown>
  await expirePackages(
    {
      governance: server['governanceLogManager'] as GovernanceLogManagement | undefined,
      ctx: ctx as unknown as ControlHandle,
      provider: server['provider'] as ContainerProvider | undefined
    },
    exportRetention().days,
    run.signal
  )
}
