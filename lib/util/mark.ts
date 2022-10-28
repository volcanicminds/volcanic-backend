const pkg = require('../../package.json')

/**
 * Minimal mark printed at startup
 */

export function print(): void {
  log.i && log.info('Ciao')
  log.i && log.info(`              ,--.                  ,--.      `)
  log.i && log.info(`.--.  ,--,---.|  |,---.,--,--,--,--\\\`--',---. `)
  log.i && log.info(` \\  ''  | .-. |  / .--' ,-.  |      ,--/ .--' `)
  log.i && log.info(`  \\    /' '-' |  \\ \`--\\ '-'  |  ||  |  \\ \`--. `)
  log.i && log.info(`   \`--'  \`---'\`--'\`---'\`--\`--\`--''--\`--'\`---' `)
  log.i && log.info('')
  log.t && log.trace(`Package ${pkg.name}`)
  log.i && log.info(`License ${pkg.license}`)
  log.i && log.info(`Version ${pkg.version}`)
  log.i && log.info(`Codename ${pkg.codename}`)
  log.i && log.info(`Environment ${process.env.NODE_ENV}`)
  log.t && log.trace(`Platform ${process.platform} ${process.arch}`)
  log.t && log.trace(`Root path ${process.cwd()}`)
  log.t && log.trace(`Node ${process.version}`)
  log.t && log.trace(`Release ${JSON.stringify(process.release)}`)
  log.t && log.trace(`Versions ${JSON.stringify(process.versions)}`)
}
