import { FastifyReply, FastifyRequest } from 'fastify'
import { AuthenticatedUser } from '../../../../types/global'

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const { email = '', password = '' } = req.data()

  // TODO: use UserManagement.find and check password
  // demo code here
  const username = email.substr(0, email.indexOf('@')) || 'jerry'
  const roleList = [username === 'admin' ? roles.admin : username === 'vminds' ? roles.backoffice : roles.public]
  const user =
    username !== null
      ? ({
          id: 306, // user id
          name: username, // optional
          email: email,
          roles: roleList
        } as AuthenticatedUser)
      : null

  // TODO: review if email is important to include in token (for a security purpose)
  // https://www.iana.org/assignments/jwt/jwt.xhtml
  const token = user !== null ? await reply.jwtSign({ sub: user.id, name: user.name, email: user.email }) : null
  reply.send({ ...user, token: token || null, roles: roleList.map((r) => r.code) })
}

export async function demo(req: FastifyRequest, reply: FastifyReply) {
  // JSON.stringify(req.user)

  reply.send({ ok: req.user })
}
