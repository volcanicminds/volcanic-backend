const glob = require('glob')
const path = require('path')

export function apply(server: any): void {
  const patterns = [`${__dirname}/../schemas/*.{ts,js}`, `${process.cwd()}/src/schemas/*.{ts,js}`]

  let schemaCount = 0
  patterns.forEach((pattern) => {
    log.t && log.trace('Looking for ' + pattern)
    glob.sync(pattern).forEach((f: string) => {
      const schemaName = path.basename(f)
      const schema = require(f)
      if (schema != null) {
        log.debug(`* Schema [${schema?.$id}] loaded from ${schemaName}`)
        server.addSchema(schema)
        schemaCount++
      }
    })
  })

  log.debug(`Schemas loaded: ${schemaCount} referenceable by $ref`)
}
