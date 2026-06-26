import * as crypto from 'crypto'

// Authenticated cipher used for all NEW data.
const ALGORITHM_GCM = 'aes-256-gcm'
// Legacy, unauthenticated cipher: only ever READ for backward compatibility, never written.
const ALGORITHM_CBC_LEGACY = 'aes-256-cbc'

const SECRET_KEY = process.env.MFA_DB_SECRET || process.env.JWT_SECRET

// Current (v2) format parameters.
const VERSION = 'v2'
const IV_LENGTH = 12 // GCM standard nonce length
const SALT_LENGTH = 16 // per-record random salt for the KDF
const KEY_LENGTH = 32 // AES-256
// scrypt cost parameters (N must be a power of 2). N=2^15 keeps derivation well under ~50ms.
const SCRYPT_N = 32768
const SCRYPT_r = 8
const SCRYPT_p = 1
// scrypt memory cost is ~128*N*r bytes (~33.5MB here), above Node's 32MB default → raise maxmem.
const SCRYPT_MAXMEM = 64 * 1024 * 1024

function getSecret(): string {
  if (!SECRET_KEY) {
    throw new Error('Secret key is not defined in environment variables.')
  }
  return String(SECRET_KEY)
}

/**
 * Robust per-record key derivation: scrypt(secret, random salt). Each record carries its own salt,
 * so identical plaintexts never share a key and the derivation follows a memory-hard standard.
 */
function deriveKey(salt: Buffer): Buffer {
  return crypto.scryptSync(getSecret(), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: SCRYPT_MAXMEM
  })
}

/**
 * Legacy key derivation (weak, no salt): sha256(secret) -> base64 -> first 32 chars used as raw key bytes.
 * Kept ONLY to decrypt records written before the v2 format. Never used to encrypt new data.
 */
function legacyKey(): Buffer {
  return Buffer.from(crypto.createHash('sha256').update(getSecret()).digest('base64').substring(0, KEY_LENGTH))
}

/**
 * Encrypts a plaintext into the authenticated, versioned format: `v2:salt:iv:authTag:ciphertext` (hex).
 */
export function encrypt(text: string): string {
  if (!text) return text

  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = deriveKey(salt)

  const cipher = crypto.createCipheriv(ALGORITHM_GCM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  return [VERSION, salt.toString('hex'), iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(
    ':'
  )
}

/**
 * Decrypts a value produced by any supported format:
 *  - v2 (current):    `v2:salt:iv:authTag:ciphertext` -> scrypt key + GCM
 *  - legacy GCM:      `iv:authTag:ciphertext`         -> legacy key + GCM
 *  - legacy CBC:      `iv:ciphertext`                 -> legacy key + CBC (unauthenticated, read-only)
 * Tampering with a GCM/v2 record throws (auth tag mismatch).
 */
export function decrypt(text: string): string {
  if (!text) return text

  const parts = text.split(':')

  // Current versioned format.
  if (parts.length === 5 && parts[0] === VERSION) {
    const salt = Buffer.from(parts[1], 'hex')
    const iv = Buffer.from(parts[2], 'hex')
    const authTag = Buffer.from(parts[3], 'hex')
    const encryptedText = Buffer.from(parts[4], 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, deriveKey(salt), iv)
    decipher.setAuthTag(authTag)
    return decipher.update(encryptedText, undefined, 'utf8') + decipher.final('utf8')
  }

  // Legacy authenticated GCM (pre-v2): iv:authTag:ciphertext with the old key derivation.
  if (parts.length === 3) {
    const iv = Buffer.from(parts[0], 'hex')
    const authTag = Buffer.from(parts[1], 'hex')
    const encryptedText = Buffer.from(parts[2], 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, legacyKey(), iv)
    decipher.setAuthTag(authTag)
    return decipher.update(encryptedText, undefined, 'utf8') + decipher.final('utf8')
  }

  // Legacy unauthenticated CBC (oldest records): iv:ciphertext with the old key derivation. Read-only.
  if (parts.length === 2) {
    const iv = Buffer.from(parts[0], 'hex')
    const encryptedText = Buffer.from(parts[1], 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM_CBC_LEGACY, legacyKey(), iv)
    return Buffer.concat([decipher.update(encryptedText), decipher.final()]).toString()
  }

  return text
}
