/* eslint-disable @typescript-eslint/no-explicit-any */
// Concrete entities for the PGlite integration tests, declared with TypeORM's
// EntitySchema API (no decorators) so the suite is independent of the
// experimentalDecorators transpiler setup. A real app would normally use the
// decorator-based entities that extend the framework's abstract User/Tenant.
import { EntitySchema } from 'typeorm'

// Plain domain entity: exercises CRUD, boolean serialization and queries.
export const Product = new EntitySchema<any>({
  name: 'Product',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    price: { type: 'int', default: 0 },
    active: { type: Boolean, default: true },
    tags: { type: 'text', array: true, nullable: true }
  }
})

// Minimal but complete User: covers everything userManager.createUser writes,
// so the multi-tenant admin-seeding path works end to end.
export const User = new EntitySchema<any>({
  name: 'User',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    externalId: { type: String, nullable: true },
    username: { type: String, nullable: true },
    email: { type: String, unique: true },
    password: { type: String },
    passwordChangedAt: { type: 'timestamp', nullable: true },
    confirmed: { type: Boolean, default: false },
    confirmationToken: { type: String, nullable: true },
    blocked: { type: Boolean, default: false },
    blockedReason: { type: String, nullable: true },
    roles: { type: 'simple-array', nullable: true },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, nullable: true },
    mfaType: { type: String, nullable: true },
    mfaRecoveryCodes: { type: 'simple-array', nullable: true },
    firstName: { type: String, nullable: true },
    lastName: { type: String, nullable: true },
    createdAt: { type: 'timestamp', createDate: true },
    updatedAt: { type: 'timestamp', updateDate: true }
  }
})

export const Token = new EntitySchema<any>({
  name: 'Token',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    externalId: { type: String, nullable: true },
    name: { type: String },
    description: { type: String, nullable: true },
    blocked: { type: Boolean, default: false },
    blockedReason: { type: String, nullable: true },
    blockedAt: { type: 'timestamp', nullable: true },
    roles: { type: 'simple-array', nullable: true },
    createdAt: { type: 'timestamp', createDate: true },
    updatedAt: { type: 'timestamp', updateDate: true },
    deletedAt: { type: 'timestamp', deleteDate: true, nullable: true }
  }
})

export const Tenant = new EntitySchema<any>({
  name: 'Tenant',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    slug: { type: String, unique: true },
    dbSchema: { type: String, nullable: true },
    dbName: { type: String, nullable: true },
    status: { type: String, default: 'active' },
    createdAt: { type: 'timestamp', createDate: true },
    updatedAt: { type: 'timestamp', updateDate: true },
    deletedAt: { type: 'timestamp', deleteDate: true, nullable: true }
  }
})
