/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { normalizePatterns } from '../../lib/util/path.js'

describe('util/path — normalizePatterns', () => {
  it('returns two glob patterns: one lib-relative, one cwd/src-relative', () => {
    const [libPattern, srcPattern] = normalizePatterns(
      ['..', 'api', '**', 'routes.{ts,js}'],
      ['src', 'api', '**', 'routes.{ts,js}']
    )
    expect(libPattern.endsWith('/api/**/routes.{ts,js}')).toBe(true)
    expect(srcPattern.startsWith(process.cwd().replaceAll('\\', '/'))).toBe(true)
    expect(srcPattern.endsWith('/src/api/**/routes.{ts,js}')).toBe(true)
  })

  it('always uses forward slashes (windows-safe)', () => {
    const patterns = normalizePatterns(['..', 'config', 'general.{ts,js}'], ['src', 'config', 'general.{ts,js}'])
    patterns.forEach((p) => expect(p.includes('\\')).toBe(false))
  })
})
