import * as tracking from '../util/tracker'

module.exports = async (req, reply) => {
  tracking.initialize(req, reply)
}
