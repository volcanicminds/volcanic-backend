/* eslint-disable @typescript-eslint/no-explicit-any */
import * as path from 'path'
import { globSync } from 'glob'
import pluralize from 'pluralize'
import { fileURLToPath, pathToFileURL } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function load() {
  const classes: any = {}
  const repositories: any = {}
  const entities: any[] = []

  const patterns = [
    path.join(__dirname, '..', 'entities', '*.e.{ts,js}'),
    path.join(process.cwd(), 'src', 'entities', '*.e.{ts,js}'),
    path.join(process.cwd(), 'dist', 'src', 'entities', '*.e.{ts,js}')
  ]

  for (const pattern of patterns) {
    const files = globSync(pattern, { nodir: true, windowsPathsNoEscape: true })

    const modules = await Promise.all(
      files.map((f) => {
        const fileUrl = pathToFileURL(f).href
        return import(fileUrl)
      })
    )

    for (const entityModule of modules) {
      const entityClass = entityModule.default || entityModule
      const entityNames = Object.keys(entityClass)

      entityNames.forEach((name) => {
        const entity = entityClass[name]
        if (typeof entity === 'function') {
          classes[name] = entity
          repositories[pluralize(name.toLowerCase())] = entity
          entities.push(entity)
        }
      })
    }
  }

  return { classes, repositories, entities }
}
