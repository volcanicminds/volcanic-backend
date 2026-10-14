import { flowHandlers } from '../../../auth/http.js'

// The flow routes of the control plane, the twins of the tenant ones and the same code.
export const { options, start, stepUp, step, challenge, cancel, returnFrom } = flowHandlers('control')
