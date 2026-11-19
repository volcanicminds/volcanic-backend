import { sql, eq, ne, gt, gte, lt, lte, inArray, notInArray, isNull, isNotNull, between, not, type SQL } from 'drizzle-orm'
import type { Column } from 'drizzle-orm'
import { queryError } from './errors.js'

//
// The operator catalogue (docs/MAGIC_QUERY_V5.md §4).
//
// Naming rule, without exceptions: the base form is case-SENSITIVE, the `i` suffix makes it
// insensitive, the `n` prefix negates it. Case is a property of the operator, visible in the
// URL, and never of an environment variable: the same URL returns the same results on every
// server.
//
// Each operator works in two steps, so that a list query can keep its statement (index.ts):
// `bind` validates and coerces the raw value, and raises every error a condition can raise;
// `render` writes the SQL from the bound shape alone, with `arg(i)` standing for the i-th value.
// Whatever `render` writes differently must show in the `variant`, because two conditions with
// the same operator and variant share a statement.
//
export interface OperatorContext {
  column: Column
  /** The raw string from the query string, already checked for emptiness. */
  raw: string
}

export interface Bound {
  variant: string
  values: unknown[]
  /** True when `render` binds the values with the column's encoder, `arg(i, column)`. */
  typed: boolean
}

/** The i-th bound value, typed by `column` when given (the column's encoder runs on it). */
export type Arg = (index: number, column?: Column) => SQL

export interface Operator {
  name: string
  bind(ctx: OperatorContext): Bound
  render(column: Column, variant: string, arg: Arg): SQL
}

const LIKE_ESCAPE = /[\\%_]/g

/** Escapes the wildcards of a LIKE pattern, so the `%` of `amount:contains=50%` is not a wildcard. */
export const escapeLike = (value: string) => value.replace(LIKE_ESCAPE, (c) => `\\${c}`)

/** Coercion is driven by the COLUMN, not by the shape of the string (docs/MAGIC_QUERY_V5.md §6). */
export function coerce(column: Column, raw: string): unknown {
  const type = column.dataType

  if (type === 'boolean') {
    const lower = raw.toLowerCase()
    if (lower === 'true') return true
    if (lower === 'false') return false
    throw queryError('QUERY_INVALID_VALUE', `'${column.name}' is a boolean: use true or false`)
  }

  if (type === 'number') {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw queryError('QUERY_INVALID_VALUE', `'${column.name}' is a number`)
    return n
  }

  if (type === 'date') {
    // All digits means epoch MILLISECONDS. Left to `new Date(string)`, '1500' would be the
    // year 1500 and a client sending a timestamp would get eight centuries of nonsense back
    // with no error.
    const at = /^\d+$/.test(raw) ? new Date(Number(raw)) : new Date(raw)
    if (Number.isNaN(at.getTime())) throw queryError('QUERY_INVALID_VALUE', `'${column.name}' is a date`)
    return at
  }

  // Text and json keep the string as written: `code:eq=0042` must not lose its leading zeros,
  // and on a text column the word `null` is the word, not SQL NULL. `:null=true` is how one
  // asks for NULL, which is unambiguous and works on every column type.
  return raw
}

const list = (ctx: OperatorContext): unknown[] => {
  const parts = ctx.raw.split(',')
  if (parts.some((p) => p.length === 0)) {
    throw queryError('QUERY_EMPTY_VALUE', `a list value of '${ctx.column.name}' is empty`)
  }
  return parts.map((p) => coerce(ctx.column, p))
}

const boolValue = (ctx: OperatorContext): boolean => {
  const lower = ctx.raw.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  throw queryError('QUERY_INVALID_VALUE', `'${ctx.column.name}' with this operator takes true or false`)
}

const one = (value: unknown): Bound => ({ variant: '', values: [value], typed: false })
const flag = (ctx: OperatorContext): Bound => ({ variant: String(boolValue(ctx)), values: [], typed: false })
const indices = (count: number) => Array.from({ length: count }, (_, i) => i)

// --- text matching --------------------------------------------------------------------
const likeSensitive = (column: Column, pattern: SQL): SQL => sql`${column} like ${pattern} escape '\\'`
const likeInsensitive = (column: Column, pattern: SQL): SQL => sql`${column} ilike ${pattern} escape '\\'`

const patterns = {
  contains: (v: string) => `%${escapeLike(v)}%`,
  starts: (v: string) => `${escapeLike(v)}%`,
  ends: (v: string) => `%${escapeLike(v)}`,
  like: (v: string) => v // the caller's wildcards are the intent: not escaped
}

type PatternKind = keyof typeof patterns

function textOperator(name: string, kind: PatternKind, insensitive: boolean, negated: boolean): Operator {
  return {
    name,
    bind: (ctx) => one(patterns[kind](ctx.raw)),
    render(column, _variant, arg) {
      const condition = insensitive ? likeInsensitive(column, arg(0)) : likeSensitive(column, arg(0))
      return negated ? (not(condition) as SQL) : condition
    }
  }
}

