/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Magic Query operator catalog.
//
// Builds the map of `:operator -> FindOperator factory` used by `useWhere`.
// Extracted from query.ts to keep that file focused on the query-assembly logic.
//
// Naming convention (case sensitivity):
//   base   -> case-INsensitive by default (e.g. `eq`, `contains`)
//   `*s`   -> strict / case-Sensitive
//   `*i`   -> case-Insensitive (explicit alias)
// `eq`/`neq` stay type-aware: numbers/booleans/null match exactly (no ILIKE on
// non-text columns); only genuine strings become case-insensitive.
//
// Operator NAMES are matched case-insensitively by the caller, so `:isEmpty`,
// `:isempty` and `:ISEMPTY` are equivalent.
//
import {
  Not,
  Like,
  ILike,
  Raw,
  Equal,
  IsNull,
  In,
  Between,
  MoreThan,
  MoreThanOrEqual,
  LessThan,
  LessThanOrEqual
} from 'typeorm'

export const escapeRegExp = (str: string) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Coerces the textual query value: 'true'/'false'/'null' -> boolean/null,
// everything else stays a string (Postgres casts numeric strings on its own).
export const typecastValue = (value: any) => {
  if (typeof value !== 'string') return value
  const lowerValue = value.toLowerCase()
  if (lowerValue === 'true') return true
  if (lowerValue === 'false') return false
  if (lowerValue === 'null') return null
  return value
}

const isNumericString = (v: any) => typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v)
const val = (v: any) => v || 'notFound'

export interface OperatorContext {
  isTargetMongo: boolean
  caseInsensitive: boolean
  allowRaw?: boolean
}

export type OperatorMap = Record<string, (v: any) => any>

/**
 * Builds the operator catalog for the given context. Keys are ordered
 * longest/most-specific first so the alternation regex in `useWhere` resolves
 * correctly even with the `\b` boundary.
 */
