/* eslint-disable @typescript-eslint/no-explicit-any */
import _ from 'lodash'
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

  if (log.t) log.trace('Looking for custom schemas in ' + customSchemaPath)
  const customFiles = globSync(customSchemaPath, { windowsPathsNoEscape: true })

  for (const f of customFiles) {
    if (f.endsWith('.d.ts')) continue

    try {
      const schemaModule = await import(f)
      const schemaNames = Object.keys(schemaModule)

      schemaNames.forEach((name) => {
        const schema = schemaModule[name]
        if (schema && typeof schema === 'object' && schema.$id) {
          customSchemas.push(schema)
          customSchemaIds.add(schema.$id)
        }
      })
    } catch (e) {
      if (log.w) log.warn(`Could not load custom schema file: ${f}`, e)
    }
  }

  if (log.t) log.trace('Looking for base schemas in ' + baseSchemaPath)
  const baseFiles = globSync(baseSchemaPath, { windowsPathsNoEscape: true })

  for (const f of baseFiles) {
    if (f.endsWith('.d.ts')) continue

    try {
      const schemaFileName = path.basename(f)
      const schemaModule = await import(f)
      const schemaNames = Object.keys(schemaModule)

      schemaNames.forEach((name) => {
        const baseSchema = schemaModule[name]

        if (baseSchema && typeof baseSchema === 'object' && baseSchema.$id) {
          if (customSchemaIds.has(baseSchema.$id)) {
            // SMART DEEP MERGE
            const customSchema = customSchemas.find((s) => s.$id === baseSchema.$id)

            if (customSchema) {
              const customRequired = Array.isArray(customSchema.required) ? customSchema.required : []
              const baseRequired = Array.isArray(baseSchema.required) ? baseSchema.required : []
              const mergedRequired = [...new Set([...customRequired, ...baseRequired])]

              _.defaultsDeep(customSchema, baseSchema)

              if (mergedRequired.length > 0) {
                customSchema.required = mergedRequired
              }

              if (log.d) log.debug(`* Schema [${baseSchema.$id}] deeply merged with core definition`)
              if (log.w) log.warn(`* Schema [${baseSchema.$id}] overrided with custom definition`)
            }
          } else {
            if (log.d) log.debug(`* Schema [${baseSchema.$id}] from ${schemaFileName} registeerd`)
            server.addSchema(baseSchema)
            schemaCount++
          }
        } else if (name !== 'default') {
          if (log.w) log.warn(`* Schema with no $id found in ${schemaFileName} (export ${name}), cannot be registered`)
        }
      })
    } catch (e) {
      if (log.w) log.warn(`Could not load base schema file: ${f}`, e)
    }
  }

  customSchemas.forEach((schema) => {
    if (log.d) log.debug(`* Custom schema [${schema.$id}] registered`)
    try {
      server.addSchema(schema)
      schemaCount++
    } catch (e: any) {
      if (log.e) log.error(`Error registering schema ${schema.$id}: ${e.message}`)
    }
  })

  if (log.i) log.info(`Schemas loaded: ${schemaCount} referenceable by $ref`)
}
