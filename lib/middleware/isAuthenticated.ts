import { FastifyReply, FastifyRequest } from 'fastify'

const log = global.log
module.exports = (req: FastifyRequest, res: FastifyReply, done: any) => {
  try {
    if (!!req.user?.id) {
      return done()
    }

    throw new Error('Unauthorized')
  } catch (err) {
    log.e && log.error(`Upps, something just happened ${err}`)
    return res.code(401).send(err) // must be authorized first
  }
}