export function buildReservedOperators(ctx: OperatorContext): OperatorMap {
  const { isTargetMongo, caseInsensitive: ci, allowRaw } = ctx

  // case-insensitive equality, numeric/boolean/null-safe
  const eqInsensitive = (v: any) => {
    const t = typecastValue(v)
    if (t === null) return IsNull()
    if (typeof t === 'boolean') return isTargetMongo ? t : Equal(t)
    if (isNumericString(t)) return isTargetMongo ? t : Equal(t)
    return isTargetMongo ? new RegExp(`^${escapeRegExp(t)}$`, 'i') : ILike(t)
  }
  const eqSensitive = (v: any) => {
    const t = typecastValue(v)
    if (t === null) return IsNull()
    return isTargetMongo ? t : Equal(t)
  }

  const containsS = (v: any) => (isTargetMongo ? new RegExp(escapeRegExp(val(v))) : Like(`%${val(v)}%`))
  const containsI = (v: any) => (isTargetMongo ? new RegExp(escapeRegExp(val(v)), 'i') : ILike(`%${val(v)}%`))
  const startsS = (v: any) => (isTargetMongo ? new RegExp(`^${escapeRegExp(val(v))}`) : Like(`${val(v)}%`))
  const startsI = (v: any) => (isTargetMongo ? new RegExp(`^${escapeRegExp(val(v))}`, 'i') : ILike(`${val(v)}%`))
  const endsS = (v: any) => (isTargetMongo ? new RegExp(`${escapeRegExp(val(v))}$`) : Like(`%${val(v)}`))
  const endsI = (v: any) => (isTargetMongo ? new RegExp(`${escapeRegExp(val(v))}$`, 'i') : ILike(`%${val(v)}`))
  const likeS = (v: any) => (isTargetMongo ? new RegExp(escapeRegExp(val(v))) : Like(`${val(v)}`))
  const likeI = (v: any) => (isTargetMongo ? new RegExp(escapeRegExp(val(v)), 'i') : ILike(`${val(v)}`))
  const not = (fn: (v: any) => any) => (v: any) => Not(fn(v))

  const arrayOp = (sqlOp: string, paramName: string) => (v: any) => {
    const values = val(v).split(',').map(typecastValue)
    if (isTargetMongo) return { $in: values }
    return Raw((alias) => `${alias} ${sqlOp} ARRAY[:...${paramName}]::text[]`, { [paramName]: values })
  }

  // JSONB key-existence operators (Postgres only; degrade to $in on Mongo).
  const jsonHasKey = (v: any) => {
    if (isTargetMongo) return { $exists: true }
    return Raw((alias) => `${alias} ? :jsonHasKeyValue`, { jsonHasKeyValue: val(v) })
  }
  const jsonHasArray = (sqlOp: string, paramName: string) => (v: any) => {
    const values = val(v).split(',')
    if (isTargetMongo) return { $in: values }
    return Raw((alias) => `${alias} ${sqlOp} ARRAY[:...${paramName}]`, { [paramName]: values })
  }

  const ops: OperatorMap = {
    // --- null / empty ---
    ':notNull': (v) => (typecastValue(v) === true ? Not(IsNull()) : IsNull()),
    ':null': (v) => (typecastValue(v) === false ? Not(IsNull()) : IsNull()),
    ':isNotEmpty': () => (isTargetMongo ? { $ne: '' } : Not(Equal(''))),
    ':isEmpty': () => (isTargetMongo ? '' : Equal('')),

    // --- set membership (exact) ---
    ':nin': (v) => Not(In(val(v).split(',').map(typecastValue))),
    ':in': (v) => In(val(v).split(',').map(typecastValue)),

    // --- equality (base follows caseInsensitive; *s strict, *i insensitive) ---
    ':eqs': eqSensitive,
    ':eqi': eqInsensitive,
    ':eq': ci ? eqInsensitive : eqSensitive,
    ':neqs': not(eqSensitive),
    ':neqi': not(eqInsensitive),
    ':neq': ci ? not(eqInsensitive) : not(eqSensitive),

    // --- contains ---
    ':ncontainss': not(containsS),
    ':ncontainsi': not(containsI),
    ':ncontains': ci ? not(containsI) : not(containsS),
    ':containss': containsS,
    ':containsi': containsI,
    ':contains': ci ? containsI : containsS,

    // --- starts ---
    ':nstartss': not(startsS),
    ':nstartsi': not(startsI),
    ':nstarts': ci ? not(startsI) : not(startsS),
    ':startss': startsS,
    ':startsi': startsI,
    ':starts': ci ? startsI : startsS,

    // --- ends ---
    ':nendss': not(endsS),
    ':nendsi': not(endsI),
    ':nends': ci ? not(endsI) : not(endsS),
    ':endss': endsS,
    ':endsi': endsI,
    ':ends': ci ? endsI : endsS,

    // --- like ---
    ':nlikes': not(likeS),
    ':nlikei': not(likeI),
    ':nlike': ci ? not(likeI) : not(likeS),
    ':likes': likeS,
    ':likei': likeI,
    ':like': ci ? likeI : likeS,

    // --- comparison (numbers AND dates) ---
    ':gt': (v) => MoreThan(v),
    ':ge': (v) => MoreThanOrEqual(v),
    ':lt': (v) => LessThan(v),
    ':le': (v) => LessThanOrEqual(v),
    ':nbetween': (v) => {
      const s = v?.split(':')
      return s?.length == 2 ? Not(Between(s[0], s[1])) : v
    },
    ':between': (v) => {
      const s = v?.split(':')
      return s?.length == 2 ? Between(s[0], s[1]) : v
    },

    // --- array (Postgres) ---
    ':arrayContainedBy': arrayOp('<@', 'arrayContainedByValues'),
    ':arrayContains': arrayOp('@>', 'arrayContainsValues'),
    ':overlap': arrayOp('&&', 'overlapValues'),

    // --- jsonb key existence (Postgres) ---
    ':jsonHasAllKeys': jsonHasArray('?&', 'jsonHasAllKeysValues'),
    ':jsonHasAnyKey': jsonHasArray('?|', 'jsonHasAnyKeyValues'),
    ':jsonHasKey': jsonHasKey
  }

  if (allowRaw) {
    ops[':raw'] = (v) => Raw((alias) => `${alias} ${v}`)
  }

  return ops
}
