import { customAlphabet } from 'nanoid'

//
// The pairing code of an integration token (docs/API_V5.md §4.2): a short code an administrator
// hands to a machine, which exchanges it once for the token's bearer, so the bearer is never
// pasted into a configuration file.
//

/** Crockford's base32: no I, L, O or U, so a code read aloud or typed again has one spelling. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
/** Twelve symbols of five bits: 60 bits, against at most ten guesses a minute per address. */
const LENGTH = 12
const symbols = customAlphabet(ALPHABET, LENGTH)

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000

// Per IP, and not configurable: the code is all that stands between a caller and a bearer.
export const pairingRateLimit = { max: 10, timeWindow: 60000 }

/** Off unless `config.options.tokenPairing.enabled` is true: off, neither route is mounted. */
export const isTokenPairingEnabled = (): boolean => global.config?.options?.tokenPairing?.enabled === true

/** `code` is what the administrator reads, `normalized` what is hashed and compared. */
export function newPairingCode(): { code: string; normalized: string } {
  const normalized = symbols()
  return { code: normalized.match(/.{4}/g)!.join('-'), normalized }
}

/**
 * What was typed, back to its twelve symbols: case and separators do not count, and O, I and L read
 * as the digits they look like. Anything else is no code.
 */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const code = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return code.length === LENGTH && [...code].every((c) => ALPHABET.includes(c)) ? code : null
}
