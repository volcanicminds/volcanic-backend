export default {
  config: {
    title: 'Authentication functions',
    description: 'Authentication functions',
    controller: 'controller',
    tags: ['auth'],
    deprecated: false,
    version: false,
    enable: true
  },
  routes: [
    {
      method: 'POST',
      path: '/register',
      roles: [],
      handler: 'auth.register',
      middlewares: ['global.preAuth', 'global.postAuth'],
      config: {
        title: 'Register new user',
        description: 'Register a new user',
        body: { $ref: 'authRegisterBodySchema#' },
        response: {
          200: { $ref: 'authRegisterResponseSchema#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/unregister',
      roles: [],
      handler: 'auth.unregister',
      middlewares: ['global.preAuth', 'global.postAuth'],
      config: {
        title: 'Unregister existing user (actually disables it)',
        description: 'Unregister an existing user (actually disables it)',
        body: { $ref: 'authLoginBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/validate-password',
      roles: [],
      handler: 'auth.validatePassword',
      middlewares: [],
      config: {
        title: 'Validate password',
        description: 'Validate password if valid and usable',
        body: { $ref: 'onlyPasswordSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/change-password',
      roles: [],
      handler: 'auth.changePassword',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Change password',
        description: 'Change password for an existing user',
        body: { $ref: 'authChangePasswordBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/forgot-password',
      roles: [],
      handler: 'auth.forgotPassword',
      middlewares: ['global.preForgotPasswordHandler', 'global.dispatchForgotPasswordLink'],
      config: {
        title: 'Forgot password',
        description: 'Forgot password for an existing user given the email or username',
        body: { $ref: 'authForgotPasswordBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/confirm-email',
      roles: [],
      handler: 'auth.confirmEmail',
      middlewares: [],
      config: {
        title: 'Confirm email',
        description: 'Confirm email for an existing user',
        body: { $ref: 'onlyCodeSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/reset-password',
      roles: [],
      handler: 'auth.resetPassword',
      middlewares: [],
      config: {
        title: 'Reset password',
        description: 'Reset password for an existing user given the reset token',
        body: { $ref: 'resetPasswordBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/login',
      roles: [],
      handler: 'auth.login',
      middlewares: ['global.preAuth', 'global.postAuth'],
      config: {
        title: 'Login',
        description: 'Basic login authentication',
        body: { $ref: 'authLoginBodySchema#' },
        response: {
          200: { $ref: 'authLoginResponseSchema#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/refresh-token',
      roles: [],
      handler: 'auth.refreshToken',
      middlewares: [],
      config: {
        title: 'Refresh authentication token',
        description: 'Refresh login authentication token',
        body: { $ref: 'authRefreshTokenBodySchema#' },
        response: {
          200: { $ref: 'authRefreshTokenResponseSchema#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/invalidate-tokens',
      roles: [],
      handler: 'auth.invalidateTokens',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Invalidate all tokens',
        description: 'Invalidate all tokens',
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/block/:id',
      roles: [roles.admin, roles.backoffice],
      handler: 'auth.block',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Block a user by id',
        description: 'Block a user by id',
        params: { $ref: 'onlyIdSchema#' },
        body: { $ref: 'blockBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/unblock/:id',
      roles: [roles.admin, roles.backoffice],
      handler: 'auth.unblock',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Unblock a user by id',
        description: 'Unblock a user by id',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/mfa/setup',
      roles: [],
      handler: 'auth.mfaSetup',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Setup MFA',
        description: 'Generate secret and QR code for MFA setup',
        response: {
          200: { $ref: 'authMfaSetupResponseSchema#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/mfa/enable',
      roles: [],
      handler: 'auth.mfaEnable',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Enable MFA',
        description: 'Enable MFA by verifying a token against the generated secret',
        body: { $ref: 'authMfaEnableBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/mfa/verify',
      roles: [], // Open, validation via temp token manually in controller
      handler: 'auth.mfaVerify',
      middlewares: [],
      config: {
        title: 'Verify MFA',
        description: 'Verify MFA token during login to obtain final JWT',
        body: { $ref: 'authMfaVerifyBodySchema#' },
        response: {
          200: { $ref: 'authLoginResponseSchema#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/mfa/disable',
      roles: [],
      handler: 'auth.mfaDisable',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Disable MFA',
        description: 'Disable MFA for the current user',
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
