/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from 'lodash'
import type { DataHandle, DataProvider, JobFunction, JobRun, JobSchedule, Tenant, TenantManagement } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { CronJob, SimpleIntervalJob, Task, AsyncTask } from 'toad-scheduler'
import { globSync } from 'glob'
import path from 'path'
import require from '../util/require.js'
import { isTenancyEnabled } from '../util/tenancy.js'

//
// Scheduled jobs, and where they run (T-3.4).
//
// In v4 a job was called with no arguments at all. Anything it read went through
// `global.connection`, so it ran on whatever connection the pool handed over, which in a
// multi-tenant deployment meant an arbitrary customer's schema (defect D-07). The job could
// not have done better: there was nothing to ask.
//
// In v5 a job DECLARES its plane and RECEIVES its handle. It never looks one up, so there is
// no path where the answer is "whatever was lying around":
//
//   scope: 'control'       the platform. The default, because a job that says nothing must
//                          not end up inside a customer's data
//   scope: 'tenant'        one named container, `tenant: '<slug>'`
//   scope: 'every-tenant'  once per active tenant, with the right handle each time
//
// The fan-out has the risk profile of the fleet migrator (T-5.3): it is bounded in
// concurrency, it stops when the server closes, and one tenant's failure does not cancel the
// others. It reports them all at the end instead, because a run that half worked and said
// nothing is worse than a run that failed.
//
const MAX_CONCURRENCY = 16
const TENANT_PAGE = 100

export function load(): any[] {
  const patterns = normalizePatterns(['..', 'schedules', '*.job.{ts,js}'], ['src', 'schedules', '*.job.{ts,js}'])
  const jobs: any = []

  const jobScheduleDefaults: JobSchedule = {
    active: false,
    type: 'interval',
    async: true,
    preventOverrun: true,
    scope: 'control',
    concurrency: 1,

    cron: {},

    interval: {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
      milliseconds: 0,
      runImmediately: false
    }
  }

  patterns.forEach((pattern) => {
    if (log.t) log.trace('Looking for ' + pattern)
    globSync(pattern, { windowsPathsNoEscape: true }).forEach((f: string) => {
      if (log.t) log.trace(`* Add job schedule from ${f}`)

      const jobName = path.basename(f, path.extname(f))
      const { job, schedule: s } = require(f)

      let isLoadedAndEnabled = false
      if (s && s.active) {
        isLoadedAndEnabled = true

        let schedule = _.cloneDeep(jobScheduleDefaults)
        schedule = _.merge(schedule, s)

        // Reported at error level, not trace: a job that silently does not exist is the
        // same operational surprise as a job that runs in the wrong place.
        const reject = (why: string) => {
          if (log.e) log.error(`* Job ${jobName}: ${why}`)
          isLoadedAndEnabled = false
        }

        if (!job || typeof job !== 'function') reject('no exported `job` function')

        if (!schedule.type || !['cron', 'interval'].includes(schedule.type)) {
          reject('schedule.type must be cron or interval')
        }

        if (schedule.type === 'cron' && !schedule.cron?.expression) {
          reject('schedule.cron.expression not defined')
        }

        if (schedule.type === 'interval') {
          const { days = 0, hours = 0, minutes = 0, seconds = 0, milliseconds = 0 } = schedule.interval || {}
          const totalIntervalMs = milliseconds + 1000 * (seconds + 60 * (minutes + 60 * (hours + 24 * days)))

          if (totalIntervalMs < 1000) {
            reject('schedule.interval must have a total greater or equal to 1s')
          }
        }

        // Where it runs is checked here, at load, and not at the first tick: a job that
        // names a plane the deployment does not have is a configuration mistake, and the
        // moment to say so is before it has run once.
        const scope = schedule.scope || 'control'
        if (!['control', 'tenant', 'every-tenant'].includes(scope)) {
          reject(`unknown scope '${scope}'. Use 'control', 'tenant' or 'every-tenant'`)
        }
        if (scope === 'tenant' && !schedule.tenant) {
          reject("scope 'tenant' needs `tenant: '<slug>'`: it says which container, and there is no default")
        }
        if (scope !== 'control' && !isTenancyEnabled()) {
          reject(`scope '${scope}' needs a \`tenants\` block: this deployment has none`)
        }

        if (isLoadedAndEnabled) {
          jobs.push({ jobName, schedule, job })
        }
      }

      if (log.d) log.debug(`* Job schedule ${jobName} ${isLoadedAndEnabled ? 'enabled' : 'disabled'}`)
    })
  })

  if (log.i) log.info(`Scheduled Jobs loaded: ${jobs?.length || 0}`)
  return jobs
}

/**
 * Wraps a job into the function the scheduler calls, which is where the handle is chosen.
 *
 * Exported so the decision can be tested without a scheduler and without a clock: what
 * matters is which container each invocation received, not when it fired.
 */
export function runnerFor(server: any, jobName: string, schedule: JobSchedule, fn: JobFunction, signal: AbortSignal) {
  const scope = schedule.scope || 'control'

  return async function run(): Promise<void> {
    const provider = server?.['provider'] as DataProvider | undefined
    if (!provider) throw new Error(`Job ${jobName}: no data layer is loaded, so there is no context to run in`)

    const control = (await provider.control()) as DataHandle
    if (scope === 'control') {
      await fn(control, { jobName, signal })
      return
    }

    const tm = server['tenantManager'] as TenantManagement
    if (!tm?.isImplemented?.()) throw new Error(`Job ${jobName}: tenancy is declared but no tenant manager can resolve it`)

    if (scope === 'tenant') {
      const tenant = await tm.getTenantBySlug(control as never, String(schedule.tenant))
      if (!tenant) throw new Error(`Job ${jobName}: tenant '${schedule.tenant}' is not in the registry`)
      if (tenant.status !== 'active') throw new Error(`Job ${jobName}: tenant '${tenant.slug}' is ${tenant.status}`)
      await inTenant(provider, jobName, tenant, fn, signal)
      return
    }

    await everyTenant(provider, tm, control, jobName, schedule, fn, signal)
  }
}

