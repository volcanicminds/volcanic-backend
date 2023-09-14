export default function load() {
  describe('unit', async () => {
    const fs = require('fs')
    const files = fs.readdirSync(__dirname).filter((file) => !['index.ts'].includes(file))

    await files.forEach(async (file) => {
      try {
        await require(`./${file}`)()
      } catch (err) {
        global.log.error(err)
      }
    })
  })
}
