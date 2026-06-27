/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E (consumer-app fixture) — the optional plugins that ship OFF by default,
// enabled via src/config/plugins.ts: compression, multipart, raw body.
//
import { expect } from 'expect'
import { app, login, authHeader, EDITOR } from './harness.js'

describe('E2E (consumer-app fixture) — optional plugins', () => {
  const inject = (opts: any) => app().inject(opts)
  let tok: string

  before(async () => {
    tok = await login(EDITOR.email, EDITOR.password)
  })

  it('compress: a gzip-accepting client gets a compressed response', async () => {
    const res = await inject({
      method: 'GET',
      url: '/widgets',
      headers: { ...authHeader(tok), 'accept-encoding': 'gzip' }
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
  })

  it('compress: without accept-encoding the response is plain', async () => {
    const res = await inject({ method: 'GET', url: '/widgets', headers: authHeader(tok) })
    expect(res.headers['content-encoding']).toBeUndefined()
  })

  it('multipart: a multipart form is parsed (fields + files)', async () => {
    const boundary = '----fixtureboundary'
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="title"\r\n\r\n' +
      'hello-multipart\r\n' +
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="doc"; filename="a.txt"\r\n' +
      'Content-Type: text/plain\r\n\r\n' +
      'file-content\r\n' +
      `--${boundary}--\r\n`

    const res = await inject({
      method: 'POST',
      url: '/widgets/upload',
      headers: { ...authHeader(tok), 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body
    })
    expect(res.statusCode).toBe(200)
    const parsed = JSON.parse(res.body)
    expect(parsed.title).toBe('hello-multipart')
    expect(parsed.doc).toBe('file:a.txt')
  })

  it('rawBody: the raw request payload is captured on a rawBody route', async () => {
    const raw = 'signature-sensitive-payload-123'
    const res = await inject({
      method: 'POST',
      url: '/widgets/webhook',
      headers: { ...authHeader(tok), 'content-type': 'text/plain' },
      payload: raw
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).rawBody).toBe(raw)
  })
})
