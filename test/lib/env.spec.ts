/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-9.4: reading a tunable out of the environment.
//
// The rule this serves is an invariant: **the declared default is what the code does**, and no
// field is typed, documented and never read. That was defect D-11, and it came back anyway —
// `VOLCANIC_MAX_PAGE_SIZE`, `TENANT_CONTAINERS_MAX_OPEN`, `TENANT_CONTAINERS_DIR` and
// `DESTRUCTION_TOKEN_TTL` were all in the documented environment table and consulted by
// nobody. Found by the tuning bench, which set out to MEASURE what those variables carry and
// discovered there was nowhere to put the answer.
//
// What is worth pinning is the refusals, because the failure mode of getting them wrong is
// quiet: a limit nobody set behaving like a limit somebody chose.
//
import { expect } from 'expect'
import { envInt, envString } from '../../lib/util/env.js'

const warnings: string[] = []
let savedLog: any

const withEnv = (name: string, value: string | undefined, fn: () => void) => {
  const previous = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    fn()
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

describe('util/env · reading a tunable (T-9.4)', () => {
  before(() => {
    savedLog = (global as any).log
    ;(global as any).log = { w: true, warn: (m: string) => warnings.push(m) }
  })

  after(() => {
    ;(global as any).log = savedLog
  })

  beforeEach(() => {
    warnings.length = 0
  })

  it('reads a number, and falls back when the variable is absent or blank', () => {
    withEnv('PROBE_INT', '42', () => expect(envInt('PROBE_INT', 7)).toBe(42))
    withEnv('PROBE_INT', undefined, () => expect(envInt('PROBE_INT', 7)).toBe(7))
    // Blank counts as absent: `FOO=` in a .env file is how a variable gets commented out in
    // practice, and reading it as 0 would be reading a limit of nothing.
    withEnv('PROBE_INT', '   ', () => expect(envInt('PROBE_INT', 7)).toBe(7))
  })

  it('refuses a value that is not a positive integer, and says so', () => {
    for (const bad of ['nonsense', '0', '-5', '2.5', 'NaN', 'Infinity']) {
      withEnv('PROBE_INT', bad, () => expect(envInt('PROBE_INT', 7)).toBe(7))
    }
    // Said out loud, every time: a variable that is silently ignored is a setting the operator
    // believes is in effect.
    expect(warnings.length).toBe(6)
    expect(warnings[0]).toContain('PROBE_INT')
  })

  it('clamps to the bounds rather than refusing to start, and reports the clamp', () => {
    // A digit too many should not stop an instance; it should also not become what was typed.
    withEnv('PROBE_INT', '3', () => expect(envInt('PROBE_INT', 12, { min: 12 })).toBe(12))
    withEnv('PROBE_INT', '99', () => expect(envInt('PROBE_INT', 12, { max: 20 })).toBe(20))
    expect(warnings.length).toBe(2)
    expect(warnings[0]).toContain('minimum')
    expect(warnings[1]).toContain('maximum')
  })

  it('never lets a work factor below the floor through, whatever is written', () => {
    // The one that matters most: a tunable BCRYPT_COST is also a way to weaken every password
    // in the database with one variable, and nothing downstream would report it.
    for (const attempt of ['4', '1', '0', '-12']) {
      withEnv('BCRYPT_COST', attempt, () => expect(envInt('BCRYPT_COST', 12, { min: 12, max: 20 })).toBe(12))
    }
  })

  it('reads a string, trimming it, and treats blank as absent', () => {
    withEnv('PROBE_STR', './data/tenants', () => expect(envString('PROBE_STR', './fallback')).toBe('./data/tenants'))
    withEnv('PROBE_STR', '  ./padded  ', () => expect(envString('PROBE_STR', './fallback')).toBe('./padded'))
    withEnv('PROBE_STR', '   ', () => expect(envString('PROBE_STR', './fallback')).toBe('./fallback'))
    withEnv('PROBE_STR', undefined, () => expect(envString('PROBE_STR', './fallback')).toBe('./fallback'))
  })

  it('does not need a logger to exist, because a migration script has none', () => {
    // `log?.w` still throws when `log` is undeclared — optional chaining guards a property,
    // not an identifier — which is the bug T-9.1 found across the whole data layer.
    const saved = (global as any).log
    delete (global as any).log
    try {
      withEnv('PROBE_INT', 'nonsense', () => expect(envInt('PROBE_INT', 7)).toBe(7))
    } finally {
      ;(global as any).log = saved
    }
  })
})

describe('util/env · the variables that were documented and unread (T-9.4)', () => {
  it('is what VOLCANIC_MAX_PAGE_SIZE now goes through', async () => {
    // End of the D-11 shape: the clamp the documentation promises is the clamp the query
    // layer applies. The route's own option still wins — the variable is the deployment's
    // ceiling, not a way to raise a limit a route deliberately lowered.
    const { parseQuery } = await import('../../lib/database/query/index.js')
    const { appTables } = await import('../../lib/database/schema/sqlite.js')
    const { user } = appTables()

    withEnv('VOLCANIC_MAX_PAGE_SIZE', '10', () => {
      expect(parseQuery(user, { _pageSize: '500' }, { dialect: 'sqlite' }).pageSize).toBe(10)
      // The route asked for less: the variable does not raise it.
      expect(parseQuery(user, { _pageSize: '500' }, { dialect: 'sqlite', maxPageSize: 5 }).pageSize).toBe(5)
    })

    withEnv('VOLCANIC_MAX_PAGE_SIZE', undefined, () => {
      expect(parseQuery(user, { _pageSize: '500' }, { dialect: 'sqlite' }).pageSize).toBe(100)
    })
  })
})
