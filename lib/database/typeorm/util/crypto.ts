import * as crypto from 'crypto'

const ALGORITHM_NEW = 'aes-256-gcm'
const ALGORITHM_OLD = 'aes-256-cbc'
const SECRET_KEY = process.env.MFA_DB_SECRET || process.env.JWT_SECRET
const IV_LENGTH_NEW = 12

function getKey() {
  if (!SECRET_KEY) {
    throw new Error('Secret key is not defined in environment variables.')
  }
  return crypto.createHash('sha256').update(String(SECRET_KEY)).digest('base64').substring(0, 32)
}

export function encrypt(text: string): string {
  if (!text) return text
  const iv = crypto.randomBytes(IV_LENGTH_NEW)
  const cipher = crypto.createCipheriv(ALGORITHM_NEW, Buffer.from(getKey()), iv)
  let encrypted = cipher.update(text, 'utf8')
  encrypted = Buffer.concat([encrypted, cipher.final()])
  const authTag = cipher.getAuthTag()
  return iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted.toString('hex')
}

export function decrypt(text: string): string {
  if (!text) return text
  const textParts = text.split(':')

  if (textParts.length === 2) {
    const iv = Buffer.from(textParts[0], 'hex')
    const encryptedText = Buffer.from(textParts[1], 'hex')
    const decipher = crypto.createDecipheriv(ALGORITHM_OLD, Buffer.from(getKey()), iv)
    let decrypted = decipher.update(encryptedText)
    decrypted = Buffer.concat([decrypted, decipher.final()])
    return decrypted.toString()
  }

  if (textParts.length === 3) {
    const iv = Buffer.from(textParts[0], 'hex')
    const authTag = Buffer.from(textParts[1], 'hex')
    const encryptedText = Buffer.from(textParts[2], 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM_NEW, Buffer.from(getKey()), iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(encryptedText, undefined, 'utf8')
    decrypted += decipher.final('utf8')
    return decrypted
  }

  return text
}
