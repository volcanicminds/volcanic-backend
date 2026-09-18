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

    logDebugFn: (msg: string) => log.trace(msg),
    logWarnFn: (msg: string) => log.warn(msg),
    logErrorFn: (msg: string) => log.error(msg)
  })

  const basePath = path.join(__dirname, '..', 'locales', '*.json').replaceAll('\\', '/')

  const languages: Record<string, boolean> = {}
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
  // `defaultLocale` is a configured option the instance carries at runtime and the published
  // types do not describe, so the read is narrowed here instead of being an implicit any.
  i18n.setLocale((i18n as unknown as { defaultLocale?: string }).defaultLocale || 'en')
  return i18n
}

function addLocaleFile(i18n: I18n, locale: string, content: Record<string, unknown>) {
  let catalog = i18n && i18n.getCatalog()
  if (catalog && locale && content) {
    // The catalogue holds nested dictionaries (`objectNotation`), which the published type
    // describes as its own shape: the merge is the same object either way, so the assignment is
    // narrowed here rather than loosening the dictionaries everywhere they are read.
    catalog[locale] = (catalog[locale] ? { ...catalog[locale], ...content } : content) as (typeof catalog)[string]
  }
}
