//
// The provisioning body (docs/API_V5.md §6.1).
//
// `dbSchema` is gone: the field that says WHERE a container lives is `locator`, and it is
// optional because the framework derives it from the slug. What a caller may not do is send
// one that changes under sanitisation, which answers 400 rather than being accepted quietly
// under a different name (defect D-20).
//
export const tenantBodySchema = {
  $id: 'tenantBodySchema',
  type: 'object',
  required: ['name', 'slug', 'admin'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    slug: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      pattern: '^[a-z0-9_-]+$'
    },
    strategy: { type: 'string', enum: ['schema', 'container'] },
    engine: { type: 'string', enum: ['postgres', 'sqlite', 'libsql'] },
    // S12: a safe SQL identifier alphabet. The name is printed into every statement built
    // for the container (T-3.1), so it is validated at the edge, again before it is stored,
    // and again before it becomes a cache key. maxLength 63 = Postgres identifier limit.
    locator: { type: 'string', minLength: 1, maxLength: 63, pattern: '^[a-zA-Z0-9_]+$' },
    config: { type: 'object', additionalProperties: true },
    // A tenant whose administrator cannot log in is not provisioned, it is broken (D-08), so
    // the administrator is part of the request and not a later step.
    admin: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', minLength: 3, maxLength: 320 },
        password: { type: 'string', minLength: 8, maxLength: 128 },
        // Defaults to TRUE on this route, unlike POST /auth/register: administrative
        // provisioning and public self-registration are different paths with different
        // meanings, and v4 gave both the same one.
        adminConfirmed: { type: 'boolean' }
      }
    }
  }
}

export const tenantUpdateBodySchema = {
  $id: 'tenantUpdateBodySchema',
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 255 },
    status: { type: 'string', enum: ['active', 'suspended', 'archived'] },
    config: { type: 'object' }
  }
}

export const tenantResponseSchema = {
  $id: 'tenantResponseSchema',
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    strategy: { type: 'string' },
    engine: { type: 'string' },
    // Where the data is. `dbSchema` was the v4 name and it is gone with the field it named.
    locator: { type: 'string' },
    // Which migration this container was last brought to (T-5.1). Null on a container that
    // predates the version, which a serializer must be able to say rather than drop.
    schemaVersion: { type: ['string', 'null'] },
    status: { type: 'string', enum: ['active', 'suspended', 'archived'] },
    config: { type: 'object', additionalProperties: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' }
  }
}

export const tenantListResponseSchema = {
  $id: 'tenantListResponseSchema',
  type: 'array',
  items: { $ref: 'tenantResponseSchema#' }
}
