import { FastifyReply, FastifyRequest } from 'fastify'
import * as regExp from '../../../util/regexp'

export async function register(req: FastifyRequest, reply: FastifyReply) {
  const { password1: password, password2, ...data } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!data.username) {
    return reply.status(400).send(new Error('Username not valid'))
  }
  if (!data.email || !regExp.email.test(data.email)) {
    return reply.status(400).send(new Error('Email not valid'))
  }
  if (!password || !regExp.password.test(password)) {
    return reply.status(400).send(new Error('Password not valid'))
  }
  if (!password2 || password2 !== password) {
    return reply.status(400).send(new Error('Repeated password not match'))
  }

  let existings = await req.server['userManager'].retrieveUserByEmail(data.email)
  if (existings) {
    return reply.status(400).send(new Error('Email already registered'))
  }

  if ((data.requiredRoles || []).includes('admin')) {
    existings = await req.server['userManager'].findQuery({ 'roles:in': 'admin' })
    if (existings?.records?.length) {
      return reply.status(400).send(new Error('User admin already registered'))
    }
  }

  // public is the default
  const publicRole = global.roles?.public?.code || 'public'
  data.roles = (data.requiredRoles || []).map((r) => global.roles[r]?.code).filter((r) => !!r)
  if (!data.roles.includes(publicRole)) {
    data.roles.push(publicRole)
  }

  const user = await req.server['userManager'].createUser({ ...data, password: password })
  if (!user) {
    return reply.status(400).send(new Error('User not registered'))
  }

  return user
}

export async function unregister(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = req.data()

  let user = await req.server['userManager'].retrieveUserByPassword(email, password)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(new Error('Wrong credentials'))
  }

  if (user.blocked) {
    return reply.status(403).send(new Error('User blocked'))
  }

  user = await req.server['userManager'].disableUserById(user.getId())
  isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(400).send(new Error('User not valid'))
  }

  return { ok: true }
}

export async function validatePassword(req: FastifyRequest, reply: FastifyReply) {
  const { password } = req.data()

  if (!password) {
    return reply.status(400).send(new Error('Password cannot be null'))
  }

  const match = regExp.password.test(password)
  if (!match) {
    return reply.status(400).send(new Error('Password is not valid'))
  }

  return { ok: match }
}

export async function changePassword(req: FastifyRequest, reply: FastifyReply) {
  const { email, oldPassword, newPassword1, newPassword2 } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!newPassword1 || !regExp.password.test(newPassword1)) {
    return reply.status(400).send(new Error('New password is not valid'))
  }

  if (!newPassword2 || newPassword2 !== newPassword1) {
    return reply.status(400).send(new Error('Repeated new password not match'))
  }

  let user = await req.server['userManager'].retrieveUserByPassword(email, oldPassword)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(new Error('Wrong credentials'))
  }

  if (user.blocked) {
    return reply.status(403).send(new Error('User blocked'))
  }

  user = await req.server['userManager'].changePassword(email, newPassword1, oldPassword)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid }
}

export async function forgotPassword(req: FastifyRequest, reply: FastifyReply) {
  const { username, email } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!username && (!email || (email && !regExp.email.test(email)))) {
    return reply.status(400).send(new Error('Missing a valid user identifier'))
  }

  let user = null as any
  if (email) {
    user = await req.server['userManager'].retrieveUserByEmail(email)
  } else if (username) {
    user = await req.server['userManager'].retrieveUserByUsername(username)
  }

  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(new Error('Wrong credentials'))
  }

  if (user?.blocked) {
    return reply.status(403).send(new Error('User blocked'))
  }

  user = await req.server['userManager'].forgotPassword(user.email)
  isValid = await req.server['userManager'].isValidUser(user)

  return { ok: isValid }
}

export async function confirmEmail(req: FastifyRequest, reply: FastifyReply) {
  const { code } = req.data()

  if (!code) {
    return reply.status(400).send(new Error('Missing the confirm email token'))
  }

  let user = await req.server['userManager'].retrieveUserByConfirmationToken(code)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(new Error('Wrong credentials'))
  }

  if (user.blocked) {
    return reply.status(403).send(new Error('User blocked'))
  }

  user = await req.server['userManager'].userConfirmation(user)
  isValid = await req.server['userManager'].isValidUser(user)

  return { ok: isValid }
}

