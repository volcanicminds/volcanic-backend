/* eslint-disable @typescript-eslint/no-explicit-any */
const combineSqlAnd = (left, right) => {
  if (Array.isArray(left) || Array.isArray(right)) {
    throw new Error('Combining OR conditions with AND is not supported in this simplified SQL builder.')
  }
  return { ...left, ...right }
}

export const buildWhereFromAst = (ast: any, aliasMap: Map<string, any>, isMongo: boolean) => {
  if (!ast) {
    return {}
  }

  if (ast.type === 'operand') {
    if (!aliasMap.has(ast.value)) {
      throw new Error(`Alias "${ast.value}" used in _logic not found in query parameters.`)
    }
    return aliasMap.get(ast.value)
  }

  const left = buildWhereFromAst(ast.left, aliasMap, isMongo)
  const right = buildWhereFromAst(ast.right, aliasMap, isMongo)

  if (ast.type === 'AND') {
    if (isMongo) {
      return { $and: [left, right].flat() }
    }
    return combineSqlAnd(left, right)
  }

  if (ast.type === 'OR') {
    if (isMongo) {
      return { $or: [left, right].flat() }
    }
    return [left, right].flat()
  }

  return {}
}
