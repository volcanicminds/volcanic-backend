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

//
// The flow routes (T-12.15, F47). The bodies name the engine's own fields and let every other
// field through to the method, which is the one that knows what it reads (`email` and `password`,
// a `code`). `flow` is the credential in bearer mode; in cookie mode it is in the cookie and a body
// field is ignored.
//
export const authFlowStartBodySchema = {
  $id: 'authFlowStartBodySchema',
  type: 'object',
  required: ['method'],
  properties: {
    method: { type: 'string', maxLength: 64 }
  }
}

export const authFlowStepBodySchema = {
  $id: 'authFlowStepBodySchema',
  type: 'object',
  required: ['method'],
  properties: {
    method: { type: 'string', maxLength: 64 },
    flow: { type: 'string', maxLength: 512 },
    action: { type: 'string', enum: ['enrol'] },
    code: { type: 'string', maxLength: 64 }
  }
}

export const authFlowChallengeBodySchema = {
  $id: 'authFlowChallengeBodySchema',
  type: 'object',
  required: ['method'],
  properties: {
    method: { type: 'string', maxLength: 64 },
    flow: { type: 'string', maxLength: 512 }
  }
}

export const authFlowCancelBodySchema = {
  $id: 'authFlowCancelBodySchema',
  type: 'object',
  nullable: true,
  properties: {
    flow: { type: 'string', maxLength: 512 }
  }
}

/** The identifiers of a plane, without state. Codes only: the labels belong to the console. */
export const authFlowOptionsResponseSchema = {
  $id: 'authFlowOptionsResponseSchema',
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string' } } }
    }
  }
}

/**
 * Every partial authentication answers 202 with this body. Each field is declared because the
 * serializer drops what a schema does not name; `enrol` (true, or the setup of an enrolment just
 * started) and `action` (a link, or a form to post) take more than one shape and are left open.
 */
export const authFlowPartialResponseSchema = {
  $id: 'authFlowPartialResponseSchema',
  type: 'object',
  properties: {
    flow: { type: 'string', nullable: true },
    expiresAt: { type: 'string' },
    stage: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              kind: { type: 'string' },
              challenge: {
                type: 'object',
                properties: {
                  channel: { type: 'string' },
                  destination: { type: 'string' },
                  expiresAt: { type: 'string' },
                  resendAt: { type: 'string', nullable: true }
                }
              },
              enrol: {},
              action: {}
            }
          }
        }
      }
    }
  }
}

//
// External identities linked to an account (T-12.27, F40). The account's own `externalId` is not
// here: it is what the session carries, and it has no business in a listing.
//
export const externalIdentitySchema = {
  $id: 'externalIdentitySchema',
  type: 'object',
  properties: {
    id: { type: 'string' },
    provider: { type: 'string' },
    issuer: { type: 'string' },
    subject: { type: 'string' },
    emailAtLink: { type: 'string', nullable: true },
    createdAt: { type: 'string', format: 'date-time' },
    lastUsedAt: { type: 'string', format: 'date-time', nullable: true }
  }
}

export const externalIdentityListSchema = {
  $id: 'externalIdentityListSchema',
  type: 'array',
  items: { $ref: 'externalIdentitySchema#' }
}

export const externalIdentityBodySchema = {
  $id: 'externalIdentityBodySchema',
  type: 'object',
  required: ['provider', 'issuer', 'subject'],
  properties: {
    provider: { type: 'string', maxLength: 63 },
    issuer: { type: 'string', maxLength: 2048 },
    subject: { type: 'string', minLength: 1, maxLength: 255 }
  }
}

export const externalIdentityParamsSchema = {
  $id: 'externalIdentityParamsSchema',
  type: 'object',
  required: ['id', 'linkId'],
  properties: {
    id: { type: 'string', minLength: 1 },
    linkId: { type: 'string', minLength: 1 }
  }
}
