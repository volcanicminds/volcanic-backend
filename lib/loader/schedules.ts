/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from 'lodash'
import type { JobSchedule } from '../../types/global.js'
import { normalizePatterns } from '../util/path.js'
import { CronJob, SimpleIntervalJob, Task, AsyncTask } from 'toad-scheduler'
import { globSync } from 'glob'
import path from 'path'
import require from '../util/require.js'

export function load(): any[] {
  const patterns = normalizePatterns(['..', 'schedules', '*.job.{ts,js}'], ['src', 'schedules', '*.job.{ts,js}'])
  const jobs: any = []

  const jobScheduleDefaults: JobSchedule = {
    active: false,
    type: 'interval',
    async: true,
    preventOverrun: true,

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

        if (!job || typeof job !== 'function') {
          if (log.t) log.error(`* Job ${jobName} `)
          isLoadedAndEnabled = false
        }

        if (!schedule.type || !['cron', 'interval'].includes(schedule.type)) {
          if (log.t) log.error(`* Job ${jobName}: schedule.type must be cron or interval`)
          isLoadedAndEnabled = false
        }

        if (schedule.type === 'cron' && !schedule.cron?.expression) {
          if (log.t) log.error(`* Job ${jobName}: schedule.cron.expression not defined`)
          isLoadedAndEnabled = false
        }

        if (schedule.type === 'interval') {
          const { days = 0, hours = 0, minutes = 0, seconds = 0, milliseconds = 0 } = schedule.interval || {}
          const totalIntervalMs = milliseconds + 1000 * (seconds + 60 * (minutes + 60 * (hours + 24 * days)))

          if (totalIntervalMs < 1000) {
            if (log.t) log.error(`* Job ${jobName}: schedule.interval must have a total greater or equal to 1s`)
            isLoadedAndEnabled = false
          }
        }

        if (isLoadedAndEnabled) {
          jobs.push({
            jobName,
            schedule,
            job
          })
        }
      }

      if (log.d) log.debug(`* Job schedule ${jobName} ${isLoadedAndEnabled ? 'enabled' : 'disabled'}`)
    })
  })

  if (log.i) log.info(`Scheduled Jobs loaded: ${jobs?.length || 0}`)
  return jobs
}

export function start(server: any, jobs: any[]) {
  if (jobs.length > 0) {
    log.trace('* Job schedule attach all tasks')

    jobs.forEach((job) => {
      const { schedule, job: fn, jobName } = job

      let task: Task | AsyncTask | null = null

      if (schedule.async) {
        task = new AsyncTask(jobName, fn, (err) => {
          log.error(`Job ${jobName} throws an error`)
          log.error(err)
        })
      } else {
        task = new Task(jobName, fn)
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
}
