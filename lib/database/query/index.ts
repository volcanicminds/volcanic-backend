import { and, or, not, asc, desc, isNull, sql, getTableColumns, type SQL, type Column, type Table } from 'drizzle-orm'
import { queryError } from './errors.js'
import { operatorFor, type Dialect } from './operators.js'
import { parseLogic, aliasesOf, DEFAULT_LOGIC_LIMITS, type LogicLimits, type LogicNode } from './logic.js'

export * from './errors.js'
export { escapeLike, coerce, OPERATORS } from './operators.js'
export type { Dialect } from './operators.js'

//
// The Magic Query: from a query string to a query (docs/MAGIC_QUERY_V5.md).
//
// Two rules govern the whole file, and they are the difference from v4:
//
//   1. nothing is ever dropped in silence. Every branch that cannot honour what was asked
//      throws with a code. v4 skipped an unknown sort field with a log line, degraded an
//      invalid `_logic` to an AND of everything, and turned an empty value into the literal
//      string `notFound` — three ways of answering a question nobody asked;
//   2. validation happens before anything is built, in a fixed order: reserved parameters,
//      field, operator, value, then `_logic`. The first error wins, and it is the one
//      reported, so a caller fixes one thing at a time.
//
export const RESERVED = ['_page', '_pageSize', '_sort', '_fields', '_relations', '_logic', '_withDeleted'] as const

export const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'mfaSecret',
  'mfaRecoveryCodes',
  'resetPasswordToken',
  'confirmationToken'
]

export interface QueryOptions {
  dialect: Dialect
  /** Never returned, and — new in v5 — never filterable either: filtering a hash is an oracle. */
  sensitiveFields?: string[]
  maxPageSize?: number
  defaultPageSize?: number
  allowWithDeleted?: boolean
  allowedRelations?: string[]
  logicLimits?: LogicLimits
}

export interface ParsedQuery {
  where?: SQL
  orderBy: SQL[]
  limit: number
  offset: number
  page: number
  pageSize: number
  fields: string[] | null
  relations: string[]
  withDeleted: boolean
}

type Condition = { alias: string; sql: SQL; explicitAlias: boolean }

const ALIAS_SUFFIX = /\[([A-Za-z_][A-Za-z0-9_]{0,31})\]$/

