import { and, asc, eq } from 'drizzle-orm'
import type { DataHandle, ExternalIdentity, ExternalIdentityManagement, SessionScope } from '../../../types/global.js'
import { runtime, table, column } from './runtime.js'

//
// Links between an identity at a provider and a subject (F40). They live in the container of the
// subject, like its sessions. The key is (scope, provider, issuer, subject) and never an email.
// A second link for the same key is refused by the unique index and the driver's error reaches the
// caller: the engine asks `findLink` first, and a race it loses is not a link to overwrite.
//
const NAME = 'externalIdentityManager'

export function createExternalIdentityManager(): ExternalIdentityManagement {
  const links = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, identity: table(handle, 'externalIdentity') }
  }

  return {
    isImplemented: () => true,

    async findLink(ctx: DataHandle, key) {
      const { handle, identity } = links(ctx, 'findLink')
      const rows = await handle.db
        .select()
        .from(identity)
        .where(
          and(
            eq(column(identity, 'scope'), key.scope as never),
            eq(column(identity, 'provider'), String(key.provider) as never),
            eq(column(identity, 'issuer'), String(key.issuer) as never),
            eq(column(identity, 'subject'), String(key.subject) as never)
          )
        )
        .limit(1)
      return (rows[0] as ExternalIdentity) ?? null
    },

    async createLink(ctx: DataHandle, data) {
      const { handle, identity } = links(ctx, 'createLink')
      const rows = await handle.db
        .insert(identity)
        .values({
          scope: data.scope,
          subjectId: String(data.subjectId),
          provider: String(data.provider),
          issuer: String(data.issuer),
          subject: String(data.subject),
          emailAtLink: data.emailAtLink ?? null
        })
        .returning()
      return rows[0] as ExternalIdentity
    },

    async listOfSubject(ctx: DataHandle, subjectId: string, scope: SessionScope) {
      const { handle, identity } = links(ctx, 'listOfSubject')
      const rows = await handle.db
        .select()
        .from(identity)
        .where(and(eq(column(identity, 'subjectId'), String(subjectId) as never), eq(column(identity, 'scope'), scope as never)))
        .orderBy(asc(column(identity, 'createdAt')))
      return rows as ExternalIdentity[]
    },

    async removeLink(ctx: DataHandle, id: string, subjectId: string) {
      const { handle, identity } = links(ctx, 'removeLink')
      const rows = await handle.db
        .delete(identity)
        .where(and(eq(column(identity, 'id'), String(id) as never), eq(column(identity, 'subjectId'), String(subjectId) as never)))
        .returning({ id: column(identity, 'id') })
      return rows.length > 0
    },

    async touch(ctx: DataHandle, id: string) {
      const { handle, identity } = links(ctx, 'touch')
      const rows = await handle.db
        .update(identity)
        .set({ lastUsedAt: new Date() })
        .where(eq(column(identity, 'id'), String(id) as never))
        .returning({ id: column(identity, 'id') })
      return rows.length > 0
    }
  }
}
