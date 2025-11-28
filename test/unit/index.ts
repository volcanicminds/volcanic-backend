/* eslint-disable @typescript-eslint/no-explicit-any */
import { createRequire } from 'module'
import { fileURLToPath } from 'url'
import path from 'path'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default function load() {
  describe('Unit', async () => {
    const fs = require('fs')
    const files = fs.readdirSync(__dirname).filter((file: any) => !['index.ts'].includes(file))

    for (const file of files) {
      try {
        const module = await import(`./${file}`)
        if (module.default) await module.default()
      } catch (err) {
        log.error(err)
      }
    }
  })
}