/**
 * One tenant, one lease. The container is borrowed and given back around the call, exactly
 * as a request does (T-3.1), so a long fan-out cannot pin every container it has visited.
 */
async function inTenant(
  provider: DataProvider,
  jobName: string,
  tenant: Tenant,
  fn: JobFunction,
  signal: AbortSignal
): Promise<void> {
  const scope = { requestId: `job:${jobName}:${tenant.id}:${Date.now()}` }
  try {
    const handle = await provider.tenant(tenant.id, scope)
    await fn(handle as DataHandle, { jobName, tenant, signal })
  } finally {
    await provider.releaseRequestScope(scope)
  }
}

async function everyTenant(
  provider: DataProvider,
  tm: TenantManagement,
  control: DataHandle,
  jobName: string,
  schedule: JobSchedule,
  fn: JobFunction,
  signal: AbortSignal
): Promise<void> {
  const tenants = await activeTenants(tm, control)
  if (tenants.length === 0) {
    if (log.d) log.debug(`Job ${jobName}: no active tenant to run on`)
    return
  }

  const width = Math.min(Math.max(1, Math.trunc(Number(schedule.concurrency) || 1)), MAX_CONCURRENCY)
  const failures: string[] = []
  let next = 0
  let stopped = false

  const worker = async () => {
    for (;;) {
      if (signal.aborted) {
        stopped = true
        return
      }
      const index = next++
      if (index >= tenants.length) return

      const tenant = tenants[index]
      try {
        await inTenant(provider, jobName, tenant, fn, signal)
      } catch (e) {
        // Collected, not rethrown: one customer's failure is not a reason to skip the
        // others, and a fan-out that stops halfway is the hardest kind to notice.
        const message = e instanceof Error ? e.message : String(e)
        failures.push(`${tenant.slug}: ${message}`)
        if (log.e) log.error(`Job ${jobName} failed on tenant ${tenant.slug}: ${message}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(width, tenants.length) }, worker))

  const ran = Math.min(next, tenants.length) - failures.length
  if (log.i) log.info(`Job ${jobName}: ${ran}/${tenants.length} tenants ok${stopped ? ', interrupted' : ''}`)

  if (failures.length) {
    throw new Error(`Job ${jobName} failed on ${failures.length} of ${tenants.length} tenants:\n  - ${failures.join('\n  - ')}`)
  }
}

/** Every active tenant, paged: a fleet is not something to read in one query. */
async function activeTenants(tm: TenantManagement, control: DataHandle): Promise<Tenant[]> {
  const all: Tenant[] = []
  for (let page = 1; ; page++) {
    const result: any = await tm.listTenants(control as never, {
      'status:eq': 'active',
      _page: page,
      _pageSize: TENANT_PAGE
    } as never)
    const records: Tenant[] = result?.records ?? []
    all.push(...records)
    if (records.length < TENANT_PAGE) return all
  }
}

export function start(server: any, jobs: any[]) {
  if (!jobs || jobs.length === 0) return

  log.trace('* Job schedule attach all tasks')

  // One signal for the whole scheduler: closing the server stops a fan-out in progress
  // rather than letting it walk the rest of the fleet against a shutting-down pool.
  const closing = new AbortController()
  if (typeof server.addHook === 'function') {
    server.addHook('onClose', async () => closing.abort())
  }

  jobs.forEach((job) => {
    const { schedule, job: fn, jobName } = job
    const run = runnerFor(server, jobName, schedule, fn, closing.signal)

    let task: Task | AsyncTask | null = null

    if (schedule.async) {
      task = new AsyncTask(jobName, run, (err) => {
        log.error(`Job ${jobName} throws an error`)
        log.error(err)
      })
    } else {
      // A synchronous task still gets the asynchronous runner: choosing a container is an
      // async operation, so the scheduler is handed a promise it does not wait for and the
      // errors come back through the same handler.
      task = new Task(jobName, () => {
        run().catch((err) => {
          log.error(`Job ${jobName} throws an error`)
          log.error(err)
        })
      })
    }

    if (schedule.type === 'cron') {
      const taskJob = new CronJob(
        {
          cronExpression: schedule.cron.expression,
          timezone: schedule.cron.tomezone
        },
        task,
        {
          preventOverrun: schedule.preventOverrun
        }
      )
      server.scheduler.addCronJob(taskJob)
    } else {
      const taskJob = new SimpleIntervalJob(
        {
          days: schedule.interval.days || 0,
          hours: schedule.interval.hours || 0,
          minutes: schedule.interval.minutes || 0,
          seconds: schedule.interval.seconds || 0,
          milliseconds: schedule.interval.milliseconds || 0,
          runImmediately: schedule.interval.runImmediately
        },
        task,
        {
          preventOverrun: schedule.preventOverrun
        }
      )
      server.scheduler.addSimpleIntervalJob(taskJob)
    }
  })
}

export type { JobRun }
