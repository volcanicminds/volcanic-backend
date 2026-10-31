// The integration tokens of the control plane: the tenant's controller, which reads the plane off
// the route. The rows live in the control plane's `token` table, their roles come from the system
// catalogue, and every act is written in the control plane's governance log.
export { count, find, findOne, create, reissue, issuePairingCode, pair, update, remove, block, unblock } from '../../token/controller/token.js'
