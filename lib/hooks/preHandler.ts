import * as tracking from '../util/tracker.js'

//
// Awaited, unlike v4. The baseline of the audit diff has to be read BEFORE the handler
// changes the row, and an un-awaited promise gave no such guarantee: the handler could
// overwrite the row while the read was still in flight, and the diff would compare the new
// value with itself (T-3.5).
//
export default async (req, reply) => {
  await tracking.initialize(req, reply)
}
