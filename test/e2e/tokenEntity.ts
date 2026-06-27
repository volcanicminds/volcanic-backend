/* eslint-disable @typescript-eslint/no-explicit-any */
//
// E2E Token (API key) entity. Same rationale as userEntity.ts: decorators don't
// emit metadata under tsx in test/, so we use an EntitySchema with a target class
// carrying getId()/setId() — the token controllers and the onRequest token path
// call those on the resolved token.
//
import { EntitySchema } from 'typeorm'

export class TokenClass {
  id: string
  externalId: string
  name: string
  description: string
  token: string
  blocked: boolean
  roles: string[]
  getId() {
    return this.id
  }
  setId(id: string) {
    this.id = id
  }
}

export const TokenSchema = new EntitySchema<any>({
  name: 'Token',
  target: TokenClass,
  columns: {
    id: { type: 'uuid', primary: true, generated: 'uuid' },
    externalId: { type: String, nullable: true },
    name: { type: String },
    description: { type: String, nullable: true },
    token: { type: String, nullable: true },
    blocked: { type: Boolean, default: false },
    blockedReason: { type: String, nullable: true },
    blockedAt: { type: 'timestamp', nullable: true },
    roles: { type: 'simple-array', nullable: true },
    createdAt: { type: 'timestamp', createDate: true },
    updatedAt: { type: 'timestamp', updateDate: true },
    deletedAt: { type: 'timestamp', deleteDate: true, nullable: true }
  }
})
