import { normalizePatterns } from '../util/path'

const glob = require('glob')
const path = require('path')

export function apply(server: any): void {
  const patterns = normalizePatterns(['..', 'schemas', '*.{ts,js}'], ['src', 'schemas', '*.{ts,js}'])

  let schemaCount = 0
  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const schemaFileName = path.basename(f)
      const schemaClass = require(f)
      const schemaNames = Object.keys(schemaClass)

      schemaNames.map((name) => {
        const schema = schemaClass[name]
        if (schema != null) {
          if (schema?.$id) {
            log.trace(`* Schema [${schema.$id}] loaded from ${schemaFileName}`)
            server.addSchema(schema)
            schemaCount++
          } else {
            log.warn(`* Schema [${schema.$id}] not loaded from ${schemaFileName}`)
          }
        }
      })
    })
  })

  log.d && log.debug(`Schemas loaded: ${schemaCount} referenceable by $ref`)
}
