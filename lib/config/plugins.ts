'use strict'

module.exports = [
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
    enable: false,
    options: {}
  },
  {
    name: 'helmet',
    enable: false,
    options: {}
  },
  {
    name: 'compress',
    enable: false,
    options: {}
  }
]
