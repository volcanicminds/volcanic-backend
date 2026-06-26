/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { useOrder, useWhere, configureSensitiveFields } from '../../../lib/database/typeorm/query.js'
import { parseLogicExpression } from '../../../lib/database/typeorm/query/parser.js'

const DEFAULT_SENSITIVE = ['password', 'mfaSecret', 'resetPasswordToken', 'confirmationToken']

describe('Magic Query', () => {
  describe('useOrder', () => {
    it('parses field:direction pairs', () => {
      expect(useOrder(['name:asc', 'age:desc'])).toEqual({ name: 'asc', age: 'desc' })
    })

    it('skips fields with invalid identifiers (injection guard)', () => {
      expect(useOrder(['name; DROP TABLE users:asc'])).toEqual({})
    })

    it('does not pollute Object.prototype', () => {
      useOrder(['__proto__.polluted:asc'])
      expect(({} as any).polluted).toBeUndefined()
    })
  })

  describe('useWhere', () => {
    it('builds an equality condition by default', () => {
      const { allConditions } = useWhere({ name: 'foo' })
      expect(allConditions.name).toBeDefined()
    })

    it('never exposes sensitive fields', () => {
      const { allConditions } = useWhere({ password: 'x', mfaSecret: 'y', resetPasswordToken: 'z' })
      expect(allConditions.password).toBeUndefined()
      expect(allConditions.mfaSecret).toBeUndefined()
      expect(allConditions.resetPasswordToken).toBeUndefined()
    })

    it('skips invalid identifiers (injection guard)', () => {
      const { allConditions } = useWhere({ 'name; DROP TABLE': 'x' })
      expect(Object.keys(allConditions)).toHaveLength(0)
    })

    it('does not pollute Object.prototype', () => {
      useWhere({ __proto__: 'x', constructor: 'y' })
      expect(({} as any).polluted).toBeUndefined()
    })

    it('maps comparison operators to TypeORM FindOperators', () => {
      const gt: any = useWhere({ 'age:gt': 5 }).allConditions
      expect(gt.age?.constructor?.name).toBe('FindOperator')
      expect(gt.age?.type).toBe('moreThan')
      expect(gt.age?.value).toBe(5)

      const inOp: any = useWhere({ 'status:in': 'a,b,c' }).allConditions
      expect(inOp.status?.type).toBe('in')
    })

    it('builds nested conditions for dotted paths', () => {
      const { allConditions }: any = useWhere({ 'profile.age:gt': 5 })
      expect(allConditions.profile?.age).toBeDefined()
      expect(allConditions.profile.age?.type).toBe('moreThan')
    })

    it('respects a custom sensitive-field configuration', () => {
      try {
        configureSensitiveFields(['topsecret'])
        const { allConditions }: any = useWhere({ topsecret: 'x', name: 'y' })
        expect(allConditions.topsecret).toBeUndefined()
        expect(allConditions.name).toBeDefined()
        // the default sensitive fields are no longer enforced after override
        expect((useWhere({ password: 'p' }).allConditions as any).password).toBeDefined()
      } finally {
        configureSensitiveFields(DEFAULT_SENSITIVE) // restore for other tests
      }
    })

    it('ignores a non-array sensitive-field override', () => {
      configureSensitiveFields(undefined as any)
      expect((useWhere({ password: 'p' }).allConditions as any).password).toBeUndefined()
    })
  })

  describe('parseLogicExpression', () => {
    it('parses a single operand', () => {
      expect(parseLogicExpression('a')).toMatchObject({ type: 'operand', value: 'a' })
    })

    it('parses a simple AND tree', () => {
      const ast: any = parseLogicExpression('a AND b')
      expect(ast.type).toBe('AND')
      expect(ast.left).toMatchObject({ type: 'operand', value: 'a' })
      expect(ast.right).toMatchObject({ type: 'operand', value: 'b' })
    })

    it('parses an OR tree', () => {
      expect((parseLogicExpression('a OR b') as any).type).toBe('OR')
    })

    it('chains same-level operators left-associatively', () => {
      const ast: any = parseLogicExpression('a AND b AND c')
      expect(ast.type).toBe('AND')
      expect(ast.left.type).toBe('AND') // (a AND b) AND c
      expect(ast.right).toMatchObject({ type: 'operand', value: 'c' })
    })

    it('respects parentheses precedence', () => {
      const ast: any = parseLogicExpression('a AND (b OR c)')
      expect(ast.type).toBe('AND')
      expect(ast.right.type).toBe('OR')
    })

    it('parses parentheses on both sides', () => {
      const ast: any = parseLogicExpression('(a OR b) AND (c OR d)')
      expect(ast.type).toBe('AND')
      expect(ast.left.type).toBe('OR')
      expect(ast.right.type).toBe('OR')
    })

    it('throws on mismatched parentheses', () => {
      expect(() => parseLogicExpression('(a AND b')).toThrow()
    })
  })
})
