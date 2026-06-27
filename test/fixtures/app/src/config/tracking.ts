// Consumer-app CHANGE-LOG config. The framework's preHandler/preSerialization
// hooks capture before/after state for the listed routes and write an audit row
// to the `changeEntity` table via dataBaseManager.addChange. Keyed by METHOD::url.
export default {
  enableAll: true,
  primaryKey: 'id',
  changeEntity: 'Change',
  changes: [{ method: 'PUT', path: '/widgets/:id', entity: 'Widget' }]
}
