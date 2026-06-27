/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E Tenant entity (multi-tenant suite). Uses an EntitySchema WITHOUT a target
// class: the TenantManager looks the entity up by NAME (getRepository('Tenant'))
// and only handles plain objects, so a target class would actually break the
// string lookup (metadata would be keyed by the class instead of the name).
//
import { EntitySchema } from 'typeorm'

export const TenantSchema = new EntitySchema<any>({
  name: 'Tenant',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String, nullable: true },
    slug: { type: String, unique: true },
    dbSchema: { type: String, nullable: true },
    dbName: { type: String, nullable: true },
    status: { type: String, default: 'active' },
    createdAt: { type: 'timestamp', createDate: true },
    updatedAt: { type: 'timestamp', updateDate: true },
    deletedAt: { type: 'timestamp', deleteDate: true, nullable: true }
  }
})
