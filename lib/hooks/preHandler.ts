import * as tracking from '../util/tracker.js'

export default async (req, reply) => {
  tracking.initialize(req, reply)
}
