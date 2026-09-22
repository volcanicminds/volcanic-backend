import { flowHandlers } from '../../../auth/http.js'

// The flow routes of the control plane (T-12.16), the twins of the tenant ones and the same code.
export const { options, start, step, challenge, cancel, returnFrom } = flowHandlers('control')
