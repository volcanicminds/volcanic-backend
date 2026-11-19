import { and, or, not, asc, desc, isNull, is, sql, Param, SQL, getTableColumns, type Column, type Table } from 'drizzle-orm'
import { queryError } from './errors.js'
import { operatorFor, type Bound, type Operator } from './operators.js'
import { parseLogic, aliasesOf, DEFAULT_LOGIC_LIMITS, type LogicLimits, type LogicNode } from './logic.js'
import { envInt } from '../env.js'
import { prepared } from '../prepared.js'
import type { RuntimeHandle } from '../managers/runtime.js'

export * from './errors.js'
export { escapeLike, coerce, OPERATORS } from './operators.js'

//
// The Magic Query: from a query string to a query (docs/MAGIC_QUERY_V5.md).
//
// Two rules govern the whole file:
//
//   1. nothing is ever dropped in silence. Every branch that cannot honour what was asked
//      throws with a code;
//   2. validation happens before anything is built, in a fixed order: reserved parameters,
//      field, operator, value, then `_logic`. The first error wins, and it is the one
//      reported, so a caller fixes one thing at a time.
//
// A list query keeps its statement (lib/database/prepared.ts). Every request is validated in
// full; what is kept is only the SQL text of a SHAPE (fields, operators, `_logic`, sort,
// selected columns), with every value bound at execution. A query with `extraWhere` is never
// kept: its condition comes from the route, and the shape cannot tell one apart from another.
//
export const RESERVED = ['_page', '_pageSize', '_sort', '_fields', '_relations', '_logic', '_withDeleted'] as const

export const DEFAULT_SENSITIVE_FIELDS = [
  'password',
  'mfaSecret',
  'resetPasswordToken',
  'confirmationToken'
]

