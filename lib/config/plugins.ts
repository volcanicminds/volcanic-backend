export default [
  {
    name: 'cors',
    enable: true,
    options: {
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
      maxAge: 31536000,
      credentials: true,
      allowedHeaders: [
        'Accept',
        'Accept-Language',
        'Content-Language',
        'Content-Type',
        'Content-Length',
        'Authorization',
        'Origin',
        'v-total',
        'v-count',
        'v-page',
        'v-pageSize',
        'v-pageCount'
      ],
      exposedHeaders: [
        'Accept',
        'Accept-Language',
        'Content-Language',
        'Content-Type',
        'Content-Length',
        'Authorization',
        'Origin',
        'v-total',
        'v-count',
        'v-page',
        'v-pageSize',
        'v-pageCount'
      ]
    }
  },
  {
    name: 'rateLimit',
    // Registered with `global: false` so it limits ONLY routes that opt in via `config.rateLimit`
    // (currently the MFA endpoints, see S11). Turning on global throttling + per-route limits on
    // login/forgot/reset is tracked separately under S5.
    enable: true,
    options: { global: false }
  },
  {
    name: 'helmet',
    enable: true,
    options: {}
  },
  {
    name: 'compress',
    enable: false,
    options: {}
  },
  {
    name: 'multipart',
    enable: false,
    options: {}
  },
  {
    // Serve a static folder (e.g. public uploads in dev; nginx/CDN in prod).
    // Options are @fastify/static's: { root, prefix?, decorateReply? }, or an array
    // of them for multiple mounts. Disabled by default.
    name: 'static',
    enable: false,
    options: {}
  },
  {
    name: 'rawBody',
    enable: false,
    options: {}
  },
  {
    name: 'cookie',
    enable: process.env.AUTH_MODE === 'COOKIE',
    options: {
      secret: process.env.COOKIE_SECRET,
      parseOptions: {}
    }
  }
]
