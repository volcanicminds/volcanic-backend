import * as crypto from 'crypto'
import { promisify } from 'util'

//
// Encryption of the secrets the framework stores: the MFA seed of users and operators, the
// client secret of an identity provider, the external identity a login flow carries. Exported
// from `@volcanicminds/backend/db` for an application's own secrets.
//
// The derivation is asynchronous. `scryptSync` with N = 2^15 measured **82 ms of blocked
// event loop per derivation** on the survey machine, and it sits on the MFA verification
// path: at ten logins a second the process stops answering anything else. A memory-hard KDF
// with a per-record salt is the right choice, it just must not be synchronous.
//
// One format, `v2:salt:iv:authTag:ciphertext`, written and read. Anything else is refused, a
// value in clear included: returning it as it came would let an unencrypted secret pass for
// a decrypted one.
//
const ALGORITHM_GCM = 'aes-256-gcm'

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
 * Reads what `encrypt` writes and nothing else: a value in another format throws, and so does
 * a tampered one, on the authentication tag, which is the point of GCM.
 */
export async function decrypt(text: string): Promise<string> {
  if (!text) return text

  const parts = text.split(':')
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error(`Not a value this framework encrypted: the stored format is ${VERSION}:salt:iv:authTag:ciphertext`)
  }

  const [, salt, iv, authTag, payload] = parts
  const decipher = crypto.createDecipheriv(ALGORITHM_GCM, await deriveKey(Buffer.from(salt, 'hex')), Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(authTag, 'hex'))
  return decipher.update(Buffer.from(payload, 'hex'), undefined, 'utf8') + decipher.final('utf8')
}
