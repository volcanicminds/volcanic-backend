import * as crypto from 'crypto'
import { promisify } from 'util'

//
// Encryption of the secrets the framework stores: today the MFA seed (T-2.6).
//
// What changes from v4 is the shape of the call, not the cryptography. `scryptSync` with
// N = 2^15 measured **82 ms of blocked event loop per derivation** on the survey machine, and
// it sits on the MFA verification path: at ten logins a second the process stops answering
// anything else. The parameters stay exactly as they were — a memory-hard KDF with a
// per-record salt is the right choice, it just must not be synchronous (D-14).
//
// The stored format is unchanged, `v2:salt:iv:authTag:ciphertext`, and the two legacy read
// paths are kept: a project migrating from v4 carries rows written years ago, and refusing to
// read them would mean asking every user to enrol MFA again. Nothing is ever WRITTEN in a
// legacy format.
//
const ALGORITHM_GCM = 'aes-256-gcm'
const ALGORITHM_CBC_LEGACY = 'aes-256-cbc'

const VERSION = 'v2'
const IV_LENGTH = 12 // GCM standard nonce
const SALT_LENGTH = 16 // per-record salt: identical plaintexts never share a key
const KEY_LENGTH = 32 // AES-256
const SCRYPT_N = 32768
const SCRYPT_r = 8
const SCRYPT_p = 1
// scrypt needs ~128*N*r bytes (~33.5 MB), above Node's 32 MB default.
const SCRYPT_MAXMEM = 64 * 1024 * 1024

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>

function getSecret(): string {
  const secret = process.env.MFA_DB_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('MFA_DB_SECRET (or JWT_SECRET) is not set: refusing to encrypt with no key')
  return String(secret)
}

/** scrypt over the secret and the record's own salt, off the event loop. */
async function deriveKey(salt: Buffer): Promise<Buffer> {
  return await scrypt(getSecret(), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: SCRYPT_MAXMEM
  })
}

/** Weak, saltless derivation of the pre-v2 records. Read-only, and never used to write. */
function legacyKey(): Buffer {
  return Buffer.from(crypto.createHash('sha256').update(getSecret()).digest('base64').substring(0, KEY_LENGTH))
}

export async function encrypt(text: string): Promise<string> {
  if (!text) return text

  const salt = crypto.randomBytes(SALT_LENGTH)
  const iv = crypto.randomBytes(IV_LENGTH)
  const key = await deriveKey(salt)

  const cipher = crypto.createCipheriv(ALGORITHM_GCM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])

  return [VERSION, salt.toString('hex'), iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':')
}

/**
 * Reads any supported format:
 *   - `v2:salt:iv:authTag:ciphertext` — scrypt key, GCM. What is written today.
 *   - `iv:authTag:ciphertext`         — legacy key, GCM.
 *   - `iv:ciphertext`                 — legacy key, CBC, unauthenticated. Oldest records.
 * A tampered v2 or GCM record throws on the authentication tag, which is the point of GCM.
 */
export async function decrypt(text: string): Promise<string> {
  if (!text) return text

  const parts = text.split(':')

  if (parts.length === 5 && parts[0] === VERSION) {
    const [, salt, iv, authTag, payload] = parts
    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, await deriveKey(Buffer.from(salt, 'hex')), Buffer.from(iv, 'hex'))
    decipher.setAuthTag(Buffer.from(authTag, 'hex'))
    return decipher.update(Buffer.from(payload, 'hex'), undefined, 'utf8') + decipher.final('utf8')
  }

  if (parts.length === 3) {
    const [iv, authTag, payload] = parts
    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, legacyKey(), Buffer.from(iv, 'hex'))
    decipher.setAuthTag(Buffer.from(authTag, 'hex'))
    return decipher.update(Buffer.from(payload, 'hex'), undefined, 'utf8') + decipher.final('utf8')
  }

  if (parts.length === 2) {
    const [iv, payload] = parts
    const decipher = crypto.createDecipheriv(ALGORITHM_CBC_LEGACY, legacyKey(), Buffer.from(iv, 'hex'))
    return Buffer.concat([decipher.update(Buffer.from(payload, 'hex')), decipher.final()]).toString()
  }

  return text
}
