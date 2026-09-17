#!/usr/bin/env node
// Enforces the coverage floors declared in .c8rc.json against the summary c8 just wrote.
//
// c8's own --check-coverage is not used: under --experimental-monocart it reads a summary whose
// line total is the covered statement count, so a run reporting 85.06% of lines is enforced as
// 1435/1755 = 81.77%. A gate that judges a number nobody is shown is the defect this file exists
// to remove, so the floors are compared against coverage-summary.json, which is the same data
// the text report prints.
import { readFileSync } from 'node:fs'

const METRICS = ['statements', 'branches', 'functions', 'lines']

const config = JSON.parse(readFileSync('.c8rc.json', 'utf8'))
const summaryPath = `${config['reports-dir'] ?? 'coverage'}/coverage-summary.json`

let total
try {
  total = JSON.parse(readFileSync(summaryPath, 'utf8')).total
} catch {
  console.error(`No coverage summary at ${summaryPath}. Run "npm run coverage:report" first.`)
  process.exit(1)
}

let failed = false
for (const metric of METRICS) {
  const floor = config[metric]
  if (typeof floor !== 'number') continue
  const { pct, covered, total: count } = total[metric]
  const ok = pct >= floor
  if (!ok) failed = true
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${metric.padEnd(10)} ${pct.toFixed(2).padStart(6)}%  (${covered}/${count})  floor ${floor}%`)
}

if (failed) {
  console.error('\nCoverage is below the floor. The floors sit just under what the suite reaches:')
  console.error('they fail a change that removes coverage, so lowering them is a decision, not a fix.')
  process.exit(1)
}
