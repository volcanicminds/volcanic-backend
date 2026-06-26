/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseEntity } from 'typeorm'

export abstract class User extends BaseEntity {
  // abstract id: any
  abstract externalId: string
  abstract username: string
  abstract email: string
  abstract password: string
  abstract confirmed: boolean
  abstract confirmedAt: Date
  abstract passwordChangedAt: Date
  abstract blocked: boolean
  abstract blockedReason: string
  abstract blockedAt: Date
  abstract resetPasswordToken: string
  abstract resetPasswordTokenAt: Date
  abstract confirmationToken: string
  abstract roles: string[]
  abstract version: number
  abstract createdAt: Date
  abstract updatedAt: Date
  abstract deletedAt: Date

  // MFA Fields
  abstract mfaEnabled: boolean
  abstract mfaSecret: string
  abstract mfaType: string
  abstract mfaRecoveryCodes: string[]

  abstract setId(id: any): void
  abstract getId(): any
}
