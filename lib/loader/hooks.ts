import { normalizePatterns } from '../util/path'

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
  'preSerialization',
  'preHandler'
]

const glob = require('glob')
const path = require('path')

export function apply(server: any): void {
  const patterns = normalizePatterns(['..', 'hooks', '*.{ts,js}'], ['src', 'hooks', '*.{ts,js}'])
  const allHooks: any = hooks.reduce((acc, v) => ({ ...acc, [v]: [] as Function[] }), {})

  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const hookName = path.basename(f, path.extname(f))
      const fn = require(f)

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
    log.t && log.trace(`* Add ${fns?.length || 0} hooks for ${hookName}`)
    fns?.length > 0 && fns.map((fn) => server.addHook(hookName, fn as Function))
  })

  log.d && log.debug(`Hooks loaded: ${hooks?.length || 0}`)
}
