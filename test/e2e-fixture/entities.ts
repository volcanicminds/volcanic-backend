/* eslint-disable @typescript-eslint/no-explicit-any */
//
// Entities for the consumer-app fixture suite. EntitySchema (decorator-free)
// because tsx doesn't emit decorator metadata under test/. Widget is the custom
// resource; Change is the audit-log table the framework writes to via
// dataBaseManager.addChange (looked up by name 'Change').
//
import { EntitySchema } from 'typeorm'

export class WidgetClass {
  id: string
  name: string
  value: number
  getId() {
    return this.id
  }
  setId(id: string) {
    this.id = id
  }
}

export const WidgetSchema = new EntitySchema<any>({
  name: 'Widget',
  target: WidgetClass,
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    name: { type: String },
    value: { type: 'int', default: 0 },
    createdAt: { type: 'timestamptz', createDate: true },
    updatedAt: { type: 'timestamptz', updateDate: true }
  }
})

// `Change` must be resolvable by name (dataBaseManager uses getRepository('Change')
// / global.entity.Change) — no target class, so the name keys the metadata.
export const ChangeSchema = new EntitySchema<any>({
  name: 'Change',
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    entityName: { type: String },
    entityId: { type: String },
    status: { type: String },
    userId: { type: String, nullable: true },
    contents: { type: 'simple-json', nullable: true },
    createdAt: { type: 'timestamptz', createDate: true },
    updatedAt: { type: 'timestamptz', updateDate: true }
  }
})
