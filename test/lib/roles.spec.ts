/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from 'expect'
import { mergeRoles, PROTECTED_ROLE_CODES } from '../../lib/loader/roles.js'

// mergeRoles reads global `log` (optional-chained). Keep it silent.
;(global as any).log = {}

// Framework defaults as the loader adds them first (admin/public have no capabilities).
const builtins = () => ({
  public: { code: 'public', name: 'Public', description: 'Public role' },
  admin: { code: 'admin', name: 'Admin', description: 'Admin role' }
})

describe('loader/roles — mergeRoles (protected-merge)', () => {
  it('adds a new consumer role in full, capabilities included', () => {
    const roles = builtins()
    mergeRoles(roles as any, [
      { code: 'backoffice', name: 'Backoffice', description: 'Ops', capabilities: ['users', 'manifest'] }
    ])
    expect((roles as any).backoffice.capabilities).toEqual(['users', 'manifest'])
    expect((roles as any).backoffice.name).toBe('Backoffice')
  })

  it('lists admin and public as the protected built-ins', () => {
    expect(PROTECTED_ROLE_CODES).toEqual(['admin', 'public'])
  })

  it('overrides only label (name/description) on a protected role', () => {
    const roles = builtins()
    mergeRoles(roles as any, [{ code: 'admin', name: 'Administrator', description: 'Boss' } as any])
    expect(roles.admin.name).toBe('Administrator')
    expect(roles.admin.description).toBe('Boss')
    expect(roles.admin.code).toBe('admin')
  })

  it('ignores capabilities declared on a protected role (admin/public)', () => {
    const roles = builtins()
    mergeRoles(roles as any, [
      { code: 'admin', name: 'Admin', description: 'x', capabilities: ['users'] } as any,
      { code: 'public', name: 'Public', description: 'y', capabilities: ['toolsY'] } as any
    ])
    expect((roles.admin as any).capabilities).toBeUndefined()
    expect((roles.public as any).capabilities).toBeUndefined()
  })

  it('does a full override for a non-protected existing code', () => {
    const roles = builtins()
    mergeRoles(roles as any, [{ code: 'editor', name: 'Editor', description: 'v1', capabilities: ['a'] }])
    mergeRoles(roles as any, [{ code: 'editor', name: 'Editor 2', description: 'v2', capabilities: ['b'] }])
    expect((roles as any).editor.name).toBe('Editor 2')
    expect((roles as any).editor.capabilities).toEqual(['b'])
  })

  it('keeps built-ins while merging a consumer catalog (editor added)', () => {
    const roles = builtins()
    mergeRoles(roles as any, [{ code: 'editor', name: 'Editor', description: 'Custom' }])
    expect(Object.keys(roles).sort()).toEqual(['admin', 'editor', 'public'])
  })

  it('skips malformed entries without a code', () => {
    const roles = builtins()
    mergeRoles(roles as any, [{ name: 'no code' } as any])
    expect(Object.keys(roles).sort()).toEqual(['admin', 'public'])
  })
})
