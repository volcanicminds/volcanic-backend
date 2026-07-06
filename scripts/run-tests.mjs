#!/usr/bin/env node
//
// Test runner: executes every test suite (each is its own mocha process — they own
// singletons like global.config/server and need different env, so they can't be
// merged into one run) and prints a single AGGREGATE summary at the end (total
// passing / failing / pending across all suites).
//
// Unlike the old `&&` chain it does NOT stop at the first failure: every suite runs,
// the per-suite mocha output is streamed through live (colors preserved), and the
// process exits non-zero if any suite failed — so CI still goes red.
//
import { spawn } from 'node:child_process'

const ESC = String.fromCharCode(27)
const c = (code, s) => `${ESC}[${code}m${s}${ESC}[0m`
const bold = (s) => c(1, s)
const red = (s) => c(31, s)
const green = (s) => c(32, s)

// The suites, in run order — same set the `test` script used to chain with &&.
const SUITES = [
  'test:core',
  'test:typeorm',
  'test:lib',
  'test:pglite',
  'test:e2e:pglite',
  'test:e2e:mt:pglite',
  'test:e2e:cookie:pglite',
  'test:e2e:norefresh:pglite',
  'test:e2e:mfa:pglite',
  'test:e2e:ratelimit:pglite',
  'test:e2e:fixture:pglite'
]

const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const stripAnsi = (s) => s.replace(ANSI, '')
const lastCount = (text, word) => {
  const m = [...text.matchAll(new RegExp(`(\\d+)\\s+${word}\\b`, 'g'))]
  return m.length ? Number(m[m.length - 1][1]) : 0
}

function runSuite(name) {
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', '--silent', name], {
      // Keep mocha's colored output even though we capture it (we strip ANSI to parse).
      env: { ...process.env, FORCE_COLOR: '1' },
      stdio: ['inherit', 'pipe', 'pipe']
    })
    let buf = ''
    const tap = (stream, out) =>
      stream.on('data', (d) => {
        out.write(d) // stream through live
        buf += d.toString()
      })
    tap(child.stdout, process.stdout)
    tap(child.stderr, process.stderr)
    child.on('close', (code) => {
      const text = stripAnsi(buf)
      resolve({
        name,
        code: code ?? 1,
        passing: lastCount(text, 'passing'),
        failing: lastCount(text, 'failing'),
        pending: lastCount(text, 'pending')
      })
    })
  })
}

const results = []
for (const name of SUITES) {
  process.stdout.write(`\n${bold('▶ ' + name)}\n`)
  results.push(await runSuite(name))
}

// ── Aggregate summary ────────────────────────────────────────────────────────
const tot = results.reduce(
  (a, r) => ({ passing: a.passing + r.passing, failing: a.failing + r.failing, pending: a.pending + r.pending }),
  { passing: 0, failing: 0, pending: 0 }
)
const anyFail = results.some((r) => r.code !== 0 || r.failing > 0)
const nameW = Math.max(12, ...results.map((r) => r.name.length))
const pad = (s, w) => String(s).padEnd(w)
const num = (n, w) => String(n).padStart(w)
const bar = '─'.repeat(nameW + 26)

const line = (name, p, f, s, extra = '') =>
  `  ${pad(name, nameW)}  ${num(p, 5)}  ${num(f, 5)}  ${num(s, 5)}${extra ? '   ' + extra : ''}`

console.log('\n' + bold('━━ Test summary ' + '━'.repeat(Math.max(0, nameW + 10))))
console.log('  ' + pad('suite', nameW) + '   pass   fail   skip')
for (const r of results) {
  const flag = r.code !== 0 && r.passing === 0 && r.failing === 0 ? '  ' + red('⚠ suite error') : ''
  console.log(line(r.name, r.passing, r.failing, r.pending, flag))
}
console.log('  ' + bar)
console.log(line('TOTAL', tot.passing, tot.failing, tot.pending, `(${results.length} suites)`))
console.log(
  anyFail
    ? '\n' + red('✖ FAILED') + ` — ${tot.failing} failing, ${tot.passing} passing, ${tot.pending} skipped\n`
    : '\n' + green('✔ PASSED') + ` — ${tot.passing} passing, ${tot.pending} skipped\n`
)

process.exit(anyFail ? 1 : 0)
