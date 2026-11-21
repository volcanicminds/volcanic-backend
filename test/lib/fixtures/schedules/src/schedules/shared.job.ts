import { state } from '../state.js'

// Touches module state the test reads through `import()`: the two must be one instance.
export const schedule = { active: true, interval: { seconds: 10 } }
export async function job() {
  state.runs++
}
