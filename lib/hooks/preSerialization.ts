import sizeof from 'object-sizeof'
import * as tracking from '../util/tracker.js'

export default async (req, reply, payload) => {
  if (log.t) {
    req.payloadSize = sizeof(req.body) + sizeof(req.params) + sizeof(req.query)
    reply.payloadSize = sizeof(payload)
  }

  tracking.track(req, reply, payload)
}
