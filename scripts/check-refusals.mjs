#!/usr/bin/env node
//
// T-9.5: every refusal the framework can answer with has a test that makes it fire.
//
// The framework refuses a great deal, on purpose: v5 replaced silent fallbacks with visible
// failures nearly everywhere, and that is half its design. But a refusal nobody has ever seen
// fire is a refusal whose INTENT is known and whose behaviour is not — the guard may be on a
// path the request never takes, may compare the wrong field, may be dead code. Defect D-03 was
// exactly that: an anti-spoofing check comparing a property the entity did not have, in a hook
// that ran before the one that would have populated it. It never fired, nothing failed, and
// the tenant was decided by the header for two years.
//
// So this compares the error codes the SOURCE can produce against the codes the TESTS name.
// It is deliberately shallow — a code named in a test is counted — because the alternative is
// a heuristic that decides what a test "really" asserts and gets it wrong in both directions.
// Naming a code in a test is a low bar that catches the thing worth catching: a refusal
// written and then never thought about again.
//
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue
    if (statSync(full).isDirectory()) walk(full, out)
    else if (full.endsWith('.ts') && !full.endsWith('.d.ts')) out.push(full)
  }
  return out
}

const sourceFiles = [
  ...walk(path.join(ROOT, 'lib')),
  path.join(ROOT, 'index.ts'),
  path.join(ROOT, 'db.ts')
]
const testFiles = walk(path.join(ROOT, 'test'))

//
// A code is a string used AS a code, not any capitalised string. `BEARER`, `SIGTERM` and
// `PATCH` are values; matching them would drown the real list in noise, and a check nobody
// can read is a check nobody runs.
//
const PATTERNS = [
  /\bhttpError\(\s*\d+\s*,\s*(?:'[^']*'|`[^`]*`|[A-Za-z_$][\w$.]*)\s*,\s*'([A-Z][A-Z0-9_]{3,})'/g, // httpError(403, msg, CODE)
  /\bqueryError\(\s*'([A-Z][A-Z0-9_]{3,})'/g, // the Magic Query refusals
  /\bcode\s*[:=]\s*'([A-Z][A-Z0-9_]{3,})'/g, // { code: 'X' } and `readonly code = 'X'`
  /\bcode\s*=\s*'([A-Z][A-Z0-9_]{3,})'\s+as\s+const/g
]

// Values that the patterns above legitimately catch and that are not refusals: names of
// environment variables, driver codes we READ rather than emit, and enum members.
const NOT_A_REFUSAL = new Set([
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'COOKIE_SECRET',
  'MFA_DB_SECRET',
  'SQLITE_CONSTRAINT', // read from the driver, never emitted
  'EEXIST',
  'SIGTERM',
  'OPTIONAL',
  'MANDATORY',
  'ONE_WAY',
  'BEARER',
  'COOKIE'
])

// Codes the framework answered with once and must not answer with again. A client written
// against the old contract still branches on them, so one coming back would revive a path the
// client believes is gone.
const RETIRED = new Map([
  ['MFA_REQUIRED', 'the pre-auth token left with F36 (T-12.35): the second factor is a stage of the login flow']
])

const emitted = new Map() // code -> Set of files
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8')
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const code = match[1]
      if (NOT_A_REFUSAL.has(code)) continue
      if (!emitted.has(code)) emitted.set(code, new Set())
      emitted.get(code).add(path.relative(ROOT, file))
    }
  }
}

const asserted = new Set()
for (const file of testFiles) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/'([A-Z][A-Z0-9_]{3,})'|"([A-Z][A-Z0-9_]{3,})"|\/([A-Z][A-Z0-9_]{3,})\//g)) {
    asserted.add(match[1] ?? match[2] ?? match[3])
  }
}

const revived = [...emitted.keys()].filter((code) => RETIRED.has(code)).sort()
if (revived.length) {
  console.error(`✖ ${revived.length} retired refusal(s) emitted again:\n`)
  for (const code of revived) {
    console.error(`  ${code.padEnd(38)} ${[...emitted.get(code)].join(', ')}`)
    console.error(`  ${''.padEnd(38)} retired: ${RETIRED.get(code)}`)
  }
  console.error('')
  process.exit(1)
}

const untested = [...emitted.keys()].filter((code) => !asserted.has(code)).sort()

if (untested.length) {
  console.error(`✖ ${untested.length} refusal(s) no test ever fires (T-9.5):\n`)
  for (const code of untested) {
    console.error(`  ${code.padEnd(38)} ${[...emitted.get(code)].join(', ')}`)
  }
  console.error('\n  Write a test that provokes the real condition — not one that calls the guard.')
  console.error('  A guard proven to throw when invoked is not a guard proven to be on the path.\n')
  process.exit(1)
}

console.log(`✔ ${emitted.size} refusals, each named by at least one test; ${RETIRED.size} retired, none emitted`)
