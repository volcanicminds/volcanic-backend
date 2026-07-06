/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import onError from '../../lib/hooks/onError.js'

// Minimal chainable reply stub capturing the final status + body.
function fakeReply() {
  const r: any = { statusCode: 200, body: undefined }
  r.code = (c: number) => {
    r.statusCode = c
    return r
  }
  r.send = (b: any) => {
    r.body = b
    return r
  }
  return r
}

const run = async (error: any) => {
  const reply = fakeReply()
  await onError({} as any, reply as any, error)
  return reply
}

export default () => {
  describe('hooks/onError — error → status mapping', () => {
    it('preserves an explicit statusCode >= 400 and sends the error as-is', async () => {
      const err: any = { statusCode: 403, message: 'nope' }
      const r = await run(err)
      expect(r.statusCode).toBe(403)
      expect(r.body).toBe(err)
    })

    it("maps 'Wrong credentials' / 'Unauthorized' to 403 Forbidden", async () => {
      const r1 = await run(new Error('Wrong credentials'))
      expect(r1.statusCode).toBe(403)
      expect(r1.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Wrong credentials' })
      const r2 = await run(new Error('Unauthorized'))
      expect(r2.statusCode).toBe(403)
    })

    it("maps a message containing 'not found' to 404", async () => {
      const r = await run(new Error('widget not found'))
      expect(r.statusCode).toBe(404)
      expect(r.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'widget not found' })
    })

    it('falls back to 500 for a generic error', async () => {
      const r = await run(new Error('boom'))
      expect(r.statusCode).toBe(500)
      expect(r.body).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'boom' })
    })

    it('does not crash when the error has no message (undefined)', async () => {
      const r = await run({}) // no message, no statusCode
      expect(r.statusCode).toBe(500)
      expect(r.body.error).toBe('Internal Server Error')
    })

    it('handles a thrown string (error is not an object)', async () => {
      const r = await run('kaboom')
      expect(r.statusCode).toBe(500)
      expect(r.body.message).toBe('kaboom')
    })
  })
}
