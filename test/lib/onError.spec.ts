/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-8.2 / defect D-23: the error hook echoed the exception on a 500 whatever
// `HIDE_ERROR_DETAILS` said, while the error handler of index.ts honoured it.
//
// The same deployment therefore hid its internals on one path and published them on the
// other, and which path a request took was not something the operator chose. What is asserted
// here is the body the client receives, since that is the whole observable.
//
import { expect } from 'expect'
import onError from '../../lib/hooks/onError.js'

;(global as any).log = { e: false, t: false }

function fakeReply() {
  const sent: any = { code: 0, body: null }
  const reply: any = {
    code(statusCode: number) {
      sent.code = statusCode
      return reply
    },
    send(body: any) {
      sent.body = body
      return reply
    },
    sent
  }
  return reply
}

async function run(error: any, hide: string | undefined) {
  const previous = process.env.HIDE_ERROR_DETAILS
  if (hide === undefined) delete process.env.HIDE_ERROR_DETAILS
  else process.env.HIDE_ERROR_DETAILS = hide

  const reply = fakeReply()
  try {
    await onError({} as any, reply, error)
  } finally {
    if (previous === undefined) delete process.env.HIDE_ERROR_DETAILS
    else process.env.HIDE_ERROR_DETAILS = previous
  }
  return reply.sent
}

describe('hooks/onError · HIDE_ERROR_DETAILS (D-23)', () => {
  it('withholds the message of a 500 when details are hidden', async () => {
    const sent = await run(new Error('connect ECONNREFUSED 10.0.0.7:5432'), 'true')
    expect(sent.code).toBe(500)
    expect(sent.body).toEqual({ statusCode: 500, error: 'Internal Server Error' })
  })

  it('passes the message through when details are allowed', async () => {
    const sent = await run(new Error('boom'), 'false')
    expect(sent.code).toBe(500)
    expect(sent.body.message).toBe('boom')
  })

  it('applies the same rule to a 4xx: a flag with exceptions is a flag nobody can reason about', async () => {
    const hidden = await run(Object.assign(new Error('user 42 not found'), { statusCode: 404 }), 'true')
    expect(hidden.code).toBe(404)
    expect(hidden.body.message).toBeUndefined()

    const shown = await run(Object.assign(new Error('user 42 not found'), { statusCode: 404 }), 'false')
    expect(shown.body.message).toBe('user 42 not found')
  })

  it('keeps the machine-readable code, which is not a detail: it is the contract', async () => {
    const sent = await run(Object.assign(new Error('nope'), { statusCode: 409, code: 'TENANT_MISMATCH' }), 'true')
    expect(sent.code).toBe(409)
    expect(sent.body.code).toBe('TENANT_MISMATCH')
    expect(sent.body.message).toBeUndefined()
  })

  it('still maps the two messages it has always mapped', async () => {
    expect((await run(new Error('Unauthorized'), 'false')).code).toBe(403)
    expect((await run(new Error('resource not found'), 'false')).code).toBe(404)
  })

  it('survives an error that is not an Error', async () => {
    const sent = await run('just a string', 'false')
    expect(sent.code).toBe(500)
    expect(sent.body.message).toBe('just a string')
  })
})
