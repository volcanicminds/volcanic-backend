import { BaseEntity } from 'typeorm'

export abstract class Change extends BaseEntity {
  abstract createdAt: Date
  abstract updatedAt: Date
  abstract userId: string
  abstract status: string
  abstract entityName: string
  abstract entityId: string
  abstract contents: object
}
