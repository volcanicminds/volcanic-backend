/* eslint-disable @typescript-eslint/no-explicit-any */
import { BaseEntity } from 'typeorm'

export abstract class Tenant extends BaseEntity {
  abstract id: any
  abstract name: string
  abstract slug: string

  // Campi specifici per strategia
  abstract dbSchema?: string // Per Postgres (schema splitting)
  abstract dbName?: string // Per Mongo (database splitting, opzionale)

  abstract status: 'active' | 'suspended' | 'archived'

  abstract createdAt: Date
  abstract updatedAt: Date

  // Configurazione opzionale
  abstract getConfig(): Record<string, any>
}
