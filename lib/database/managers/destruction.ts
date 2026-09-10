import { and, eq, isNull, gt } from 'drizzle-orm'
import crypto from 'crypto'
import type { ControlHandle, DestructionManagement, DestructionRequest } from '../../../types/global.js'
import { control, table, column } from './runtime.js'

//
// The first phase of destroying a customer's data (T-6.3, docs/SCHEMA_V5.md §3.4).
//
// A row here is a permission with a fuse: it names one tenant, it belongs to one operator, it
// is good for ten minutes, and it can be spent once. Everything about that shape exists
// because the operation it authorises cannot be undone.
//
// The token is **never stored**. What the row keeps is its SHA-256, so a control plane that
// leaks its own tables still leaks nothing that can destroy anything: the only copy of the
// token was in the response to phase 1, and the operator has it or nobody does.
//
const NAME = 'destructionManager'

/** SHA-256, hex. The token is compared by hash and never written down. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token)).digest('hex')
}

export function createDestructionManager(): DestructionManagement {
  const requests = (ctx: unknown, what: string) => {
    const handle = control(ctx, `${NAME}.${what}`)
    return { handle, request: table(handle, 'destructionRequest') }
  }

  return {
    isImplemented: () => true,

    async openRequest(ctx: ControlHandle, data) {
      const { handle, request } = requests(ctx, 'openRequest')
      const rows = await handle.db
        .insert(request)
        .values({
          tenantId: String(data.tenantId),
          systemUserId: String(data.systemUserId),
          tokenHash: hashToken(String(data.token)),
          preview: data.preview ?? {},
          expiresAt: new Date(data.expiresAt as never)
        })
        .returning()
      return rows[0] as DestructionRequest
    },

    /**
     * The request a token unlocks, only while it is still good for something.
     *
     * Unknown, expired and already spent all answer `null`, and that is deliberate: telling
     * them apart would let a caller learn that a request exists for a tenant they cannot name,
     * and none of the three is a state the caller can do anything about.
     */
    async findLiveRequest(ctx: ControlHandle, tenantId: string, token: string) {
      const { handle, request } = requests(ctx, 'findLiveRequest')
      const rows = await handle.db
        .select()
        .from(request)
        .where(
          and(
            eq(column(request, 'tenantId'), tenantId as never),
            eq(column(request, 'tokenHash'), hashToken(token) as never),
            isNull(column(request, 'consumedAt')),
            gt(column(request, 'expiresAt'), new Date() as never)
          )
        )
        .limit(1)
      return (rows[0] as DestructionRequest) ?? null
    },

    /**
     * Spends the request, and records what was exported before the data went.
     *
     * Called BEFORE the destruction runs, not after: an operation that cannot be undone is
     * written down while it is still possible to write anything down. A crash between this
     * row and the drop leaves a record saying what was about to happen, which is the version
     * of the story an operator can act on.
     */
    async consumeRequest(ctx: ControlHandle, id: string, exportRef: string) {
      const { handle, request } = requests(ctx, 'consumeRequest')
      const rows = await handle.db
        .update(request)
        .set({ consumedAt: new Date(), exportRef })
        .where(and(eq(column(request, 'id'), id as never), isNull(column(request, 'consumedAt'))))
        .returning()
      return (rows[0] as DestructionRequest) ?? null
    }
  }
}
