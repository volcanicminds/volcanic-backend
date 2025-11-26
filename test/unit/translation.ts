import { expect } from 'expect'
import { TranslatedError } from '../../lib/util/errors'

export default () => {
  describe('Translation', () => {
    it('should translate various messages', () => {
      try {
        let translated = global.t.__('hello')
        expect(translated).toBe('Hello')

        translated = global.t.__('hello', 'Superman')
        expect(translated).toBe('Hello')

        translated = global.t.__('greeting.placeholder.formal', 'Superman')
        expect(translated).toBe('Hello Superman')

        translated = global.t.__({ phrase: 'greeting.placeholder.informal', locale: 'en' }, 'Superman')
        expect(translated).toBe('Hi Superman')

        translated = global.t.__({ phrase: 'greeting.placeholder.formal', locale: 'it' }, 'Superman')
        expect(translated).toBe('Ciao Superman')

        translated = global.t.__(
          { phrase: 'complex', locale: 'en' },
          { user: { firstname: 'Clark', lastname: 'Kent' } }
        )
        expect(translated).toBe('Hello Clark Kent')

        translated = global.t.__(
          { phrase: 'complex', locale: 'it' },
          { user: { firstname: 'Clark', lastname: 'Kent' } }
        )
        expect(translated).toBe('Ciao Clark Kent')
      } catch (err) {
        global.log.error(err)
      }
    })

    it('should translate various errors', () => {
      let translated
      try {
        translated = new TranslatedError({ translationCode: 'hello' })
        expect(translated).toBeDefined()
        expect(translated.message).toBe('Hello')
        expect(translated.translationCode).toBe('hello')
        expect(translated.translatedMessage).toBe('Hello')
        expect(translated.data).toMatchObject({})
        expect(translated.name).toBe('TranslatedError')
        expect(translated.locale).toBe('en')

        translated = new TranslatedError({ translationCode: 'hello', locale: 'it' })
        expect(translated).toBeDefined()
        expect(translated.message).toBe('Ciao')
        expect(translated.translationCode).toBe('hello')
        expect(translated.translatedMessage).toBe('Ciao')
        expect(translated.data).toEqual({})
        expect(translated.name).toBe('TranslatedError')
        expect(translated.locale).toBe('it')

        translated = new TranslatedError({
          translationCode: 'complex',
          locale: 'it',
          data: { user: { firstname: 'Clark', lastname: 'Kent' } }
        })
        expect(translated).toBeDefined()
        expect(translated.message).toBe('Ciao Clark Kent')
        expect(translated.translationCode).toBe('complex')
        expect(translated.translatedMessage).toBe('Ciao Clark Kent')
        expect(translated.data).toEqual({ user: { firstname: 'Clark', lastname: 'Kent' } })
        expect(translated.name).toBe('TranslatedError')
        expect(translated.locale).toBe('it')
      } catch (err) {
        global.log.error(err)
      }
    })
  })
}
