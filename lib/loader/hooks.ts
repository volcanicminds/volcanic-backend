const hooks = [
  'onRequest',
  'onError',
  'onSend',
  'onResponse',
  'onTimeout',
  'onReady',
  'onClose',
  'onRoute',
  'onRegistry',
  'preParsing',
  'preValidation',
  'preSeralization',
  'preHandler'
]

const glob = require('glob')
// const path = require('path')

export function apply(server: any): void {
  log.debug('LOAD HOOKS')
  //const patterns = [`{${__dirname},${process.cwd()}}/../hooks/*.{ts,js}`]
  const patterns = [`${__dirname}/../hooks/*.{ts,js}`, `${process.cwd()}/src/hooks/*.{ts,js}`]
  const allHooks: any = {}
  patterns.forEach((pattern) => {
    log.d && log.debug('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      log.debug('file' + f)
    })
  })
  //   log.i && log.info('Hooks loaded: ' + Object.keys(roles).join(', '))
  //   server.addHook()
}