export async function resetPassword(req: FastifyRequest, reply: FastifyReply) {
  const { code, newPassword1, newPassword2 } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!newPassword1 || !regExp.password.test(newPassword1)) {
    return reply.status(400).send(new Error('New password not valid'))
  }

  if (!newPassword2 || newPassword2 !== newPassword1) {
    return reply.status(400).send(new Error('Repeated new password not match'))
  }

  let user = await req.server['userManager'].retrieveUserByResetPasswordToken(code)
  let isValid = await req.server['userManager'].isValidUser(user)

  if (!isValid) {
    return reply.status(403).send(new Error('Wrong credentials'))
  }

  if (user.blocked) {
    return reply.status(403).send(new Error('User blocked'))
  }

  user = await req.server['userManager'].resetPassword(user, newPassword1)
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid, user }
}

export async function login(req: FastifyRequest, reply: FastifyReply) {
  const { email, password } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!email || !regExp.email.test(email)) {
    return reply.status(400).send(new Error('Email not valid'))
  }
  if (!password || !regExp.password.test(password)) {
    return reply.status(400).send(new Error('Password not valid'))
  }

  let user = await req.server['userManager'].retrieveUserByPassword(email, password)
  const isValid = await req.server['userManager'].isValidUser(user)
  // const user = { confirmed: true, blocked: false, externalId: 123456, roles: [{ code: 'admin' }] }
  // const isValid = true

  if (!isValid) {
    return reply.status(403).send(new Error('Wrong credentials'))
  }

  if (!(user.confirmed === true)) {
    return reply.status(403).send(new Error('User email unconfirmed'))
  }

  const isPasswordToBeChanged = req.server['userManager'].isPasswordToBeChanged(user)
  if (isPasswordToBeChanged) {
    return reply
      .status(403)
      .send({ statusCode: 403, code: 'PASSWORD_TO_BE_CHANGED', message: 'The password is expired' })
  }

  if (user.blocked) {
    return reply.status(403).send(new Error('User blocked'))
  }

  if (config.enable && config.options.reset_external_id_on_login) {
    user = await req.server['userManager'].resetExternalId(user.getId())
  }

  // https://www.iana.org/assignments/jwt/jwt.xhtml
  const token = await reply.jwtSign({ sub: user.externalId })
  const refreshToken = reply.server.jwt['refreshToken']
    ? await reply.server.jwt['refreshToken'].sign({ sub: user.externalId })
    : undefined

  return {
    ...user,
    roles: (user.roles || [global.role?.public?.code || 'public']).map((r) => r?.code || r),
    token: token,
    refreshToken
  }
}

export async function refreshToken(req: FastifyRequest, reply: FastifyReply) {
  const { token, refreshToken } = req.data()

  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  const tokenData = (await reply.server.jwt.decode(token)) as { sub: number }
  const minAccettable = Math.floor(Date.now() / 1000) - 2592000 // 30 days

  if (tokenData?.sub > 0 && tokenData?.sub > minAccettable) {
    return reply.status(403).send(new Error('Token too old'))
  }

  const refreshTokenData = await reply.server.jwt['refreshToken'].verify(refreshToken)
  if (tokenData?.sub && tokenData?.sub !== refreshTokenData?.sub) {
    return reply.status(403).send(new Error('Mismatched tokens'))
  }

  const user = await req.server['userManager'].retrieveUserByExternalId(tokenData.sub)
  const isValid = await req.server['userManager'].isValidUser(user)
  // const user = { confirmed: true, blocked: false, externalId: 123456, roles: [{ code: 'admin' }] }
  // const isValid = true

  if (!isValid) {
    return reply.status(403).send(new Error('Wrong refresh token'))
  }

  const newToken = await reply.jwtSign({ sub: user.externalId })
  return {
    token: newToken
  }
}

export async function invalidateTokens(req: FastifyRequest, reply: FastifyReply) {
  let isValid = await req.server['userManager'].isValidUser(req.user)
  if (!req.user || !isValid) {
    return reply.status(403).send(new Error('User not linked'))
  }

  const user = await req.server['userManager'].resetExternalId(req.user.getId())
  isValid = await req.server['userManager'].isValidUser(user)
  return { ok: isValid }
}

export async function block(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply.status(403).send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to block a user' })
  }

  const { id: userId } = req.parameters()
  const { reason } = req.data()

  let user = await req.server['userManager'].blockUserById(userId, reason)
  user = await req.server['userManager'].resetExternalId(user.getId())
  return { ok: !!user.getId() }
}

export async function unblock(req: FastifyRequest, reply: FastifyReply) {
  if (!req.server['userManager'].isImplemented()) {
    throw new Error('Not implemented')
  }

  if (!req.hasRole(roles.admin) && !req.hasRole(roles.backoffice)) {
    return reply
      .status(403)
      .send({ statusCode: 403, code: 'ROLE_NOT_ALLOWED', message: 'Not allowed to unblock a user' })
  }

  const { id: userId } = req.parameters()
  const user = await req.server['userManager'].unblockUserById(userId)
  return { ok: !!user.getId() }
}
