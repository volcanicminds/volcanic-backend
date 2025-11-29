/* eslint-disable @typescript-eslint/no-explicit-any */
import require from './require.js'
const pkg = require('root-require')('package.json')

/**
 * Minimal mark printed at startup
 */

export function print(logg: any = log): void {
  if (logg.i) logg.info('Ciao')
  if (logg.i) logg.info(`              ,--.                  ,--.      `)
  if (logg.i) logg.info(`.--.  ,--,---.|  |,---.,--,--,--,--\\\`--',---. `)
  if (logg.i) logg.info(` \\  ''  | .-. |  / .--' ,-.  |      ,--/ .--' `)
  if (logg.i) logg.info(`  \\    /' '-' |  \\ \`--\\ '-'  |  ||  |  \\ \`--. `)
  if (logg.i) logg.info(`   \`--'  \`---'\`--'\`---'\`--\`--\`--''--\`--'\`---' `)
  if (logg.i) logg.info('')
  if (logg.t) logg.trace(`Package ${pkg.name}`)
  if (logg.i) logg.info(`License ${pkg.license}`)
  if (logg.i) logg.info(`Version ${pkg.version}`)
  if (logg.i) logg.info(`Codename ${pkg.codename}`)
  if (logg.i) logg.info(`Environment ${process.env.NODE_ENV}`)
  if (logg.d) logg.debug(`Platform ${process.platform} ${process.arch}`)
  if (logg.t) logg.trace(`Root path ${process.cwd()}`)
  if (logg.d) logg.debug(`Node ${process.version}`)
  if (logg.t) logg.trace(`Release ${JSON.stringify(process.release)}`)
  if (logg.t) logg.trace(`Versions ${JSON.stringify(process.versions)}`)
}
