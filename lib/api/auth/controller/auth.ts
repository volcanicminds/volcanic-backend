import { FastifyReply, FastifyRequest } from 'fastify'
import * as regExp from '../../../util/regexp'

export async function register(req: FastifyRequest, reply: FastifyReply) {
  const { password1: password, password2, ...data } = req.data()

  if (!data.username) {
    return reply.status(404).send(Error('Username not valid'))
  }
  if (!data.email || !regExp.email.test(data.email)) {
    return reply.status(404).send(Error('Email not valid'))
  }
  if (!password || !regExp.password.test(password)) {
    return reply.status(404).send(Error('Password not valid'))
  }
  if (!password2 || password2 !== password) {
    return reply.status(404).send(Error('Repeated password not match'))
  }

  // public is the default
  const publicRole = global.roles?.public?.code || 'public'
  data.roles = (data.requiredRoles || []).map((r) => global.roles[r]?.code).filter((r) => !!r)
  if (!data.roles.includes(publicRole)) {
    data.roles.push(publicRole)
  }

  const user = await req.server['userManager'].createUser({ ...data, password: password })
  if (!user) {
    return reply.status(400).send(Error('User not registered'))
  }

  return user
}

export async function unregister(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = req.data()

  let user = await req.server['userManager'].retrieveUserByPassword(email, password)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(Error('Wrong credentials'))
  }

  if (!user.enabled) {
    return reply.status(403).send(Error('User not enabled'))
  }

  user = await req.server['userManager'].disableUserById(user?.id)
  isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(400).send(Error('User not valid'))
  }

  return { ok: true }
}

export async function changePassword(req: FastifyRequest, reply: FastifyReply) {
  const { email, oldPassword, newPassword1, newPassword2 } = req.data()

  if (!newPassword1 || !regExp.password.test(newPassword1)) {
    return reply.status(404).send(Error('New password not valid'))
  }

  if (!newPassword2 || newPassword2 !== newPassword1) {
    return reply.status(404).send(Error('Repeated new password not match'))
  }

  let user = await req.server['userManager'].retrieveUserByPassword(email, oldPassword)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(Error('Wrong credentials'))
  }

  if (!user.enabled) {
    return reply.status(403).send(Error('User not enabled'))
  }

  user = await req.server['userManager'].changePassword(email, newPassword1, oldPassword)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid }
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  const { code } = req.parameters()
  const { newPassword1, newPassword2 } = req.data()

  if (!newPassword1 || !regExp.password.test(newPassword1)) {
    return reply.status(404).send(Error('New password not valid'))
  }

  if (!newPassword2 || newPassword2 !== newPassword1) {
    return reply.status(404).send(Error('Repeated new password not match'))
  }

  let user = await repository.users.findOne({
    where: { resetPasswordToken: code }
  })
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(Error('Wrong credentials'))
  }

  if (!user.enabled) {
    return reply.status(403).send(Error('User not enabled'))
  }

  user = await req.server['userManager'].resetPassword(user, newPassword1)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid }
}

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = req.data()

  if (!email || !regExp.email.test(email)) {
    return reply.status(404).send(Error('Email not valid'))
  }
  if (!password || !regExp.password.test(password)) {
    return reply.status(404).send(Error('Password not valid'))
  }

  const user = await req.server['userManager'].retrieveUserByPassword(email, password)
  const isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(Error('Wrong credentials'))
  }

  if (!user.enabled) {
    return reply.status(403).send(Error('User not enabled'))
  }

  // log.trace('User: ' + JSON.stringify(user) + ' ' + roles)
  // https://www.iana.org/assignments/jwt/jwt.xhtml
  const token = user !== null ? await reply.jwtSign({ sub: user.externalId }) : null
  return {
    ...user,
    token: token || null,
    roles: (user.roles || [global.role?.public?.code || 'public']).map((r) => r?.code || r)
  }
}

export async function invalidateTokens(req: FastifyRequest, reply: FastifyReply) {
  let isValid = await req.server['userManager'].isValidUser(req.user)
  if (!isValid) {
    return reply.status(403).send(Error('User not linked'))
  }

  const user = await req.server['userManager'].resetExternalId(req.user?.id)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid }
}

export async function block(req: FastifyRequest, reply: FastifyReply) {
  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply.status(403).send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to block a user' })
  }

  const { id: userId } = req.parameters()
  const { reason } = req.data()

  const user = await req.server['userManager'].blockUserById(userId, reason)
  return { ok: !!user?.id }
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply
      .status(403)
      .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to unblock a user' })
  }

  const { id: userId } = req.parameters()
  const user = await req.server['userManager'].unblockUserById(userId)
  return { ok: !!user?.id }
}
