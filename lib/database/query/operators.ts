import { sql, eq, ne, gt, gte, lt, lte, inArray, notInArray, isNull, isNotNull, between, not, type SQL } from 'drizzle-orm'
import type { Column } from 'drizzle-orm'
import { queryError } from './errors.js'

//
// The operator catalogue (docs/MAGIC_QUERY_V5.md §4).
//
// Naming rule, without exceptions: the base form is case-SENSITIVE, the `i` suffix makes it
// insensitive, the `n` prefix negates it. In v4 the base form followed an environment
// variable, so the same URL returned different results on two servers of the same product —
// the worst incoherence of the old syntax, and the reason this one is a property of the
// operator, visible in the URL.
//
// Every operator declares the engines it exists on. One that does not exist answers 400 with
// its name and the engine, and is never emulated with a different semantics.
//
export type Dialect = 'postgres' | 'sqlite'

export interface OperatorContext {
  dialect: Dialect
  column: Column
  /** The raw string from the query string, already checked for emptiness. */
  raw: string
}

export interface Operator {
  name: string
  engines: Dialect[]
  build(ctx: OperatorContext): SQL
}

const LIKE_ESCAPE = /[\\%_]/g

/** Escapes the wildcards of a LIKE pattern. v4 did not, so `amount:contains=50%` was a wildcard. */
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
    // with no error — the class of silent wrongness this rewrite exists to remove.
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

// --- text matching, per dialect -------------------------------------------------------
const likeSensitive = (ctx: OperatorContext, pattern: string): SQL =>
  sql`${ctx.column} like ${pattern} escape '\\'`

const likeInsensitive = (ctx: OperatorContext, pattern: string): SQL =>
  ctx.dialect === 'postgres'
    ? sql`${ctx.column} ilike ${pattern} escape '\\'`
    : // SQLite has no ILIKE, and its LIKE is case-insensitive only for ASCII and only while
      // `case_sensitive_like` is off — which the adapter turns ON so the base operators mean
      // what they say. Folding both sides is explicit and independent of that pragma.
      sql`lower(${ctx.column}) like lower(${pattern}) escape '\\'`

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
    engines: ['postgres', 'sqlite'],
    build(ctx) {
      const pattern = patterns[kind](ctx.raw)
      const condition = insensitive ? likeInsensitive(ctx, pattern) : likeSensitive(ctx, pattern)
      return negated ? (not(condition) as SQL) : condition
    }
  }
}

// --- postgres-only array and json operators -------------------------------------------
const arrayOperator = (name: string, operator: string): Operator => ({
  name,
  engines: ['postgres'],
  build: (ctx) => sql`${ctx.column} ${sql.raw(operator)} ${ctx.raw.split(',')}::text[]`
})

const jsonKeyOperator = (name: string, operator: string, many: boolean): Operator => ({
  name,
  engines: ['postgres'],
  build: (ctx) =>
    many
      ? sql`${ctx.column} ${sql.raw(operator)} ${ctx.raw.split(',')}::text[]`
      : sql`${ctx.column} ${sql.raw(operator)} ${ctx.raw}`
})

const both: Dialect[] = ['postgres', 'sqlite']

export const OPERATORS: Record<string, Operator> = {
  // null and empty
  null: { name: 'null', engines: both, build: (ctx) => (boolValue(ctx) ? isNull(ctx.column) : isNotNull(ctx.column)) },
  empty: {
    name: 'empty',
    engines: both,
    build: (ctx) => (boolValue(ctx) ? eq(ctx.column, '' as never) : ne(ctx.column, '' as never))
  },

  // equality and set membership
  eq: { name: 'eq', engines: both, build: (ctx) => eq(ctx.column, coerce(ctx.column, ctx.raw) as never) },
  neq: { name: 'neq', engines: both, build: (ctx) => ne(ctx.column, coerce(ctx.column, ctx.raw) as never) },
  eqi: { name: 'eqi', engines: both, build: (ctx) => likeInsensitive(ctx, escapeLike(ctx.raw)) },
  neqi: { name: 'neqi', engines: both, build: (ctx) => not(likeInsensitive(ctx, escapeLike(ctx.raw))) as SQL },
  in: { name: 'in', engines: both, build: (ctx) => inArray(ctx.column, list(ctx) as never[]) },
  nin: { name: 'nin', engines: both, build: (ctx) => notInArray(ctx.column, list(ctx) as never[]) },

  // comparison
  gt: { name: 'gt', engines: both, build: (ctx) => gt(ctx.column, coerce(ctx.column, ctx.raw) as never) },
  ge: { name: 'ge', engines: both, build: (ctx) => gte(ctx.column, coerce(ctx.column, ctx.raw) as never) },
  lt: { name: 'lt', engines: both, build: (ctx) => lt(ctx.column, coerce(ctx.column, ctx.raw) as never) },
  le: { name: 'le', engines: both, build: (ctx) => lte(ctx.column, coerce(ctx.column, ctx.raw) as never) },
  between: { name: 'between', engines: both, build: (ctx) => range(ctx, false) },
  nbetween: { name: 'nbetween', engines: both, build: (ctx) => range(ctx, true) },

  // arrays and json, postgres only
  arrayContains: arrayOperator('arrayContains', '@>'),
  arrayContainedBy: arrayOperator('arrayContainedBy', '<@'),
  arrayOverlaps: arrayOperator('arrayOverlaps', '&&'),
  jsonHasKey: jsonKeyOperator('jsonHasKey', '?', false),
  jsonHasAllKeys: jsonKeyOperator('jsonHasAllKeys', '?&', true),
  jsonHasAnyKey: jsonKeyOperator('jsonHasAnyKey', '?|', true)
}

/** The range separator is `..`: with `:` an ISO timestamp split the condition apart, and v4 dropped it. */
function range(ctx: OperatorContext, negated: boolean): SQL {
  const parts = ctx.raw.split('..')
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw queryError('QUERY_INVALID_RANGE', `'${ctx.column.name}' takes a range written as from..to`)
  }
  const condition = between(ctx.column, coerce(ctx.column, parts[0]) as never, coerce(ctx.column, parts[1]) as never)
  return (negated ? not(condition) : condition) as SQL
}

// text operators, generated so the naming rule cannot drift from the catalogue
for (const kind of ['contains', 'starts', 'ends', 'like'] as PatternKind[]) {
  OPERATORS[kind] = textOperator(kind, kind, false, false)
  OPERATORS[`${kind}i`] = textOperator(`${kind}i`, kind, true, false)
  OPERATORS[`n${kind}`] = textOperator(`n${kind}`, kind, false, true)
  OPERATORS[`n${kind}i`] = textOperator(`n${kind}i`, kind, true, true)
}

export function operatorFor(name: string, dialect: Dialect): Operator {
  const operator = OPERATORS[name]
  if (!operator) {
    throw queryError('QUERY_UNKNOWN_OPERATOR', `'${name}' is not an operator (operator names are lowercase)`)
  }
  if (!operator.engines.includes(dialect)) {
    throw queryError(
      'QUERY_OPERATOR_NOT_SUPPORTED_BY_ENGINE',
      `'${name}' does not exist on ${dialect}: it is available on ${operator.engines.join(', ')}`
    )
  }
  return operator
}
