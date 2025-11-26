import { normalizePatterns } from '../util/path.js'
import { globSync } from 'glob'
import path from 'path'

export async function apply(server: any): Promise<void> {
  const [baseSchemaPath, customSchemaPath] = normalizePatterns(
    ['..', 'schemas', '*.{ts,js}'],
    ['src', 'schemas', '*.{ts,js}']
  )

  const customSchemas: any[] = []
  const customSchemaIds = new Set()
  let schemaCount = 0

  log.t && log.trace('Looking for custom schemas in ' + customSchemaPath)
  const customFiles = globSync(customSchemaPath, { windowsPathsNoEscape: true })

  for (const f of customFiles) {
    if (f.endsWith('.d.ts')) continue

    try {
      const schemaModule = await import(f)
      const schemaClass = schemaModule.default || schemaModule
      const schemaNames = Object.keys(schemaModule)

      schemaNames.forEach((name) => {
        const schema = schemaModule[name]
        if (schema && typeof schema === 'object' && schema.$id) {
          customSchemas.push(schema)
          customSchemaIds.add(schema.$id)
        }
      })
    } catch (e) {
      log.w && log.warn(`Could not load custom schema file: ${f}`, e)
    }
  }

  customSchemas.forEach((schema) => {
    log.trace(`* Registering custom schema [${schema.$id}]`)
    server.addSchema(schema)
    schemaCount++
  })

  log.t && log.trace('Looking for base schemas in ' + baseSchemaPath)
  const baseFiles = globSync(baseSchemaPath, { windowsPathsNoEscape: true })

  for (const f of baseFiles) {
    if (f.endsWith('.d.ts')) continue

    try {
      const schemaFileName = path.basename(f)
      const schemaModule = await import(f)
      const schemaNames = Object.keys(schemaModule)

      schemaNames.forEach((name) => {
        const schema = schemaModule[name]
        if (schema && typeof schema === 'object' && schema.$id) {
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
        } else if (name !== 'default') {
          log.w && log.warn(`* Schema with no $id found in ${schemaFileName} (export ${name}), cannot be registered.`)
        }
      })
    } catch (e) {
      log.w && log.warn(`Could not load base schema file: ${f}`, e)
    }
  }

  log.d && log.debug(`Schemas loaded: ${schemaCount} referenceable by $ref`)
}
