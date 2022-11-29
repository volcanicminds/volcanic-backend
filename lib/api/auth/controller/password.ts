const { customAlphabet } = require('nanoid')
const nanoid = customAlphabet('AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789')

const bcrypt = require('bcrypt')
// const validator = require('../../../loader/validator')

export function hash(password: string): string {
  return bcrypt.hashSync(password, bcrypt.genSaltSync())
}

export function compare(password: string, encryptedPassword: string): boolean {
  return bcrypt.compareSync(password, encryptedPassword)
}

export function valid(password: string): boolean {
  return true //password?.length > 7 && validator.password(password)
}

export function newAuthCode() {
  return nanoid(Number(process.env.AUTH_CODE_SIZE) || 10)
}