export interface QueryOptions {
  /** Never returned, and never filterable either: filtering a hash is an oracle. */
  sensitiveFields?: string[]
  maxPageSize?: number
  defaultPageSize?: number
  allowWithDeleted?: boolean
  allowedRelations?: string[]
  logicLimits?: LogicLimits
  /**
   * A condition the caller cannot relax: row-level security, a scope, a soft ownership rule.
   * It is AND-ed **after** everything the URL asked for, `_logic` included, so no expression
   * a client can write reaches around it.
   *
   * Without it a consumer filters in application code after the page has already been cut,
   * which returns short pages and a wrong total.
   */
  extraWhere?: SQL
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

type Condition = {
  alias: string
  explicitAlias: boolean
  field: string
  column: Column
  operator: Operator
  bound: Bound
  /** The index of its first value among all the values of the query: its placeholders are p<first+i>. */
  first: number
}

/** A query validated and coerced, with its SQL not written yet. */
interface QueryPlan {
  conditions: Condition[]
  tree: LogicNode | null
  sort: { column: Column; descending: boolean }[]
  deletedAt?: Column
  extraWhere?: SQL
  limit: number
  offset: number
  page: number
  pageSize: number
  fields: string[] | null
  relations: string[]
  withDeleted: boolean
  /** Everything the WHERE text depends on and no value; null when the statement must not be kept. */
  whereKey: string | null
  sortKey: string
  values: Record<string, unknown>
}

const sensitiveFieldsOf = (options: QueryOptions): Set<string> => new Set(options.sensitiveFields ?? DEFAULT_SENSITIVE_FIELDS)

/**
 * The columns a find selects: those `_fields` names, or every one but the sensitive. The select
 * is where a sensitive column stays behind, not the response schema: an internal caller, or a
 * consumer route without one, sends what the query returned.
 */
function projectionOf(table: Table, fields: string[] | null, options: QueryOptions): Record<string, Column> {
  const columns = getTableColumns(table) as unknown as Record<string, Column>
  const sensitive = sensitiveFieldsOf(options)
  const wanted = (name: string) => (fields ? fields.includes(name) : true) && !sensitive.has(name)
  return Object.fromEntries(Object.entries(columns).filter(([name]) => wanted(name)))
}

const ALIAS_SUFFIX = /\[([A-Za-z_][A-Za-z0-9_]{0,31})\]$/

function planQuery(table: Table, params: Record<string, unknown>, options: QueryOptions): QueryPlan {
  // Keyed by the TypeScript property name, which is the name a client sees in the response
  // and therefore the name it filters on: `createdAt`, not `created_at`.
  const columns = getTableColumns(table) as unknown as Record<string, Column>
  const sensitive = sensitiveFieldsOf(options)
  // The route's own option wins: the variable is the deployment's ceiling, not a way to raise a
  // limit a route deliberately lowered.
  const maxPageSize = options.maxPageSize ?? envInt('VOLCANIC_MAX_PAGE_SIZE', 100, { min: 1, max: 10_000 })
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

  const sort: QueryPlan['sort'] = []
  const sortNames: string[] = []
  for (const raw of String(params._sort ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const descending = raw.startsWith('-')
    const name = descending ? raw.slice(1) : raw
    sort.push({ column: column(name), descending })
    sortNames.push(descending ? `-${name}` : name)
  }

  // --- conditions ------------------------------------------------------------------
  const conditions: Condition[] = []
  const seen = new Set<string>()
  let valueCount = 0

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

    //
    // A repeated query-string key arrives as an ARRAY, because that is what a query parser
    // does with `?a=1&a=2`: it never arrives as two entries, since an object has one value
    // per key. Comparing keys therefore compares things that cannot collide, and an unrefused
    // repeated condition goes through as `String(['1','2'])`, the single value `'1,2'`.
    //
    // An array is unambiguous here: the list operators (`:in`, `:nin`) take a comma-separated
    // STRING, so nothing legitimate sends one.
    //
    if (Array.isArray(value)) {
      if (!explicitAlias) {
        throw queryError('QUERY_DUPLICATE_CONDITION', `'${bare}' appears more than once: give each one an [alias]`)
      }
      throw queryError(
        'QUERY_DUPLICATE_CONDITION',
        `'${bare}' appears more than once under the same alias '${alias}': give each one its own`
      )
    }

    const raw = value === undefined || value === null ? '' : String(value)
    if (raw === '') throw queryError('QUERY_EMPTY_VALUE', `'${fieldName}' has no value`)

    // Two DIFFERENT keys can still reduce to the same condition once an alias suffix is
    // stripped, which is the other way to write the same filter twice.
    if (seen.has(bare)) {
      throw queryError('QUERY_DUPLICATE_CONDITION', `'${bare}' appears more than once: give each one an [alias]`)
    }
    if (!explicitAlias) seen.add(bare)
    // One alias, one condition: `_logic` resolves an alias to a single one, so a second one
    // under the same name would be dropped from the query without a word.
    if (explicitAlias && conditions.some((c) => c.explicitAlias && c.alias === alias)) {
      throw queryError('QUERY_DUPLICATE_CONDITION', `the alias '${alias}' names more than one condition: give each one its own`)
    }

    const operator = operatorFor(operatorName)
    const target = column(fieldName)
    const bound = operator.bind({ column: target, raw })
    conditions.push({ alias, explicitAlias, field: fieldName, column: target, operator, bound, first: valueCount })
    valueCount += bound.values.length
  }

  // --- combination -----------------------------------------------------------------
  let tree: LogicNode | null = null
  if (params._logic) {
    tree = parseLogic(String(params._logic), limits)
    const used = aliasesOf(tree)
    const defined = new Set(conditions.map((c) => c.alias))

    // Order matters for the person reading the error: a condition without an alias is the
    // cause, an alias `_logic` cannot resolve is the symptom. Report the cause.
    for (const condition of conditions) {
      if (!condition.explicitAlias) {
        throw queryError('QUERY_LOGIC_MISSING_ALIAS', `with _logic every condition needs an [alias]: '${condition.alias}' has none`)
      }
    }
    for (const alias of used) {
      if (!defined.has(alias)) throw queryError('QUERY_LOGIC_UNKNOWN_ALIAS', `_logic names '${alias}', which no condition defines`)
    }
    for (const condition of conditions) {
      if (!used.has(condition.alias)) {
        throw queryError('QUERY_LOGIC_UNUSED_ALIAS', `'${condition.alias}' is defined but _logic never uses it`)
      }
    }
  }

  const values: Record<string, unknown> = {}
  // A value its column turns into SQL (a custom type can) is written into the text, not bound:
  // a statement kept for its shape would then carry one request's value into the next.
  let bindable = true
  for (const condition of conditions) {
    condition.bound.values.forEach((value, i) => {
      values[`p${condition.first + i}`] = value
      if (condition.bound.typed && is(condition.column.mapToDriverValue(value), SQL)) bindable = false
    })
  }

  const index = new Map(conditions.map((c, i) => [c.alias, i]))
  const whereKey =
    options.extraWhere || !bindable
      ? null
      : JSON.stringify([conditions.map((c) => [c.field, c.operator.name, c.bound.variant]), tree && shapeOf(tree, index), withDeleted])

  return {
    conditions,
    tree,
    sort,
    deletedAt: columns['deletedAt'],
    extraWhere: options.extraWhere,
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
    fields: fields.length ? fields : null,
    relations,
    withDeleted,
    whereKey,
    sortKey: sortNames.join(','),
    values
  }
}

/** The `_logic` tree with each alias replaced by the index of its condition. */
function shapeOf(node: LogicNode, index: Map<string, number>): string {
  if (node.type === 'alias') return String(index.get(node.name))
  if (node.type === 'not') return `not(${shapeOf(node.operand, index)})`
  return `${node.type}(${shapeOf(node.left, index)},${shapeOf(node.right, index)})`
}

/** The WHERE of a plan: with its values, or with placeholders for a statement that is kept. */
function whereOf(plan: QueryPlan, placeholders: boolean): SQL | undefined {
  const byAlias = new Map<string, SQL>()
  const all: SQL[] = []
  for (const c of plan.conditions) {
    const condition = c.operator.render(c.column, c.bound.variant, (i, column) =>
      new Param(placeholders ? sql.placeholder(`p${c.first + i}`) : c.bound.values[i], column).getSQL()
    )
    byAlias.set(c.alias, condition)
    all.push(condition)
  }

  let where: SQL | undefined
  if (plan.tree) where = build(plan.tree, byAlias)
  else if (all.length) where = and(...all) as SQL

  // Soft-deleted rows are invisible unless the route says otherwise.
  if (plan.deletedAt && !plan.withDeleted) {
    where = where ? (and(where, isNull(plan.deletedAt)) as SQL) : (isNull(plan.deletedAt) as SQL)
  }

  // Last, and deliberately: a restriction the route imposes is not a condition the URL can
  // argue with.
  if (plan.extraWhere) {
    where = where ? (and(where, plan.extraWhere) as SQL) : plan.extraWhere
  }
  return where
}

const orderOf = (plan: QueryPlan): SQL[] => plan.sort.map((s) => (s.descending ? desc(s.column) : asc(s.column)) as SQL)

function build(node: LogicNode, byAlias: Map<string, SQL>): SQL {
  if (node.type === 'alias') return byAlias.get(node.name)!
  if (node.type === 'not') return not(build(node.operand, byAlias)) as SQL
  const left = build(node.left, byAlias)
  const right = build(node.right, byAlias)
  return (node.type === 'and' ? and(left, right) : or(left, right)) as SQL
}

/** The query a query string asks for, checked and built with its values. */
export function parseQuery(table: Table, params: Record<string, unknown>, options: QueryOptions = {}): ParsedQuery {
  const plan = planQuery(table, params, options)
  return {
    where: whereOf(plan, false),
    orderBy: orderOf(plan),
    limit: plan.limit,
    offset: plan.offset,
    page: plan.page,
    pageSize: plan.pageSize,
    fields: plan.fields,
    relations: plan.relations,
    withDeleted: plan.withDeleted
  }
}

export interface FindResult<T> {
  records: T[]
  headers: Record<string, number>
}

/** The pagination headers: clients depend on them. */
export function headersFor(parsed: Pick<ParsedQuery, 'page' | 'pageSize'>, count: number, total: number): Record<string, number> {
  return {
    'v-count': count,
    'v-total': total,
    'v-page': parsed.page,
    'v-pageSize': parsed.pageSize,
    'v-pageCount': parsed.pageSize ? Math.ceil(total / parsed.pageSize) : 1
  }
}

/**
 * Runs the query. The handle decides the container; this function never chooses one, and there
 * is no global connection to fall back to.
 */
export async function executeFind<T>(
  handle: Pick<RuntimeHandle, 'db'>,
  table: Table,
  params: Record<string, unknown>,
  options: QueryOptions = {}
): Promise<FindResult<T>> {
  const plan = planQuery(table, params, options)
  const projection = projectionOf(table, plan.fields, options)

  const select = (placeholders: boolean) => {
    let query = handle.db.select(projection).from(table)
    const where = whereOf(plan, placeholders)
    if (where) query = query.where(where)
    const orderBy = orderOf(plan)
    if (orderBy.length) query = query.orderBy(...orderBy)
    return placeholders
      ? query.limit(sql.placeholder('limit')).offset(sql.placeholder('offset'))
      : query.limit(plan.limit).offset(plan.offset)
  }

  const records: unknown[] =
    plan.whereKey === null
      ? await select(false)
      : await prepared(handle.db, table, `find:${plan.whereKey}:${plan.sortKey}:${Object.keys(projection).join(',')}`, () =>
          select(true)
        ).execute({ ...plan.values, limit: plan.limit, offset: plan.offset })

  // A page shorter than the limit is the last one, so the rows before it and on it are all
  // there are. An empty page past the first proves nothing (the rows may all be before it),
  // so that one is counted.
  const lastPage = records.length < plan.limit && (records.length > 0 || plan.offset === 0)
  const total = lastPage ? plan.offset + records.length : await countPlan(handle, table, plan)
  return { records: records as T[], headers: headersFor(plan, records.length, total) }
}

export async function executeCount(
  handle: Pick<RuntimeHandle, 'db'>,
  table: Table,
  params: Record<string, unknown>,
  options: QueryOptions = {}
): Promise<number> {
  return countPlan(handle, table, planQuery(table, params, options))
}

async function countPlan(handle: Pick<RuntimeHandle, 'db'>, table: Table, plan: QueryPlan): Promise<number> {
  if (plan.whereKey === null) {
    // Built for this request only, so a plain statement: the same SQL, less work to build it.
    const where = whereOf(plan, false)
    const result = await handle.db.execute(sql`select count(*) as count from ${table}${where ? sql` where ${where}` : sql``}`)
    return Number(result.rows?.[0]?.count ?? 0)
  }
  const statement = prepared(handle.db, table, `count:${plan.whereKey}`, () => {
    let query = handle.db.select({ count: sql<number>`count(*)` }).from(table)
    const where = whereOf(plan, true)
    if (where) query = query.where(where)
    return query
  })
  const rows = (await statement.execute(plan.values)) as { count: unknown }[]
  return Number(rows[0]?.count ?? 0)
}
