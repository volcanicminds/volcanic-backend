// `scope: 'tenant'` without a slug: there is no default container, so this must not load.
export const schedule = { active: true, scope: 'tenant', interval: { seconds: 10 } }
export async function job() {}
