import { FastifyReply, FastifyRequest } from 'fastify'

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const { username, password } = req.data()

  // log.debug('username ' + username + ' password ' + password)

  const roleList = [username === 'admin' ? roles.admin : username === 'vminds' ? roles.backoffice : roles.public]
  const user =
    username !== null
      ? {
          sub: 306, // user id
          name: username // optional, username || email
        }
      : null

  const token = user !== null ? await reply.jwtSign(user) : null

  // log.debug('token ' + token)
  reply.send({ ok: token !== null, token, roles: roleList.map((r) => r.code) })
}

export async function demo(req: FastifyRequest, reply: FastifyReply) {
  // JSON.stringify(req.user)

  reply.send({ ok: req.user })
}
