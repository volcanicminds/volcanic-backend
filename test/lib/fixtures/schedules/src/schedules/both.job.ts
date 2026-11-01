// One job and several at once: which one runs would be a guess, so none of them loads.
export const schedule = { active: true, interval: { seconds: 10 } }
export async function job() {}
export const jobs = { other: { job, schedule } }
