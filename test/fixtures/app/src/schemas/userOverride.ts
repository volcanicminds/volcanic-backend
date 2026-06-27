// Consumer-app SCHEMA OVERRIDE. The schemas loader matches by `$id`: a custom
// schema with the same $id as a base one REPLACES it. Here we re-publish
// `userSchema` adding `firstName`, which the base schema omits (and would strip
// from responses). GET /users will then expose firstName, proving the override.
export const userSchema = {
  $id: 'userSchema',
  type: 'object',
  nullable: true,
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    username: { type: 'string' },
    firstName: { type: 'string' }, // <-- added by the override
    roles: { type: 'array', items: { type: 'string' } }
  }
}
