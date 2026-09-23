import { eq } from 'drizzle-orm'
import type { DataHandle, SettingManagement } from '../../../types/global.js'
import { runtime, table, column } from './runtime.js'

//
// Settings of a container, one row per key (F49). The control plane keeps the ones that apply to
// every tenant in its own container, a tenant keeps its choices in its own: each plane writes only
// where it owns the data. A value is JSON and never a secret, because whoever reads the setting of
// a key reads all of it.
//
const NAME = 'settingManager'

export function createSettingManager(): SettingManagement {
  const settings = (ctx: unknown, what: string) => {
    const handle = runtime(ctx, `${NAME}.${what}`)
    return { handle, setting: table(handle, 'setting') }
  }

  return {
    isImplemented: () => true,

    async get(ctx: DataHandle, key: string) {
      const { handle, setting } = settings(ctx, 'get')
      const rows = await handle.db
        .select()
        .from(setting)
        .where(eq(column(setting, 'key'), String(key) as never))
        .limit(1)
      const row = rows[0] as { value?: unknown } | undefined
      return row ? (row.value ?? null) : null
    },

    async set(ctx: DataHandle, key: string, value: unknown, updatedBy?: string | null) {
      const { handle, setting } = settings(ctx, 'set')
      const values = { key: String(key), value: value as never, updatedBy: updatedBy ?? null, updatedAt: new Date() }
      // One statement on both engines: the key is the primary key, and a read-then-write would let
      // two administrators saving at once both insert.
      await handle.db
        .insert(setting)
        .values(values)
        .onConflictDoUpdate({
          target: column(setting, 'key') as never,
          set: { value: values.value, updatedBy: values.updatedBy, updatedAt: values.updatedAt }
        })
    },

    async remove(ctx: DataHandle, key: string) {
      const { handle, setting } = settings(ctx, 'remove')
      const rows = await handle.db
        .delete(setting)
        .where(eq(column(setting, 'key'), String(key) as never))
        .returning({ key: column(setting, 'key') })
      return rows.length > 0
    }
  }
}
