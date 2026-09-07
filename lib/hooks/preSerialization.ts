import sizeof from 'object-sizeof'
import * as tracking from '../util/tracker.js'

//
// Awaited, and before the payload leaves. In v4 the tracking call was fired and forgotten,
// so a failure could not reach the response even in principle: the answer was already on its
// way. Awaiting here is what makes strict mode possible at all (T-3.5): a throw becomes the
// 500 the caller deserves instead of a log line nobody reads.
//
export default async (req, reply, payload) => {
  if (log.t) {
    req.payloadSize = sizeof(req.body) + sizeof(req.params) + sizeof(req.query)
    reply.payloadSize = sizeof(payload)
  }

  await tracking.track(req, reply, payload)
  return payload
}
