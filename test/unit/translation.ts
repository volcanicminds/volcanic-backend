import { expect } from 'expect'
import { TranslatedError } from '../../lib/util/errors.js'

export default () => {
  describe('Translation', () => {
    it('should translate various messages', () => {
      expect(global.t.__('hello')).toBe('Hello')
      expect(global.t.__('hello', 'Superman')).toBe('Hello')
      expect(global.t.__('greeting.placeholder.formal', 'Superman')).toBe('Hello Superman')
      expect(global.t.__({ phrase: 'greeting.placeholder.informal', locale: 'en' }, 'Superman')).toBe('Hi Superman')
      expect(global.t.__({ phrase: 'greeting.placeholder.formal', locale: 'it' }, 'Superman')).toBe('Ciao Superman')
      expect(
        global.t.__({ phrase: 'complex', locale: 'en' }, { user: { firstname: 'Clark', lastname: 'Kent' } })
      ).toBe('Hello Clark Kent')
      expect(
        global.t.__({ phrase: 'complex', locale: 'it' }, { user: { firstname: 'Clark', lastname: 'Kent' } })
      ).toBe('Ciao Clark Kent')
    })

    it('should translate various errors', () => {
      let translated = new TranslatedError({ translationCode: 'hello' })
      expect(translated.message).toBe('Hello')
      expect(translated.translationCode).toBe('hello')
      expect(translated.translatedMessage).toBe('Hello')
      expect(translated.data).toMatchObject({})
      expect(translated.name).toBe('TranslatedError')
      expect(translated.locale).toBe('en')

      translated = new TranslatedError({ translationCode: 'hello', locale: 'it' })
      expect(translated.message).toBe('Ciao')
      expect(translated.translatedMessage).toBe('Ciao')
      expect(translated.locale).toBe('it')

      translated = new TranslatedError({
        translationCode: 'complex',
        locale: 'it',
        data: { user: { firstname: 'Clark', lastname: 'Kent' } }
      })
      expect(translated.message).toBe('Ciao Clark Kent')
      expect(translated.translatedMessage).toBe('Ciao Clark Kent')
      expect(translated.data).toEqual({ user: { firstname: 'Clark', lastname: 'Kent' } })
    })

    it('defaults status to 400 and honors a custom HTTP status', () => {
      expect(new TranslatedError({ translationCode: 'hello' }).status).toBe(400)
      expect(new TranslatedError({ translationCode: 'hello', status: 401 }).status).toBe(401)
      expect(new TranslatedError({ translationCode: 'hello', status: 404 }).status).toBe(404)
    })
  })
}
