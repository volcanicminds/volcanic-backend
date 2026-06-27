// Consumer-app CUSTOM roles. The framework's roles loader merges these on top of
// the lib defaults (public/admin/backoffice), so `editor` becomes available to
// route definitions and to req.hasRole().
export default [
  {
    code: 'editor',
    name: 'Editor',
    description: 'Custom role: can manage widgets'
  }
]
