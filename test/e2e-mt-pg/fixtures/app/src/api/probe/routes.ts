// Probe fixture for the isolation bench (T-0.2 of EVO_FRAMEWORK.md).
//
// Two routes that read the SAME unqualified table name, one in each scope. The
// table exists in the control plane and inside every tenant container with a
// different marker row, so a single HTTP response says which container the
// connection was actually pointed at. That is how the leak of D-01 becomes
// observable from outside the process, without importing anything of the data
// layer into the test.
export default {
  config: {
    title: 'Probe',
    description: 'Isolation probe: reads an unqualified table in either scope',
    controller: 'controller',
    tags: ['probe']
  },
  routes: [
    {
      method: 'GET',
      path: '/tenant',
      roles: [{ code: 'public' }],
      handler: 'probe.tenantRead',
      config: { title: 'Read inside the tenant container' }
    },
    {
      method: 'GET',
      path: '/control',
      scope: 'control',
      roles: [{ code: 'public' }],
      handler: 'probe.controlRead',
      config: { title: 'Read on the control plane' }
    }
  ]
}
