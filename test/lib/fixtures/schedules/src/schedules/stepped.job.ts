// croner reads a step only after a wildcard or a range: `0/10` is refused.
export const schedule = { active: true, type: 'cron', cron: { expression: '0/10 * * * * *' } }
export async function job() {}
