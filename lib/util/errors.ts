/* eslint-disable @typescript-eslint/no-explicit-any */
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
    const phrase = translationCode || defaultMessage
    this.translatedMessage = phrase ? global.t.__({ phrase, locale: locale || 'en' }, data) : null
    // fallback: tradotto -> code grezzo -> defaultMessage -> catch-all
    this.message = this.translatedMessage || translationCode || defaultMessage || 'generic error'
    this.data = data

    Error.captureStackTrace(this, this.constructor || TranslatedError)
  }
}
