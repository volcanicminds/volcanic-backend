'use strict'

import { randomBytes } from 'crypto'

/**
 * UUID v7 for the core.
 *
 * This is a second copy of the generator in `lib/database/uuid.ts`, and the duplication is
 * deliberate: the boundary checked in CI forbids the core from importing a runtime value out
 * of the data layer, and forbids the data layer from importing one out of the core, so a
 * shared module has nowhere to live that both sides may reach. Twenty lines of a stable,
 * specified algorithm is the cheaper of the two prices.
 *
 * The core needs it for identifiers that are never stored — the decoy registration of D-17 —
 * which must be indistinguishable from the ones the database mints. A v4 uuid would carry a
 * different version nibble, and that nibble alone would answer the question the decoy exists
 * to leave unanswered.
 */
export function uuidv7(): string {
  const now = Date.now()
  const bytes = randomBytes(16)

  // 48-bit big-endian timestamp
  bytes[0] = (now / 2 ** 40) & 0xff
  bytes[1] = (now / 2 ** 32) & 0xff
  bytes[2] = (now / 2 ** 24) & 0xff
  bytes[3] = (now / 2 ** 16) & 0xff
  bytes[4] = (now / 2 ** 8) & 0xff
  bytes[5] = now & 0xff

  bytes[6] = 0x70 | (bytes[6] & 0x0f) // version 7
  bytes[8] = 0x80 | (bytes[8] & 0x3f) // RFC 4122 variant

  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