export function parseQuery(table: Table, params: Record<string, unknown>, options: QueryOptions): ParsedQuery {
  // Keyed by the TypeScript property name, which is the name a client sees in the response
  // and therefore the name it filters on: `createdAt`, not `created_at`.
  const columns = getTableColumns(table) as unknown as Record<string, Column>
  const sensitive = new Set(options.sensitiveFields ?? DEFAULT_SENSITIVE_FIELDS)
  const maxPageSize = options.maxPageSize ?? 100
  const limits = options.logicLimits ?? DEFAULT_LOGIC_LIMITS

  const column = (name: string): Column => {
    if (sensitive.has(name)) {
      throw queryError('QUERY_SENSITIVE_FIELD', `'${name}' cannot be used in a query`)
    }
    const found = columns[name]
    if (!found) throw queryError('QUERY_UNKNOWN_FIELD', `'${name}' is not a field of this resource`)
    return found
  }

  // --- reserved parameters ---------------------------------------------------------
  const page = Math.trunc(Number(params._page ?? 1))
  if (!Number.isFinite(page) || page < 1) throw queryError('QUERY_INVALID_PAGE', '_page starts at 1')

  const requested = Math.trunc(Number(params._pageSize ?? options.defaultPageSize ?? 25))
  if (!Number.isFinite(requested) || requested < 1) throw queryError('QUERY_INVALID_PAGE', '_pageSize must be positive')
  // Clamped rather than refused: it is a resource guard, and the applied value travels back
  // in the `v-pageSize` header so a client can see what happened.
  const pageSize = Math.min(requested, maxPageSize)

  const withDeleted = String(params._withDeleted ?? 'false').toLowerCase() === 'true'
  if (withDeleted && !options.allowWithDeleted) {
    throw queryError('QUERY_WITH_DELETED_NOT_ALLOWED', 'this route does not allow reading deleted rows')
  }

  const relations = String(params._relations ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean)
  for (const relation of relations) {
    if (!options.allowedRelations?.includes(relation)) {
      throw queryError('QUERY_RELATION_NOT_ALLOWED', `'${relation}' is not a relation this route joins`)
    }
  }

  const fields = String(params._fields ?? '')
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
  for (const field of fields) column(field)

  const orderBy: SQL[] = []
  for (const raw of String(params._sort ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const descending = raw.startsWith('-')
    const name = descending ? raw.slice(1) : raw
    orderBy.push((descending ? desc(column(name)) : asc(column(name))) as SQL)
  }

  // --- conditions ------------------------------------------------------------------
  const conditions: Condition[] = []
  const seen = new Set<string>()

  for (const [key, value] of Object.entries(params)) {
    if ((RESERVED as readonly string[]).includes(key)) continue

    const aliasMatch = key.match(ALIAS_SUFFIX)
    const explicitAlias = !!aliasMatch
    const bare = explicitAlias ? key.replace(ALIAS_SUFFIX, '') : key
    const [fieldName, operatorName = 'eq'] = bare.split(':')
    const alias = aliasMatch ? aliasMatch[1] : bare

    if (fieldName.includes('.')) {
      const [relation] = fieldName.split('.')
      throw queryError('QUERY_RELATION_NOT_ALLOWED', `filtering through '${relation}' requires the route to join it`)
    }

    const raw = value === undefined || value === null ? '' : String(value)
    if (raw === '') throw queryError('QUERY_EMPTY_VALUE', `'${fieldName}' has no value`)

    if (!explicitAlias) {
      if (seen.has(bare)) {
        throw queryError('QUERY_DUPLICATE_CONDITION', `'${bare}' appears twice: give each one an [alias]`)
      }
      seen.add(bare)
    }

    const operator = operatorFor(operatorName, options.dialect)
    conditions.push({
      alias,
      explicitAlias,
      sql: operator.build({ dialect: options.dialect, column: column(fieldName), raw })
    })
  }

  // --- combination -----------------------------------------------------------------
  const byAlias = new Map(conditions.map((c) => [c.alias, c.sql]))
  let where: SQL | undefined

  if (params._logic) {
    const tree = parseLogic(String(params._logic), limits)
    const used = aliasesOf(tree)

    // Order matters for the person reading the error: a condition without an alias is the
    // cause, an alias `_logic` cannot resolve is the symptom. Report the cause.
    for (const condition of conditions) {
      if (!condition.explicitAlias) {
        throw queryError('QUERY_LOGIC_MISSING_ALIAS', `with _logic every condition needs an [alias]: '${condition.alias}' has none`)
      }
    }
    for (const alias of used) {
      if (!byAlias.has(alias)) throw queryError('QUERY_LOGIC_UNKNOWN_ALIAS', `_logic names '${alias}', which no condition defines`)
    }
    for (const condition of conditions) {
      if (!used.has(condition.alias)) {
        throw queryError('QUERY_LOGIC_UNUSED_ALIAS', `'${condition.alias}' is defined but _logic never uses it`)
      }
    }
    where = build(tree, byAlias)
  } else if (conditions.length) {
    where = and(...conditions.map((c) => c.sql)) as SQL
  }

  // Soft-deleted rows are invisible unless the route says otherwise.
  const deletedAt = columns['deletedAt']
  if (deletedAt && !withDeleted) {
    where = where ? (and(where, isNull(deletedAt)) as SQL) : (isNull(deletedAt) as SQL)
  }

  return {
    where,
    orderBy,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
    fields: fields.length ? fields : null,
    relations,
    withDeleted
  }
}

function build(node: LogicNode, byAlias: Map<string, SQL>): SQL {
  if (node.type === 'alias') return byAlias.get(node.name)!
  if (node.type === 'not') return not(build(node.operand, byAlias)) as SQL
  const left = build(node.left, byAlias)
  const right = build(node.right, byAlias)
  return (node.type === 'and' ? and(left, right) : or(left, right)) as SQL
}

export interface FindResult<T> {
  records: T[]
  headers: Record<string, number>
}

/** The pagination headers v4 already returned, kept as they were: clients depend on them. */
export function headersFor(parsed: ParsedQuery, count: number, total: number): Record<string, number> {
  return {
    'v-count': count,
    'v-total': total,
    'v-page': parsed.page,
    'v-pageSize': parsed.pageSize,
    'v-pageCount': parsed.pageSize ? Math.ceil(total / parsed.pageSize) : 1
  }
}

/**
 * Runs the query. The handle decides the container; this function never chooses one, which is
 * why there is no way for it to fall back to a global connection the way v4's view queries did
 * (D-06) — there is no global connection to fall back to.
 */
export async function executeFind<T>(
  handle: { db: any },
  table: Table,
  params: Record<string, unknown>,
  options: QueryOptions
): Promise<FindResult<T>> {
  const parsed = parseQuery(table, params, options)

  let query = handle.db.select().from(table)
  if (parsed.where) query = query.where(parsed.where)
  if (parsed.orderBy.length) query = query.orderBy(...parsed.orderBy)
  const records = await query.limit(parsed.limit).offset(parsed.offset)

  const total = await executeCount(handle, table, params, options)
  return { records: records as T[], headers: headersFor(parsed, records.length, total) }
}

export async function executeCount(
  handle: { db: any },
  table: Table,
  params: Record<string, unknown>,
  options: QueryOptions
): Promise<number> {
  const parsed = parseQuery(table, params, options)

  let query = handle.db.select({ count: sql<number>`count(*)` }).from(table)
  if (parsed.where) query = query.where(parsed.where)
  const rows = await query
  return Number(rows[0]?.count ?? 0)
}
