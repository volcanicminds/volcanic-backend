import { queryError } from './errors.js'

//
// The `_logic` expression: aliases combined with AND, OR, NOT and parentheses. Nothing else.
//
// v4 parsed this with no limit on length or nesting, caught the resulting stack overflow, and
// fell back to an AND of every condition (D-13). The query then answered a different question
// with a straight face. Here every failure is an error with a code, and the limits are
// explicit so that a caller can be told which one it crossed.
//
export interface LogicLimits {
  maxLength: number
  maxDepth: number
  maxAliases: number
}

export const DEFAULT_LOGIC_LIMITS: LogicLimits = { maxLength: 512, maxDepth: 8, maxAliases: 32 }

export type LogicNode =
  | { type: 'alias'; name: string }
  | { type: 'not'; operand: LogicNode }
  | { type: 'and' | 'or'; left: LogicNode; right: LogicNode }

const ALIAS = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/

type Token = { kind: 'alias' | 'and' | 'or' | 'not' | '(' | ')'; value: string }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  const parts = input.replace(/([()])/g, ' $1 ').trim().split(/\s+/)

  for (const part of parts) {
    if (!part) continue
    const upper = part.toUpperCase()
    if (part === '(' || part === ')') tokens.push({ kind: part, value: part })
    else if (upper === 'AND') tokens.push({ kind: 'and', value: upper })
    else if (upper === 'OR') tokens.push({ kind: 'or', value: upper })
    else if (upper === 'NOT') tokens.push({ kind: 'not', value: upper })
    else if (ALIAS.test(part)) tokens.push({ kind: 'alias', value: part })
    else throw queryError('QUERY_LOGIC_INVALID', `_logic contains something that is not an alias or an operator`)
  }
  return tokens
}

/**
 * Recursive descent over `or → and → not → primary`, so precedence is AND before OR, as in
 * SQL. Depth is counted while parsing rather than checked afterwards: the limit exists to
 * stop the parser, not to describe the result.
 */
export function parseLogic(input: string, limits: LogicLimits = DEFAULT_LOGIC_LIMITS): LogicNode {
  if (input.length > limits.maxLength) {
    throw queryError('QUERY_LOGIC_TOO_COMPLEX', `_logic is longer than ${limits.maxLength} characters`)
  }

  const tokens = tokenize(input)
  const aliases = new Set(tokens.filter((t) => t.kind === 'alias').map((t) => t.value))
  if (aliases.size > limits.maxAliases) {
    throw queryError('QUERY_LOGIC_TOO_COMPLEX', `_logic names more than ${limits.maxAliases} aliases`)
  }

  let position = 0
  const peek = () => tokens[position]
  const next = () => tokens[position++]

  function parseOr(depth: number): LogicNode {
    let node = parseAnd(depth)
    while (peek()?.kind === 'or') {
      next()
      node = { type: 'or', left: node, right: parseAnd(depth) }
    }
    return node
  }

  function parseAnd(depth: number): LogicNode {
    let node = parseNot(depth)
    while (peek()?.kind === 'and') {
      next()
      node = { type: 'and', left: node, right: parseNot(depth) }
    }
    return node
  }

  function parseNot(depth: number): LogicNode {
    if (peek()?.kind === 'not') {
      next()
      return { type: 'not', operand: parseNot(depth) }
    }
    return parsePrimary(depth)
  }

  function parsePrimary(depth: number): LogicNode {
    if (depth > limits.maxDepth) {
      throw queryError('QUERY_LOGIC_TOO_COMPLEX', `_logic nests deeper than ${limits.maxDepth} levels`)
    }
    const token = next()
    if (!token) throw queryError('QUERY_LOGIC_INVALID', '_logic ends where an alias was expected')

    if (token.kind === '(') {
      const node = parseOr(depth + 1)
      const closing = next()
      if (closing?.kind !== ')') throw queryError('QUERY_LOGIC_INVALID', '_logic has an unbalanced parenthesis')
      return node
    }
    if (token.kind === 'alias') return { type: 'alias', name: token.value }

    throw queryError('QUERY_LOGIC_INVALID', `_logic has '${token.value}' where an alias was expected`)
  }

  const tree = parseOr(1)
  if (position !== tokens.length) throw queryError('QUERY_LOGIC_INVALID', '_logic has trailing input')
  return tree
}

export function aliasesOf(node: LogicNode, into: Set<string> = new Set()): Set<string> {
  if (node.type === 'alias') into.add(node.name)
  else if (node.type === 'not') aliasesOf(node.operand, into)
  else {
    aliasesOf(node.left, into)
    aliasesOf(node.right, into)
  }
  return into
}
