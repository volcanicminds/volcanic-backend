import { expect } from 'expect'
import { sanitizeSchemaName } from '../../lib/api/tenants/controller/tenants.js'

// S12 — schema name hardening for `SET search_path` (cannot be parameterized).
export default () => {
  describe('Tenant schema sanitization (S12)', () => {
    it('keeps valid identifier names unchanged', () => {
      for (const ok of ['public', 'tenant_42', 'AcmeCorp', 'a_b_c_123']) {
        expect(sanitizeSchemaName(ok)).toBe(ok)
      }
    })

    it('strips any character outside [a-z0-9_]', () => {
      // A SQL-injection payload collapses to a harmless (and here, empty) token.
      expect(sanitizeSchemaName('public"; DROP SCHEMA public; --')).toBe('publicDROPSCHEMApublic')
      expect(sanitizeSchemaName('a-b.c')).toBe('abc')
      expect(sanitizeSchemaName('"; --')).toBe('')
    })

    it('handles nullish/empty input without throwing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeSchemaName(undefined as any)).toBe('')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect(sanitizeSchemaName(null as any)).toBe('')
      expect(sanitizeSchemaName('')).toBe('')
    })
  })
}
