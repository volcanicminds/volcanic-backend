import { flowHandlers } from '../../../auth/http.js'

// The flow routes of the tenant plane (T-12.15). The engine and its HTTP side are shared with the
// control plane (lib/auth/http.ts); this file only names the plane.
export const { options, start, step, challenge, cancel, returnFrom } = flowHandlers('tenant')
