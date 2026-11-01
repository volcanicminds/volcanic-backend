// Several jobs in one file, each checked as a file of its own: two load, the inactive one is
// skipped, and the two that name a plane the deployment lacks or are not a name are refused alone.
async function job() {}

export const jobs = {
  corpus: { job, schedule: { active: true, scope: 'every-tenant', interval: { seconds: 10 } } },
  shared: { job, schedule: { active: true, interval: { seconds: 10 } } },
  idle: { job, schedule: { active: false, interval: { seconds: 10 } } },
  lost: { job, schedule: { active: true, scope: 'somewhere-else', interval: { seconds: 10 } } },
  'not a name': { job, schedule: { active: true, interval: { seconds: 10 } } }
}
