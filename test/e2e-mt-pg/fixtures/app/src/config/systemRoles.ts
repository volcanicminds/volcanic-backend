// The project's own part of the control catalogue, as a project or a package declares it: one
// capability, a role that holds it, and a role that names a capability nobody declared, which
// the boot drops. `/probe/platform` asks for the declared one. The steward holds a built-in
// capability, `system-users`, as a project may grant it to an operator who is not the superuser.
export const capabilities = ['probe:platform']

export default [
  { code: 'system:prober', name: 'Prober', description: 'Reads the platform probe', capabilities: ['probe:platform'] },
  { code: 'system:misnamed', name: 'Misnamed', description: 'Names a capability nobody declared', capabilities: ['probe:undeclared'] },
  { code: 'system:steward', name: 'Steward', description: 'Manages the other operators', capabilities: ['system-users'] }
]
