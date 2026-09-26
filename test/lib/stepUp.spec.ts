import { expect } from 'expect'
import { STEP_UP_DEFAULT_MAX_AGE, authTimeClaim, stepUpMaxAge } from '../../lib/util/stepUp.js'

describe('util/stepUp · the freshness window (F50, F56)', () => {
  it('defaults to five minutes and accepts whole seconds from 60 to 3600', () => {
    expect(STEP_UP_DEFAULT_MAX_AGE).toBe(300)
    expect(stepUpMaxAge({})).toBe(300)
    expect(stepUpMaxAge({ STEP_UP_MAX_AGE: '' })).toBe(300)
    expect(stepUpMaxAge({ STEP_UP_MAX_AGE: '60' })).toBe(60)
    expect(stepUpMaxAge({ STEP_UP_MAX_AGE: '3600' })).toBe(3600)
  })

  it('stops the boot on a value outside the bounds or not a whole number', () => {
    for (const raw of ['59', '3601', '0', '-300', '300.5', 'five', '5m']) {
      expect(() => stepUpMaxAge({ STEP_UP_MAX_AGE: raw })).toThrow('STEP_UP_MAX_AGE must be an integer between 60 and 3600')
    }
  })

  it('writes auth_time in whole seconds, and nothing for a session never proven', () => {
    expect(authTimeClaim(new Date(1_700_000_000_999))).toEqual({ auth_time: 1_700_000_000 })
    expect(authTimeClaim('2026-09-27T10:00:00.500Z')).toEqual({ auth_time: Date.parse('2026-09-27T10:00:00Z') / 1000 })
    expect(authTimeClaim(null)).toEqual({})
    expect(authTimeClaim('not a date')).toEqual({})
  })
})
