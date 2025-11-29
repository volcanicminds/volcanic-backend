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

export const authLoginResponseSchema = {
  $id: 'authLoginResponseSchema',
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    _id: { type: 'string' },
    externalId: { type: 'string' },
    username: { type: 'string' },
    email: { type: 'string' },
    roles: { type: 'array', items: { type: 'string' } },
    token: { type: 'string' },
    refreshToken: { type: 'string' },
    mfaEnabled: { type: 'boolean' },
    securityPolicy: {
      type: 'object',
      nullable: true,
      properties: {
        mfaPolicy: { type: 'string' }
      }
    }
  }
}

export const authMfaChallengeSchema = {
  $id: 'authMfaChallengeSchema',
  type: 'object',
  nullable: true,
  properties: {
    mfaRequired: { type: 'boolean' },
    mfaSetupRequired: { type: 'boolean' },
    tempToken: { type: 'string' }
  }
}

export const authRefreshTokenBodySchema = {
  $id: 'authRefreshTokenBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    token: { type: 'string' },
    refreshToken: { type: 'string' }
  }
}

export const authRefreshTokenResponseSchema = {
  $id: 'authRefreshTokenResponseSchema',
  type: 'object',
  nullable: true,
  properties: {
    token: { type: 'string' }
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

export const authMfaSetupResponseSchema = {
  $id: 'authMfaSetupResponseSchema',
  type: 'object',
  nullable: true,
  properties: {
    secret: { type: 'string' },
    uri: { type: 'string' },
    qrCode: { type: 'string' }
  }
}

export const authMfaEnableBodySchema = {
  $id: 'authMfaEnableBodySchema',
  type: 'object',
  nullable: true,
  required: ['secret', 'token'],
  properties: {
    secret: { type: 'string' },
    token: { type: 'string' }
  }
}

export const authMfaVerifyBodySchema = {
  $id: 'authMfaVerifyBodySchema',
  type: 'object',
  nullable: true,
  required: ['token'],
  properties: {
    token: { type: 'string' }
  }
}
