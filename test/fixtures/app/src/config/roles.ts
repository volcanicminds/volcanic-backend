// Consumer-app CUSTOM roles merged on top of the lib defaults (public/admin). `editor`
// gates the widgets fixture; `ops` holds framework capabilities so the e2e suite can
// exercise capability-gated routes (/users, /token) without being admin.
export default [
  {
    code: 'editor',
    name: 'Editor',
    description: 'Custom role: can manage widgets'
  },
  {
    code: 'ops',
    name: 'Ops',
    description: 'Custom role: user/token management via capabilities',
    capabilities: ['users', 'tokens']
  }
]
