import { expect } from 'expect'
import { encrypt, decrypt } from '../../../lib/database/typeorm/util/crypto.js'

// MFA_DB_SECRET is provided by the `test` npm script (cross-env) before load.
describe('crypto (AES-256-GCM)', () => {
  it('roundtrips a plaintext secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP'
    const enc = encrypt(secret)
    expect(enc).not.toBe(secret)
    expect(enc.split(':')).toHaveLength(3) // iv:authTag:ciphertext (GCM format)
    expect(decrypt(enc)).toBe(secret)
  })

  it('uses a random IV (different ciphertext for the same input)', () => {
    const a = encrypt('same-value')
    const b = encrypt('same-value')
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('same-value')
    expect(decrypt(b)).toBe('same-value')
  })

  it('rejects tampered ciphertext via the auth tag', () => {
    const enc = encrypt('confidential')
    const [iv, tag, data] = enc.split(':')
    const lastByte = data.slice(-2)
    const tampered = `${iv}:${tag}:${data.slice(0, -2)}${lastByte === 'ff' ? '00' : 'ff'}`
    expect(() => decrypt(tampered)).toThrow()
  })

  it('passes empty input through unchanged', () => {
    expect(encrypt('')).toBe('')
    expect(decrypt('')).toBe('')
  })
})
