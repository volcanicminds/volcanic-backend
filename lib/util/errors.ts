export class TranslatedError extends Error {
  locale: string
  status: number
  translationCode: string
  translatedMessage: string
  data: any

  constructor({ translationCode, data = {}, locale = 'en', defaultMessage = null, status = 400 }) {
    super()
    this.name = this.constructor?.name || 'TranslatedError'
    this.locale = locale
    this.status = status
    this.translationCode = translationCode
    this.translatedMessage = global.t.__({ phrase: translationCode || defaultMessage, locale: locale || 'en' }, data)
    this.message = this.translatedMessage || defaultMessage || 'generic error'
    this.data = data

    Error.captureStackTrace(this, this.constructor || TranslatedError)
  }
}
