module.exports = {
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
        body: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            email: { type: 'string' },
            password1: { type: 'string' },
            password2: { type: 'string' },
            requiredRoles: { type: 'array', items: { type: 'string' } }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
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
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            password: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
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
        body: {
          type: 'object',
          properties: {
            password: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/change-password',
      roles: [],
      handler: 'auth.changePassword',
      middlewares: [],
      config: {
        title: 'Change password',
        description: 'Change password for an existing user',
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            oldPassword: { type: 'string' },
            newPassword1: { type: 'string' },
            newPassword2: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/forgot-password',
      roles: [],
      handler: 'auth.forgotPassword',
      middlewares: ['global.dispatchForgotPasswordLink'],
      config: {
        title: 'Forgot password',
        description: 'Forgot password for an existing user given the email or username',
        body: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            email: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
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
        body: {
          type: 'object',
          properties: {
            code: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
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
        body: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            newPassword1: { type: 'string' },
            newPassword2: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
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
        body: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            password: { type: 'string' }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              id: { type: 'string' },
              _id: { type: 'string' },
              externalId: { type: 'string' },
              username: { type: 'string' },
              email: { type: 'string' },
              roles: { type: 'array', items: { type: 'string' } },
              token: { type: 'string' }
            }
          }
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
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
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
        params: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'User id'
            }
          }
        },
        body: { $ref: 'blockBodySchema' },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
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
        params: {
          type: 'object',
          properties: {
            id: {
              type: 'string',
              description: 'User id'
            }
          }
        },
        response: {
          200: {
            description: 'Default response',
            type: 'object',
            properties: {
              ok: { type: 'boolean' }
            }
          }
        }
      }
    }
  ]
}
