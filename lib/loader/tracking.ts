import { TrackChanges, TrackChangesList, Data } from '../../types/global'
import { normalizePatterns } from '../util/path'
const glob = require('glob')

const METHODS = ['POST', 'PUT', 'DELETE']

export function load() {
  const trackChangesList: TrackChangesList = {}
  let trackConfig: Data = {}

  const patterns = normalizePatterns(['..', 'config', 'tracking.{ts,js}'], ['src', 'config', 'tracking.{ts,js}'])
  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const configTracking = require(f)
      const { config, changes } = configTracking || {}
      const { enableAll = true, primaryKey = 'id', changeEntity = 'Change' } = config || {}

      trackConfig = { ...trackConfig, ...config }

      enableAll &&
        changes.forEach((change) => {
          const tc: TrackChanges = { primaryKey: primaryKey, changeEntity: changeEntity, ...change } as TrackChanges
          const code = getCodeBy(tc.method, tc.path)

          if (code in trackChangesList) {
            log.warn(`* Tracking changes on ${tc.method?.toUpperCase()} ${tc.path} already loaded (override)`)
            trackChangesList[code] = { ...trackChangesList[code], ...tc }
          } else if (isValid(tc)) {
            trackChangesList[code] = tc
          }
        })
    })
  })

  const keys = Object.keys(trackChangesList) || []
  log.d && log.debug(`Tracking changes loaded: ${keys?.length || 0}`)
  return { tracking: trackChangesList, trackingConfig: trackConfig }
}

function getCodeBy(method, path) {
  if (method == null || path == null) {
    throw new Error('Tracking changes: impossible retrieve code by method and path')
  }
  return `${method.toUpperCase()}::${path}` // ex POST::/users
}

function isValid(tc) {
  const { method: m, path, enable = true, primaryKey, entity } = tc
  const method = m?.toUpperCase()
  const label = `${method} ${path}`

  if (!enable) {
    log.warn(`* Tracking changes on ${label} disabled`)
    return false
  }

  if (!METHODS.includes(method)) {
    log.error(`* Tracking changes on ${label} available only on methods ${METHODS.join(', ')}`)
    return false
  }

  if (path == null || path.length === 0) {
    log.error(`* Tracking changes on ${label} specify a valid path (ex /users)`)
    return false
  }

  if (entity == null || entity.length === 0) {
    log.error(`* Tracking changes on ${label} specify a valid entity (ex User)`)
    return false
  }

  if (primaryKey == null || primaryKey.length === 0) {
    log.error(`* Tracking changes on ${label} specify a valid primaryKey (ex id)`)
    return false
  }

  return true
}
