import require from './require.js'
const pkg = require('root-require')('package.json')

/**
 * Minimal mark printed at startup
 */

export function print(logg: any = log): void {
  logg.i && logg.info('Ciao')
  logg.i && logg.info(`              ,--.                  ,--.      `)
  logg.i && logg.info(`.--.  ,--,---.|  |,---.,--,--,--,--\\\`--',---. `)
  logg.i && logg.info(` \\  ''  | .-. |  / .--' ,-.  |      ,--/ .--' `)
  logg.i && logg.info(`  \\    /' '-' |  \\ \`--\\ '-'  |  ||  |  \\ \`--. `)
  logg.i && logg.info(`   \`--'  \`---'\`--'\`---'\`--\`--\`--''--\`--'\`---' `)
  logg.i && logg.info('')
  logg.t && logg.trace(`Package ${pkg.name}`)
  logg.i && logg.info(`License ${pkg.license}`)
  logg.i && logg.info(`Version ${pkg.version}`)
  logg.i && logg.info(`Codename ${pkg.codename}`)
  logg.i && logg.info(`Environment ${process.env.NODE_ENV}`)
  logg.t && logg.trace(`Platform ${process.platform} ${process.arch}`)
  logg.t && logg.trace(`Root path ${process.cwd()}`)
  logg.t && logg.trace(`Node ${process.version}`)
  logg.t && logg.trace(`Release ${JSON.stringify(process.release)}`)
  logg.t && logg.trace(`Versions ${JSON.stringify(process.versions)}`)
}
