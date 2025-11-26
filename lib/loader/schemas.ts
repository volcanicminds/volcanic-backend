import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'
import path from 'path'
import require from '../util/require.js'

export function apply(server: any): void {
  const [baseSchemaPath, customSchemaPath] = normalizePatterns(
    ['..', 'schemas', '*.{ts,js}'],
    ['src', 'schemas', '*.{ts,js}']
  )

  const customSchemas: any[] = []
  const customSchemaIds = new Set()
  let schemaCount = 0

  log.t && log.trace('Looking for custom schemas in ' + customSchemaPath)
  globSync(customSchemaPath, { windowsPathsNoEscape: true }).forEach((f: string) => {
    try {
      const schemaClass = require(f)
      const schemaNames = Object.keys(schemaClass)

      schemaNames.forEach((name) => {
        const schema = schemaClass[name]
        if (schema?.$id) {
          customSchemas.push(schema)
          customSchemaIds.add(schema.$id)
        }
      })
    } catch (e) {
      log.w && log.warn(`Could not load custom schema file: ${f}`, e)
    }
  })

  customSchemas.forEach((schema) => {
    log.trace(`* Registering custom schema [${schema.$id}]`)
    server.addSchema(schema)
    schemaCount++
  })

  log.t && log.trace('Looking for base schemas in ' + baseSchemaPath)
  globSync(baseSchemaPath, { windowsPathsNoEscape: true }).forEach((f: string) => {
    try {
      const schemaFileName = path.basename(f)
      const schemaClass = require(f)
      const schemaNames = Object.keys(schemaClass)

      schemaNames.forEach((name) => {
        const schema = schemaClass[name]
        if (schema?.$id) {
          if (customSchemaIds.has(schema.$id)) {
            log.w &&
              log.warn(
                `* Base schema [${schema.$id}] from ${schemaFileName} is overridden by a custom schema and will be ignored.`
              )
          } else {
            log.trace(`* Registering base schema [${schema.$id}] from ${schemaFileName}`)
            server.addSchema(schema)
            schemaCount++
          }
        } else {
          log.w && log.warn(`* Schema with no $id found in ${schemaFileName}, cannot be registered.`)
        }
      })
    } catch (e) {
      log.w && log.warn(`Could not load base schema file: ${f}`, e)
    }
  })

  log.d && log.debug(`Schemas loaded: ${schemaCount} referenceable by $ref`)
}
