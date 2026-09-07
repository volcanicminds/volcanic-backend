// Declares nothing: it runs on the control plane, never inside a customer's container.
export const schedule = { active: true, interval: { seconds: 10 } }
export async function job() {}
