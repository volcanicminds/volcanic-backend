/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseEntity } from 'typeorm'

export abstract class Token extends BaseEntity {
  // abstract id: any
  abstract externalId: string
  abstract name: string
  abstract description: string
  abstract blocked: boolean
  abstract blockedReason: string
  abstract blockedAt: Date
  abstract roles: string[]
  abstract createdAt: Date
  abstract updatedAt: Date
  abstract deletedAt: Date
  abstract setId(id: any)
  abstract getId(): any
}
