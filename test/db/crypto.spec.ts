/* eslint-disable @typescript-eslint/no-explicit-any */
//
// T-2.6. The cryptography is unchanged from v4 and the tests say so: what changed is that the
// derivation no longer blocks the event loop (D-14, measured at 82 ms per call).
//
import * as crypto from 'crypto'
import { expect } from 'expect'
import { encrypt, decrypt } from '../../lib/database/crypto.js'

process.env.MFA_DB_SECRET = process.env.MFA_DB_SECRET || 'unit-test-secret-please-change-32xyz'

describe('database/crypto', function () {
  this.timeout(20000)

  it('round-trips a secret in the versioned format', async () => {
    const encrypted = await encrypt('JBSWY3DPEHPK3PXP')
    expect(encrypted.startsWith('v2:')).toBe(true)
    expect(encrypted.split(':').length).toBe(5)
    expect(await decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP')
  })

  it('gives every record its own salt, so identical secrets do not share a key', async () => {
    const a = await encrypt('same')
    const b = await encrypt('same')
    expect(a).not.toBe(b)
    expect(a.split(':')[1]).not.toBe(b.split(':')[1])
    expect(await decrypt(a)).toBe(await decrypt(b))
  })

  it('refuses a tampered record instead of returning plausible bytes', async () => {
    const encrypted = await encrypt('secret')
    const parts = encrypted.split(':')
    parts[4] = parts[4].replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))
    await expect(decrypt(parts.join(':'))).rejects.toThrow()
  })

  it('still reads the two legacy formats, and never writes them', async () => {
    const legacyKey = Buffer.from(
      crypto.createHash('sha256').update(process.env.MFA_DB_SECRET!).digest('base64').substring(0, 32)
    )

    const gcmIv = crypto.randomBytes(12)
    const gcm = crypto.createCipheriv('aes-256-gcm', legacyKey, gcmIv)
    const gcmPayload = Buffer.concat([gcm.update('old gcm', 'utf8'), gcm.final()])
    const legacyGcm = [gcmIv.toString('hex'), gcm.getAuthTag().toString('hex'), gcmPayload.toString('hex')].join(':')
    expect(await decrypt(legacyGcm)).toBe('old gcm')

    const cbcIv = crypto.randomBytes(16)
    const cbc = crypto.createCipheriv('aes-256-cbc', legacyKey, cbcIv)
    const cbcPayload = Buffer.concat([cbc.update('old cbc', 'utf8'), cbc.final()])
    expect(await decrypt([cbcIv.toString('hex'), cbcPayload.toString('hex')].join(':'))).toBe('old cbc')
  })

  it('does not block the event loop while deriving', async () => {
    // The property, not the timing: a timer scheduled before the derivation must fire while
    // it is still running. With scryptSync it could not, which is the whole of D-14.
    let timerFired = false
    const timer = setTimeout(() => (timerFired = true), 5)

    await encrypt('anything')
    clearTimeout(timer)
    expect(timerFired).toBe(true)
  })

  it('passes an empty value through untouched', async () => {
    expect(await encrypt('')).toBe('')
    expect(await decrypt('')).toBe('')
  })
})
