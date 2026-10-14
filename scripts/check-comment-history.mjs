#!/usr/bin/env node
//
// A comment states an invariant or a gotcha of the code it sits on. How the code got there,
// which task asked for it and what was decided along the way belong to docs/evo, so a comment
// naming a task, a finding, a decision, an audit item, a journal file or a numbered phase fails
// the check.
//
// Two more kinds of line are listed for review without failing it. A mention of v4 is right
// when it states what the code does today with v4 input, and wrong when it tells the past; a
// pattern cannot tell the two apart. A line that reads as Italian is found by a word list, which
// misses some lines and flags a few English ones.
//
// Comments are found by the TypeScript parser, so a `//` inside a string, a template or a regex
// is not one. YAML has no parser here: a `#` at the start of a line or after a blank counts.
//
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const ROOT = path.resolve(import.meta.dirname, '..')
const DIRS = ['lib', 'types', 'test', 'scripts', 'bin', '.github']
const FILES = ['index.ts', 'db.ts']
const SCRIPT = /\.[cm]?[jt]s$/
const YAML = /\.ya?ml$/

const HISTORY = [
  /\bT-\d+\.\d+/, // a task
  /\bF\d{2,3}\b/, // a finding
  /\bD-\d{2}\b/, // a decision or a defect
  /\b(?!S3\b)[AQS]\d{1,2}\b|\bBE-\d+\b/, // an audit item, an open question, a backend item
  /EVO_/, // a journal file
  /\b(?:phase|fase)\s+\d/i
]
const V4 = /\bv4\b|\b4\.x\b/i

// Function words of Italian. One word English never uses makes a line likely Italian; the
// shorter ones need a second word. `non`, `per`, `con` and `come` are English too and stay out.
const words = (list) => new Set(list.split(/\s+/))
const ITALIAN_ALONE = words(`che della delle dello degli nella nelle nello sono viene vengono questo
  questa questi quando ogni deve devono senza oppure quindi invece però contro ha hanno è perché
  più già può così cioè mentre`)
const ITALIAN_PAIRED = words(`il lo gli dei del nel nei sul sulla alla alle dal dalla ai agli anche
  dove ancora cosa una uno di da essere tutti tutte serve qui poi dopo prima solo sempre mai tra fra`)

const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (SCRIPT.test(entry) || YAML.test(entry)) out.push(full)
  }
  return out
}

// Every comment sits in the trivia around some token: on its own lines it is leading trivia
// of the next token, on the line of a token it is trailing trivia of that token. Visiting
// every node with both covers the file once the ranges are keyed by their start.
const scriptCommentLines = (file, text) => {
  const source = ts.createSourceFile(
    file,
    text,
    { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
    true
  )
  const ranges = new Map()
  const visit = (node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) ranges.set(range.pos, range)
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) ranges.set(range.pos, range)
    for (const child of node.getChildren(source)) visit(child)
  }
  visit(source)
  const lines = new Map() // line number -> comment text on that line
  for (const { pos, end } of ranges.values()) {
    const first = source.getLineAndCharacterOfPosition(pos).line
    const last = source.getLineAndCharacterOfPosition(end).line
    for (let line = first; line <= last; line++) {
      const start = Math.max(pos, source.getPositionOfLineAndCharacter(line, 0))
      const stop = line === last ? end : source.getLineEndOfPosition(start)
      lines.set(line + 1, `${lines.get(line + 1) ?? ''} ${text.slice(start, stop)}`.trim())
    }
  }
  return lines
}

const yamlCommentLines = (text) => {
  const lines = new Map()
  text.split('\n').forEach((line, index) => {
    const at = line.search(/(?:^|\s)#/)
    if (at >= 0) lines.set(index + 1, line.slice(at).trim())
  })
  return lines
}

const looksItalian = (comment) => {
  const found = new Set(comment.toLowerCase().match(/[a-zàèéìòù]+/g) ?? [])
  let paired = 0
  for (const word of found) {
    if (ITALIAN_ALONE.has(word)) return true
    if (ITALIAN_PAIRED.has(word)) paired++
  }
  return paired >= 2
}

const files = [
  ...DIRS.flatMap((dir) => walk(path.join(ROOT, dir))),
  ...FILES.map((file) => path.join(ROOT, file))
]

const history = []
const v4 = []
const italian = []
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const lines = YAML.test(file) ? yamlCommentLines(text) : scriptCommentLines(file, text)
  const where = path.relative(ROOT, file)
  for (const [line, comment] of [...lines].sort(([a], [b]) => a - b)) {
    const entry = `  ${where}:${line}  ${comment.slice(0, 140)}`
    if (HISTORY.some((pattern) => pattern.test(comment))) history.push(entry)
    else if (V4.test(comment)) v4.push(entry)
    if (looksItalian(comment)) italian.push(entry)
  }
}

if (v4.length) {
  console.warn(`⚠ ${v4.length} comment line(s) mention v4; each should state what the code does today:\n`)
  console.warn(`${v4.join('\n')}\n`)
}
if (italian.length) {
  console.warn(`⚠ ${italian.length} comment line(s) look Italian; comments are English:\n`)
  console.warn(`${italian.join('\n')}\n`)
}
if (history.length) {
  console.error(`✖ ${history.length} comment line(s) carry decision history:\n`)
  console.error(`${history.join('\n')}\n`)
  console.error('  Keep the invariant or the gotcha, drop the task, finding, decision or phase.')
  console.error('  The history of a change belongs to docs/evo and to the commit message.\n')
  process.exit(1)
}

console.log(`✔ ${files.length} files, no comment carries decision history`)
