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
    // `null` in cookie mode, where the session is in the cookies (T-10.37). Without `nullable`
    // the serializer would turn it into an empty string, which says something else.
    token: { type: 'string', nullable: true },
    refreshToken: { type: 'string', nullable: true },
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
    tempToken: { type: 'string', nullable: true }
  }
}

/**
 * The body of a renewal in bearer mode. In cookie mode there is none: the credential is in the
 * cookie that only the renewal route receives.
 *
 * `token` is gone. The v4 renewal asked for the expired access token as well and bound the pair
 * on subject and tenant, because two JWTs were all there was to compare. The credential now names
 * one row, and the row names its subject and its container, so the access token added nothing.
 */
export const authRefreshTokenBodySchema = {
  $id: 'authRefreshTokenBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    refreshToken: { type: 'string' }
  }
}

/**
 * What a renewal answers.
 *
 * `refreshToken` is declared, and that is not decoration: Fastify serializes a 200 through this
 * schema and silently drops every field it does not name. Since T-11.8 the renewal rotates the
 * credential, so a schema that forgets it would hand a bearer client an access token and no way
 * to renew again; the client would present the spent credential on the next call and the reuse
 * detection would close its session. Both are null in cookie mode, where the session is in the
 * cookies.
 */
export const authRefreshTokenResponseSchema = {
  $id: 'authRefreshTokenResponseSchema',
  type: 'object',
  nullable: true,
  properties: {
    token: { type: 'string', nullable: true },
    refreshToken: { type: 'string', nullable: true }
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

/**
 * The sessions of the caller (T-11.14).
 *
 * No secret and no hash: what the row keeps of the credential never leaves the process, and the
 * only handle a client needs is the `sid`, which is also what it sends back to close one.
 * `current` is what lets a console mark "this device" without the client comparing anything.
 */
export const authSessionsResponseSchema = {
  $id: 'authSessionsResponseSchema',
  type: 'array',
  items: {
    type: 'object',
    properties: {
      sid: { type: 'string' },
      current: { type: 'boolean' },
      createdAt: { type: 'string', format: 'date-time' },
      lastUsedAt: { type: 'string', format: 'date-time' },
      idleExpiresAt: { type: 'string', format: 'date-time' },
      absoluteExpiresAt: { type: 'string', format: 'date-time' },
      ip: { type: 'string', nullable: true },
      userAgent: { type: 'string', nullable: true }
    }
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
