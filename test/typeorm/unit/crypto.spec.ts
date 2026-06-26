import { expect } from 'expect'
import * as crypto from 'crypto'
import { encrypt, decrypt } from '../../../lib/database/typeorm/util/crypto.js'

// MFA_DB_SECRET is provided by the `test` npm script (cross-env) before load.
describe('crypto (AES-256-GCM, versioned v2)', () => {
  it('roundtrips a plaintext secret in the v2 format', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const enc = encrypt(secret)
    expect(enc).not.toBe(secret)
    const parts = enc.split(':')
    expect(parts).toHaveLength(5) // v2:salt:iv:authTag:ciphertext
    expect(parts[0]).toBe('v2')
    expect(decrypt(enc)).toBe(secret)
  })

  it('uses a random salt+IV (different ciphertext for the same input)', () => {
    const a = encrypt('same-value')
    const b = encrypt('same-value')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('same-value')
    expect(decrypt(b)).toBe('same-value')
  })

  it('rejects tampered ciphertext via the auth tag', () => {
    const enc = encrypt('confidential')
    const parts = enc.split(':')
    const data = parts[4]
    const lastByte = data.slice(-2)
    parts[4] = `${data.slice(0, -2)}${lastByte === 'ff' ? '00' : 'ff'}`
    expect(() => decrypt(parts.join(':'))).toThrow()
  })

  it('passes empty input through unchanged', () => {
    expect(encrypt('')).toBe('')
    expect(decrypt('')).toBe('')
  })

  // --- Backward compatibility: records written before the v2 format must still decrypt. ---

  const legacyKey = () =>
    Buffer.from(
      crypto
        .createHash('sha256')
        .update(String(process.env.MFA_DB_SECRET || process.env.JWT_SECRET))
        .digest('base64')
        .substring(0, 32)
    )

  it('decrypts legacy GCM records (iv:authTag:ciphertext)', () => {
    const plaintext = 'legacy-gcm-secret'
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv('aes-256-gcm', legacyKey(), iv)
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const legacy = `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
    expect(decrypt(legacy)).toBe(plaintext)
  })

  it('decrypts legacy CBC records (iv:ciphertext)', () => {
    const plaintext = 'legacy-cbc-secret'
    const iv = crypto.randomBytes(16) // CBC IV is 16 bytes
    const cipher = crypto.createCipheriv('aes-256-cbc', legacyKey(), iv)
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const legacy = `${iv.toString('hex')}:${enc.toString('hex')}`
    expect(decrypt(legacy)).toBe(plaintext)
  })
})
