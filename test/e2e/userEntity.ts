/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E User entity. Decorators don't work under tsx in test/ (no emitted metadata),
// so we use EntitySchema with a plain `target` CLASS that carries getId()/setId()
// — the framework's auth hooks/controllers call those on `req.user`.
//
// Resolution note: with a `target`, TypeORM keys metadata by the class, so the
// harness sets `global.entity.User = UserClass` (the class) and registers the
// EntitySchema in `entities`.
//
import { EntitySchema } from 'typeorm'

export class UserClass {
  id: string
  externalId: string
  email: string
  password: string
  confirmed: boolean
  blocked: boolean
  roles: string[]
  mfaEnabled: boolean
  mfaLastUsedCounter: number
  getId() {
    return this.id
  }
  setId(id: string) {
    this.id = id
  }
}

export const UserSchema = new EntitySchema<any>({
  name: 'User',
  target: UserClass,
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    externalId: { type: String, nullable: true },
    username: { type: String, nullable: true },
    email: { type: String, unique: true },
    password: { type: String },
    passwordChangedAt: { type: 'timestamptz', nullable: true },
    confirmed: { type: Boolean, default: false },
    confirmedAt: { type: 'timestamptz', nullable: true },
    confirmationToken: { type: String, nullable: true },
    resetPasswordToken: { type: String, nullable: true },
    resetPasswordTokenAt: { type: 'timestamptz', nullable: true },
    blocked: { type: Boolean, default: false },
    blockedReason: { type: String, nullable: true },
    blockedAt: { type: 'timestamptz', nullable: true },
    roles: { type: 'simple-array', nullable: true },
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String, nullable: true, select: false },
    mfaType: { type: String, nullable: true },
    mfaRecoveryCodes: { type: 'simple-array', nullable: true },
    mfaLastUsedCounter: { type: 'int', nullable: true },
    firstName: { type: String, nullable: true },
    lastName: { type: String, nullable: true },
    createdAt: { type: 'timestamptz', createDate: true },
    updatedAt: { type: 'timestamptz', updateDate: true }
  }
})
