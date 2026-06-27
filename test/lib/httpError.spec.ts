/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { httpError } from '../../lib/util/httpError.js'

describe('util/httpError', () => {
  it('maps known status codes to their reason phrase', () => {
    expect(httpError(400)).toEqual({ statusCode: 400, error: 'Bad Request' })
    expect(httpError(401).error).toBe('Unauthorized')
    expect(httpError(403).error).toBe('Forbidden')
    expect(httpError(404).error).toBe('Not Found')
    expect(httpError(409).error).toBe('Conflict')
    expect(httpError(422).error).toBe('Unprocessable Entity')
    expect(httpError(429).error).toBe('Too Many Requests')
    expect(httpError(500).error).toBe('Internal Server Error')
  })

  it('falls back to a generic reason for unknown codes', () => {
    expect(httpError(418).error).toBe('Error')
  })

  it('includes code and message only when provided', () => {
    expect(httpError(403, 'nope', 'FORBIDDEN')).toEqual({
      statusCode: 403,
      error: 'Forbidden',
      code: 'FORBIDDEN',
      message: 'nope'
    })
    // no optional fields -> absent (not undefined keys)
    expect(Object.keys(httpError(404))).toEqual(['statusCode', 'error'])
    // message only
    expect(httpError(400, 'bad')).toEqual({ statusCode: 400, error: 'Bad Request', message: 'bad' })
  })
})
