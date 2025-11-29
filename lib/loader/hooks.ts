/* eslint-disable @typescript-eslint/no-unsafe-function-type */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'
import path from 'path'

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

export async function apply(server: any): Promise<void> {
  const patterns = normalizePatterns(['..', 'hooks', '*.{ts,js}'], ['src', 'hooks', '*.{ts,js}'])
  const allHooks: any = hooks.reduce((acc, v) => ({ ...acc, [v]: [] as Function[] }), {})

  for (const pattern of patterns) {
    if (log.t) log.trace('Looking for ' + pattern)
    const files = globSync(pattern, { windowsPathsNoEscape: true })

    for (const f of files) {
      if (f.endsWith('.d.ts')) continue

      const hookName = path.basename(f, path.extname(f))
      const module = await import(f)
      const fn = module.default || module

      if (fn != null && typeof fn === 'function') {
        if (allHooks[hookName] == null) {
          allHooks[hookName] = [] as Function[]
        }
        allHooks[hookName].push((...args) => fn(...args))
      }
    }
  }

  hooks.map((hookName) => {
    const fns: Function[] = allHooks[hookName]
    if (log.d) log.debug(`* Add ${fns?.length || 0} hooks for ${hookName}`)
    if (fns?.length > 0) fns.map((fn) => server.addHook(hookName, fn as Function))
  })

  if (log.i) log.info(`Hooks loaded: ${hooks?.length || 0}`)
}
