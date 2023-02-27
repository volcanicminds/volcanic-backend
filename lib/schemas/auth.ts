export const authLoginBodySchema = {
  $id: 'authLoginBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    email: { type: 'string' },
    password: { type: 'string' }
  }
}
export const authForgotPasswordBodySchema = {
  $id: 'authForgotPasswordBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    username: { type: 'string' },
    email: { type: 'string' }
  }
}

export const authRegisterBodySchema = {
  $id: 'authRegisterBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    username: { type: 'string' },
    email: { type: 'string' },
    password1: { type: 'string' },
    password2: { type: 'string' },
    requiredRoles: { type: 'array', items: { type: 'string' } }
  }
}

export const authRegisterResponseSchema = {
  $id: 'authRegisterResponseSchema',
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    _id: { type: 'string' },
    externalId: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    enabled: { type: 'boolean' },
    roles: { type: 'array', items: { type: 'string' } }
  }
}

export const authChangePasswordBodySchema = {
  $id: 'authChangePasswordBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    email: { type: 'string' },
    oldPassword: { type: 'string' },
    newPassword1: { type: 'string' },
    newPassword2: { type: 'string' }
  }
}

export const resetPasswordBodySchema = {
  $id: 'resetPasswordBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    code: { type: 'string' },
    newPassword1: { type: 'string' },
    newPassword2: { type: 'string' }
  }
}
