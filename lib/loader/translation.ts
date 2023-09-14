const path = require('path')
const glob = require('glob')
const { I18n } = require('i18n')

// import { normalizePatterns } from '../util/path'

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

    logDebugFn: (msg) => log.debug(msg),
    logWarnFn: (msg) => log.warn(msg),
    logErrorFn: (msg) => log.error(msg)
  })

  const basePath = path.join(__dirname, '..', 'locales', '*.json').replaceAll('\\', '/')

  glob.sync(basePath).forEach((f: string) => {
    log.info('* Loading base dictionary %s', path.parse(f).base)
    try {
      const content = require(f)
      addLocaleFile(i18n, path.parse(f).name, content)
    } catch (err) {
      log.error(err)
    }
  })

  const addPath = path.join(process.cwd(), 'src', 'locales', '*.json').replaceAll('\\', '/')

  glob.sync(addPath).forEach((f: string) => {
    log.info('* Loading additional dictionary %s', path.parse(f).base)
    try {
      const content = require(f)
      addLocaleFile(i18n, path.parse(f).name, content)
    } catch (err) {
      log.error(err)
    }
  })

  i18n.setLocale(i18n.defaultLocale || 'en')
  //   let test1 = i18n.__('greeting.formal')
  //   let test2 = i18n.__('hello')
  //   let test3 = i18n.__('greeting.placeholder.formal', 'UGO')
  //   let test4 = i18n.__('greeting.placeholder.formalize:Buondì %s', 'UGO')
  //   let test5 = i18n.__('greeting.formal')
  //   let test6 = i18n.__({ phrase: 'greeting.formal', locale: 'it' })
  //   let test7 = i18n.__({ phrase: 'greeting.placeholder.formal', locale: 'it' }, 'UGO')
  //   i18n.setLocale(i18n.defaultLocale || 'en')
  return i18n
}

function addLocaleFile(i18n, locale, content) {
  let catalog = i18n && i18n.getCatalog()
  if (catalog && locale && content) {
    catalog[locale] = catalog[locale] ? { ...catalog[locale], ...content } : content
  }
}
