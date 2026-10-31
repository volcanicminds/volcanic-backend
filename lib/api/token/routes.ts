import { isTokenPairingEnabled, pairingRateLimit } from '../../util/tokenPairing.js'

export default {
  config: {
    title: 'Integration token functions',
    description: 'Integration token functions',
    controller: 'controller',
    tags: ['token'],
    deprecated: false,
    version: false,
    enable: true
  },
  routes: [
    {
      method: 'GET',
      path: '/',
      requireCapability: 'tokens',
      handler: 'token.find',
      middlewares: [],
      config: {
        title: 'Find tokens',
        description: 'Get tokens list',
        query: { $ref: 'getQueryParamsSchema' },
        response: {
          200: {
            description: 'Default response',
            type: 'array',
            items: { $ref: 'tokenSchema#' }
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/count',
      requireCapability: 'tokens',
      handler: 'token.count',
      middlewares: [],
      config: {
        title: 'Count tokens',
        description: 'Count tokens',
        response: {
          200: {
            description: 'Default response',
            type: 'number'
          }
        }
      }
    },
    {
      method: 'GET',
      path: '/:id',
      requireCapability: 'tokens',
      handler: 'token.findOne',
      middlewares: [],
      config: {
        title: 'Find token',
        description: 'Get token by id',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'tokenSchema#'
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/',
      requireCapability: 'tokens',
      handler: 'token.create',
      middlewares: ['global.isAuthenticated'],
      freshAuth: true,
      config: {
        title: 'Create new token',
        description: 'Create a new token',
        body: { $ref: 'tokenCreateBodySchema' },
        response: {
          200: {
            description: 'The token, with its bearer: shown here once, never stored',
            $ref: 'tokenCreatedSchema#'
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/:id/reissue',
      requireCapability: 'tokens',
      handler: 'token.reissue',
      middlewares: ['global.isAuthenticated'],
      freshAuth: true,
      config: {
        title: 'Reissue a token',
        description: 'A new bearer for the token: every bearer issued before stops working. Name, roles and expiry stay',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: {
            description: 'The token, with its new bearer: shown here once, never stored',
            $ref: 'tokenCreatedSchema#'
          }
        }
      }
    },
    {
      method: 'POST',
      path: '/:id/pairing-code',
      requireCapability: 'tokens',
      handler: 'token.issuePairingCode',
      middlewares: ['global.isAuthenticated'],
      freshAuth: true,
      config: {
        // A getter, so the switch is read when the router reads the route, at each boot: this
        // module is imported once per process.
        get enable() {
          return isTokenPairingEnabled()
        },
        title: 'Issue a pairing code',
        description: 'A ten-minute, single-use code a machine exchanges at /token/pair for a new bearer. A new code voids the previous one',
        params: { $ref: 'onlyIdSchema#' },
        response: { 200: { description: 'The code, shown here once, and when it ends', $ref: 'tokenPairingCodeSchema#' } }
      }
    },
    {
      method: 'POST',
      path: '/pair',
      roles: [],
      handler: 'token.pair',
      middlewares: [],
      rateLimit: pairingRateLimit,
      config: {
        get enable() {
          return isTokenPairingEnabled()
        },
        title: 'Exchange a pairing code',
        description: 'Spends the code and answers with a new bearer for its token: every bearer issued before stops working',
        body: { $ref: 'tokenPairBodySchema#' },
        response: { 200: { description: 'The new bearer, shown here once, never stored', $ref: 'tokenPairedSchema#' } }
      }
    },
    {
      method: 'PUT',
      path: '/:id',
      requireCapability: 'tokens',
      handler: 'token.update',
      middlewares: ['global.isAuthenticated'],
      freshAuth: true,
      config: {
        title: 'Update existing token',
        description: 'Update an existing token',
        params: { $ref: 'onlyIdSchema#' },
        body: { $ref: 'tokenUpdateBodySchema' },
        response: {
          200: {
            description: 'Default response',
            $ref: 'tokenSchema#'
          }
        }
      }
    },
    {
      method: 'DELETE',
      path: '/:id',
      requireCapability: 'tokens',
      handler: 'token.remove',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Unregister existing token (actually disables it)',
        description: 'Unregister an existing token (actually disables it)',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/:id/block',
      requireCapability: 'tokens',
      handler: 'token.block',
      middlewares: ['global.isAuthenticated'],
      config: {
        title: 'Block a token by id',
        description: 'Block a token by id',
        params: { $ref: 'onlyIdSchema#' },
        body: { $ref: 'blockBodySchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    },
    {
      method: 'POST',
      path: '/:id/unblock',
      requireCapability: 'tokens',
      handler: 'token.unblock',
      middlewares: ['global.isAuthenticated'],
      freshAuth: true,
      config: {
        title: 'Unblock a token by id',
        description: 'Unblock a token by id',
        params: { $ref: 'onlyIdSchema#' },
        response: {
          200: { $ref: 'defaultResponse#' }
        }
      }
    }
  ]
}
