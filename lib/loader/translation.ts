/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable prefer-const */
import path from 'path'
import { globSync } from 'glob'
import { I18n } from 'i18n'
import { fileURLToPath } from 'url'
import require from '../util/require.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export function load(): any {
  const i18n = new I18n({
    locales: ['en', 'it'],
    defaultLocale: 'en',
    // header: 'accept-language',
    autoReload: false,
    updateFiles: false,
    syncFiles: false,
    extension: '.json',
    prefix: '',
    objectNotation: true,
    // mustacheConfig: { disable: false },
    // directory: './src/locales',

    logDebugFn: (msg) => log.trace(msg),
    logWarnFn: (msg) => log.warn(msg),
    logErrorFn: (msg) => log.error(msg)
  })

  const basePath = path.join(__dirname, '..', 'locales', '*.json').replaceAll('\\', '/')

  const languages = {}
  globSync(basePath, { windowsPathsNoEscape: true }).forEach((f: string) => {
    if (log.d) log.debug('* Loading base dictionary %s', path.parse(f).base)
    try {
      const content = require(f)
      addLocaleFile(i18n, path.parse(f).name, content)
      languages[path.parse(f).name] = true
    } catch (err) {
      log.error(err)
    }
  })

  const addPath = path.join(process.cwd(), 'src', 'locales', '*.json').replaceAll('\\', '/')

  globSync(addPath, { windowsPathsNoEscape: true }).forEach((f: string) => {
    if (log.d) log.debug('* Loading additional dictionary %s', path.parse(f).base)
    try {
      const content = require(f)
      addLocaleFile(i18n, path.parse(f).name, content)
      languages[path.parse(f).name] = true
    } catch (err) {
      log.error(err)
    }
  })

  if (log.i) log.info('Loaded languages: %s', Object.keys(languages).join(', '))
  i18n.setLocale(i18n.defaultLocale || 'en')
  return i18n
}

function addLocaleFile(i18n, locale, content) {
  let catalog = i18n && i18n.getCatalog()
  if (catalog && locale && content) {
    catalog[locale] = catalog[locale] ? { ...catalog[locale], ...content } : content
  }
}
