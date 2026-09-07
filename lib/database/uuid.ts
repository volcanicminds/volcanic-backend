import { randomBytes } from 'crypto'

//
// UUID v7: 48 bits of Unix milliseconds, then version and variant bits, then randomness.
//
// Why not ask the database for a free identifier: v4 looked one up with a `do/while` around
// a SELECT, both for users and for tokens (D-28). That is a round trip per insert to solve a
// collision that does not happen — 74 random bits give a birthday collision probability
// below 1e-15 for the volumes this framework sees.
//
// Why v7 rather than v4: it is time-ordered, so inserts stay local in the b-tree instead of
// scattering across it, and a row carries its creation instant even before you look at
// created_at. Why not a dependency: it is twenty lines and it is on the hot path of every
// insert.
//
const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

let lastMs = 0
let sequence = 0

export function uuidv7(): string {
  const now = Date.now()

  // Same millisecond: keep a counter in the first random block so two ids minted back to
  // back stay ordered. It is what makes v7 usable as a sort key inside a single request.
  if (now === lastMs) {
    sequence = (sequence + 1) & 0x0fff
  } else {
    lastMs = now
    sequence = 0
  }

  const bytes = randomBytes(16)

  // 48-bit big-endian timestamp
  bytes[0] = (now / 2 ** 40) & 0xff
  bytes[1] = (now / 2 ** 32) & 0xff
  bytes[2] = (now / 2 ** 24) & 0xff
  bytes[3] = (now / 2 ** 16) & 0xff
  bytes[4] = (now / 2 ** 8) & 0xff
  bytes[5] = now & 0xff

  // version 7 in the high nibble, then the sequence in the remaining 12 bits
  bytes[6] = 0x70 | ((sequence >> 8) & 0x0f)
  bytes[7] = sequence & 0xff

  // RFC 4122 variant
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const h = (i: number) => HEX[bytes[i]]
  return (
    h(0) + h(1) + h(2) + h(3) + '-' +
    h(4) + h(5) + '-' +
    h(6) + h(7) + '-' +
    h(8) + h(9) + '-' +
    h(10) + h(11) + h(12) + h(13) + h(14) + h(15)
  )
}

/** The instant a v7 identifier was minted. Useful in diagnostics; never a substitute for created_at. */
export function uuidv7Time(id: string): Date {
  return new Date(parseInt(id.replace(/-/g, '').slice(0, 12), 16))
}