// --- array and json operators ---------------------------------------------------------
// A JS array interpolated into `sql` becomes a list, `($1, $2)`, which no cast turns into an
// array: the values go as ONE parameter, which the driver sends as an array literal.
const arrayOperator = (name: string, operator: string): Operator => ({
  name,
  bind: (ctx) => one(ctx.raw.split(',')),
  render: (column, _variant, arg) => sql`${column} ${sql.raw(operator)} ${arg(0)}::text[]`
})

const jsonKeyOperator = (name: string, operator: string, many: boolean): Operator => ({
  name,
  bind: (ctx) => one(many ? ctx.raw.split(',') : ctx.raw),
  render: (column, _variant, arg) =>
    many ? sql`${column} ${sql.raw(operator)} ${arg(0)}::text[]` : sql`${column} ${sql.raw(operator)} ${arg(0)}`
})

const comparison = (name: string, compare: (column: Column, value: SQL) => SQL): Operator => ({
  name,
  bind: (ctx) => ({ variant: '', values: [coerce(ctx.column, ctx.raw)], typed: true }),
  render: (column, _variant, arg) => compare(column, arg(0, column))
})

/** A list: its length is the variant, since `in ($1, $2)` and `in ($1, $2, $3)` are two statements. */
const membership = (name: string, negated: boolean): Operator => ({
  name,
  bind: (ctx) => {
    const values = list(ctx)
    return { variant: String(values.length), values, typed: true }
  },
  render: (column, variant, arg) => {
    const args = indices(Number(variant)).map((i) => arg(i, column))
    return (negated ? notInArray(column, args) : inArray(column, args)) as SQL
  }
})

/** The range separator is `..`: with `:` an ISO timestamp would split the condition apart. */
const range = (name: string, negated: boolean): Operator => ({
  name,
  bind: (ctx) => {
    const parts = ctx.raw.split('..')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw queryError('QUERY_INVALID_RANGE', `'${ctx.column.name}' takes a range written as from..to`)
    }
    return { variant: '', values: [coerce(ctx.column, parts[0]), coerce(ctx.column, parts[1])], typed: true }
  },
  render: (column, _variant, arg) => {
    const condition = between(column, arg(0, column), arg(1, column))
    return (negated ? not(condition) : condition) as SQL
  }
})

export const OPERATORS: Record<string, Operator> = {
  // null and empty
  null: { name: 'null', bind: flag, render: (column, variant) => (variant === 'true' ? isNull(column) : isNotNull(column)) },
  empty: {
    name: 'empty',
    bind: flag,
    render: (column, variant) => (variant === 'true' ? eq(column, '' as never) : ne(column, '' as never))
  },

  // equality and set membership
  eq: comparison('eq', (column, value) => eq(column, value)),
  neq: comparison('neq', (column, value) => ne(column, value)),
  eqi: { name: 'eqi', bind: (ctx) => one(escapeLike(ctx.raw)), render: (column, _variant, arg) => likeInsensitive(column, arg(0)) },
  neqi: {
    name: 'neqi',
    bind: (ctx) => one(escapeLike(ctx.raw)),
    render: (column, _variant, arg) => not(likeInsensitive(column, arg(0))) as SQL
  },
  in: membership('in', false),
  nin: membership('nin', true),

  // comparison
  gt: comparison('gt', (column, value) => gt(column, value)),
  ge: comparison('ge', (column, value) => gte(column, value)),
  lt: comparison('lt', (column, value) => lt(column, value)),
  le: comparison('le', (column, value) => lte(column, value)),
  between: range('between', false),
  nbetween: range('nbetween', true),

  // arrays and json
  arrayContains: arrayOperator('arrayContains', '@>'),
  arrayContainedBy: arrayOperator('arrayContainedBy', '<@'),
  arrayOverlaps: arrayOperator('arrayOverlaps', '&&'),
  jsonHasKey: jsonKeyOperator('jsonHasKey', '?', false),
  jsonHasAllKeys: jsonKeyOperator('jsonHasAllKeys', '?&', true),
  jsonHasAnyKey: jsonKeyOperator('jsonHasAnyKey', '?|', true)
}

// text operators, generated so the naming rule cannot drift from the catalogue
for (const kind of ['contains', 'starts', 'ends', 'like'] as PatternKind[]) {
  OPERATORS[kind] = textOperator(kind, kind, false, false)
  OPERATORS[`${kind}i`] = textOperator(`${kind}i`, kind, true, false)
  OPERATORS[`n${kind}`] = textOperator(`n${kind}`, kind, false, true)
  OPERATORS[`n${kind}i`] = textOperator(`n${kind}i`, kind, true, true)
}

export function operatorFor(name: string): Operator {
  const operator = OPERATORS[name]
  if (!operator) {
    // Names are matched exactly, case included, and the catalogue is not all lowercase
    // (`arrayContains`, `jsonHasKey`): the rule is exactness, and the helpful answer to a
    // wrongly cased name is the name it was meant to be.
    const meant = Object.keys(OPERATORS).find((known) => known.toLowerCase() === name.toLowerCase())
    throw queryError(
      'QUERY_UNKNOWN_OPERATOR',
      meant
        ? `'${name}' is not an operator: names are matched exactly, did you mean '${meant}'?`
        : `'${name}' is not an operator (names are matched exactly, case included)`
    )
  }
  return operator
}
