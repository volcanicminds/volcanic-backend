#!/usr/bin/env node
//
// T-3.1, point 3: no `SET search_path` outside a transaction, anywhere in the sources.
//
// This is the cheap half of the rule, a grep, so the statement cannot be *written*. The
// expensive half runs on the driver (lib/database/adapters/postgres/guard.ts), so it cannot
// be *emitted* either. Neither replaces the other: the grep also covers code paths no test
// exercises, and the guard also covers SQL the framework never wrote.
//
// Allowed: `SET LOCAL search_path`, which the commit or the rollback undoes by definition.
// Allowed: this script, the guard, and the suite that proves them: the three files whose
// job is to name the statement they forbid. The list is short and it is meant to stay
// short: adding a file to it is admitting the rule does not hold there.
//
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const EXEMPT = new Set([
  'scripts/check-session-state.mjs',
  'lib/database/adapters/postgres/guard.ts',
  'test/db/session-state.spec.ts'
])

const SESSION = /(?:^|[\s;('"`])set\s+(?:session\s+)?search_path\b/i
const LOCAL = /(?:^|[\s;('"`])set\s+local\s+search_path\b/i

/**
 * Comments are stripped before matching: a file is allowed to EXPLAIN the statement it must
 * not run, and half of this repository's comments exist to say why D-01 happened. Newlines
 * are preserved so the reported line number is the real one.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/\/\/[^\n]*/g, '')
}

// Tracked AND untracked-but-not-ignored: a file that is not committed yet is exactly the
// file this check exists for.
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts', '*.mjs', '*.js', '*.cjs'], {
  encoding: 'utf8'
})
  .split('\n')
  .filter((f) => f && !EXEMPT.has(f))

const findings = []
for (const file of files) {
  const lines = stripComments(readFileSync(file, 'utf8')).split('\n')
  lines.forEach((line, i) => {
    if (SESSION.test(line) && !LOCAL.test(line)) findings.push(`${file}:${i + 1}: ${line.trim()}`)
  })
}

if (findings.length) {
  console.error('✖ session state on a pooled connection is forbidden (T-3.1):\n')
  for (const f of findings) console.error('  ' + f)
  console.error('\n  Use qualified tables, or SET LOCAL inside a transaction.\n')
  process.exit(1)
}
console.log(`✔ no session-level search_path in ${files.length} files`)
