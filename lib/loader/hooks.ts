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
const path = require('path')

export function apply(server: any): void {
  log.debug('LOAD HOOKS')
  //const patterns = [`{${__dirname},${process.cwd()}}/../hooks/*.{ts,js}`]
  const patterns = [`${__dirname}/../hooks/*.{ts,js}`, `${process.cwd()}/src/hooks/*.{ts,js}`]
  const allHooks: any = hooks.reduce((acc, v) => ({ ...acc, [v]: [] as Function[] }), {})
  // log.error(allHooks)

  patterns.forEach((pattern) => {
    log.d && log.debug('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const hookName = path.basename(f, path.extname(f))
      const { hook: fn } = require(f)

      if (fn != null) {
        if (allHooks[hookName] == null) {
          allHooks[hookName] = [] as Function[]
        }
        allHooks[hookName].push((...args) => fn(...args))
      }
    })
  })

  hooks.map((hookName) => {
    const fns: Function[] = allHooks[hookName]
    log.t && log.trace(`Loaded ${fns?.length || 0} hook for ${hookName}`)
    fns?.length > 0 && fns.map((fn) => server.addHook(hookName, fn as Function))
  })
}
