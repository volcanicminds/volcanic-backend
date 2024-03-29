import { FastifyReply, FastifyRequest } from 'fastify'

export function preHandler(req: FastifyRequest, res: FastifyReply, done: any) {
  try {
    if (!!req.user?.getId()) {
      return done()
    }

    throw new Error('Unauthorized')
  } catch (err) {
    log.e && log.error(`Upps, something just happened ${err}`)
    return res.code(401).send(new Error('Unauthorized')) // must be authorized first
  }
}
