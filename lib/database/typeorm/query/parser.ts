export const parseLogicExpression = (logic: string) => {
  const tokens = logic.match(/\(|\)|[A-Za-z0-9_:]+|\s*(AND|OR)\s*/g)?.filter((t) => t.trim()) || []
  let pos = 0

  const parseExpression = () => {
    let left = parseTerm()
    while (pos < tokens.length && (tokens[pos].trim() === 'OR' || tokens[pos].trim() === 'AND')) {
      const operator = tokens[pos++].trim()
      const right = parseTerm()
      left = { type: operator, left, right }
    }
    return left
  }

  const parseTerm = () => {
    if (tokens[pos] === '(') {
      pos++
      const node = parseExpression()
      if (tokens[pos] !== ')') {
        throw new Error('Mismatched parentheses in _logic expression')
      }
      pos++
      return node
    }
    return { type: 'operand', value: tokens[pos++] }
  }

  return parseExpression()
}
