//
// Response log, and nothing else.
//
// In v4 this hook also released the request's QueryRunner, and that is half of D-01: Fastify
// runs its onResponse hooks BEFORE the `finish` listener that lib/loader/tenant.ts used to
// reset `search_path`, so the connection went back to the pool still pointing at a tenant's
// schema and the reset never ran. Two owners of one release is how that happens.
//
// v5 keeps releasing where the handle is created, in the data layer, and keeps no session
// state to undo (T-3.1). Logging a response is this file's whole job.
//
export default async (req, reply) => {
  let extraMessage = ''
  if (log.i && req.startedAt) {
    const elapsed: number = new Date().getTime() - req.startedAt.getTime()
    extraMessage = `(${elapsed}ms)`
  }
  if (log.t) {
    const reqSize = `req ${req.payloadSize || 0}`
    const replySize = reply.payloadSize > 0 ? ` res ${reply.payloadSize}` : ''
    extraMessage += `[${reqSize}${replySize} bytes]`
  }

  const message = () => `${req.method} ${req.url} ${reply.statusCode} ${extraMessage}`.trim()
  if (reply.statusCode < 300) {
    log.info(message())
  } else if (reply.statusCode < 400) {
    log.warn(message())
  } else {
    log.error(message())
  }
}
