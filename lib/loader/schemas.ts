const glob = require('glob')
const path = require('path')

export function apply(server: any): void {
  const patterns = [`${__dirname}/../schemas/*.{ts,js}`, `${process.cwd()}/src/schemas/*.{ts,js}`]

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
          log.debug(`* Schema [${schema.$id}] loaded from ${schemaFileName}`)
          server.addSchema(schema)
          schemaCount++
        }
      })
    })
  })

  log.i && log.info(`Schemas loaded: ${schemaCount} referenceable by $ref`)
}
